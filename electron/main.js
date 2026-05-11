const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================
// AES-GCM 加密 helpers（密码本地存储用）
// ============================================================
// 使用 PBKDF2 派生密钥，盐值持久化存储，比简单哈希更安全
function getKeyStorePath() {
    return path.join(app.getPath('userData'), '.adb_key_salt');
}

function getOrCreateSalt() {
    const saltPath = getKeyStorePath();
    try {
        return fs.readFileSync(saltPath);
    } catch {
        const salt = crypto.randomBytes(32);
        try { fs.writeFileSync(saltPath, salt); } catch {}
        return salt;
    }
}

function deriveKey() {
    const salt = getOrCreateSalt();
    // 使用机器特定信息作为密码，结合随机盐值派生密钥
    const password = (process.env.COMPUTERNAME || 'default') + '__adb_tools_local__' + app.getPath('userData');
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

// 延迟派生密钥，确保 app.getPath 可用
let _encryptionKey = null;
function getEncryptionKey() {
    if (!_encryptionKey) {
        _encryptionKey = deriveKey();
    }
    return _encryptionKey;
}

function encrypt(plaintext) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    } catch { return null; }
}

function decrypt(data) {
    try {
        const buf = Buffer.from(data, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const encrypted = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
        decipher.setAuthTag(tag);
        return (decipher.update(encrypted) + decipher.final('utf8')).toString('utf8');
    } catch { return null; }
}

// 密码映射文件（encrypted JSON）— 支持按 serial 和 sku 双重缓存
function getPasswordStorePath() {
    return path.join(app.getPath('userData'), 'adb_auth_store.json');
}

function loadPasswordStore() {
    try {
        const raw = fs.readFileSync(getPasswordStorePath(), 'utf8');
        return JSON.parse(raw);
    } catch { return {}; }
}

function _saveStore(store) {
    fs.writeFileSync(getPasswordStorePath(), JSON.stringify(store, null, 2));
}

function savePasswordToStore(serial, password, sku) {
    const store = loadPasswordStore();
    const enc = encrypt(password);
    const now = new Date().toISOString();
    store[serial] = { password: enc, sku: sku || null, updated_at: now };
    // 同时按 SKU 缓存（sku:xxx 作为 key）
    if (sku && sku !== '未知SKU') {
        store[`sku:${sku}`] = { password: enc, updated_at: now };
    }
    _saveStore(store);
}

function getSavedPassword(serial) {
    const store = loadPasswordStore();
    const entry = store[serial];
    if (!entry) return null;
    return decrypt(entry.password);
}

// 按 SKU 查找缓存密码
function getSavedPasswordBySku(sku) {
    if (!sku || sku === '未知SKU') return null;
    const store = loadPasswordStore();
    const entry = store[`sku:${sku}`];
    if (!entry) return null;
    return decrypt(entry.password);
}

function removeSavedPassword(serial) {
    const store = loadPasswordStore();
    if (store[serial]) { delete store[serial]; _saveStore(store); }
}

// ============================================================
// Auth state：已认证设备 + 正在轮询的设备
// ============================================================
let authenticatedDevices = new Set();
let authPollingLoops = {};  // serial → { trying: bool, current: int, total: int, success: bool, found: bool }
let authEventCallback = null; // 前端注册的状态回调

// ============================================================
// ADB Track-Devices：实时监听设备热插拔
// ============================================================
let trackDevicesProcess = null;
let deviceChangeCallback = null; // 通知前端设备变化
let lastKnownDevices = []; // 缓存最后已知的设备列表，用于快速响应

function startTrackDevices() {
    if (trackDevicesProcess) return;
    try {
        trackDevicesProcess = spawn(adbPath, ['track-devices'], { windowsHide: true });
        let buffer = '';
        trackDevicesProcess.stdout.on('data', (data) => {
            buffer += data.toString();
            // track-devices 输出格式: 4字节长度(hex) + 设备列表
            // 每次变化都发一个完整包
            while (buffer.length >= 4) {
                const lenHex = buffer.substring(0, 4);
                const len = parseInt(lenHex, 16);
                if (isNaN(len)) { buffer = ''; break; }
                if (buffer.length < 4 + len) break; // 数据不全
                const payload = buffer.substring(4, 4 + len);
                buffer = buffer.substring(4 + len);
                // 解析设备列表并通知前端
                const devices = [];
                for (const line of payload.split('\n')) {
                    const parts = line.trim().split('\t');
                    if (parts.length >= 2) {
                        devices.push({ serial: parts[0], state: parts[1] });
                    }
                }
                lastKnownDevices = devices;
                if (deviceChangeCallback) {
                    deviceChangeCallback(devices);
                }
            }
        });
        trackDevicesProcess.on('error', () => {
            trackDevicesProcess = null;
            // 重试
            setTimeout(startTrackDevices, 3000);
        });
        trackDevicesProcess.on('close', () => {
            trackDevicesProcess = null;
            // 进程意外退出，重启
            setTimeout(startTrackDevices, 2000);
        });
    } catch (e) {
        trackDevicesProcess = null;
    }
}

function stopTrackDevices() {
    if (trackDevicesProcess) {
        try { trackDevicesProcess.kill(); } catch {}
        trackDevicesProcess = null;
    }
}

// Path helpers
function getPreloadPath() {
    return path.join(__dirname, 'preload.js');
}

function getIndexPath() {
    if (process.env.NODE_ENV === 'development') {
        return 'http://localhost:5173';
    }
    // Production: look in ../dist folder (relative to electron folder)
    return path.join(__dirname, '../dist/index.html');
}

// Global state
let mainWindow = null;
let adbPath = 'adb';

// ============================================================
// Helper: run ADB command
// ============================================================
function runAdb(args, device, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const serialArg = device ? ['-s', device] : [];
        const cmdArgs = [...serialArg, ...args];

        const child = spawn(adbPath, cmdArgs, {
            windowsHide: true,
            timeout: timeoutMs,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        child.on('close', (code) => {
            resolve({ success: code === 0, output: stdout.trim(), error: stderr.trim() || null });
        });

        // Kill after timeout
        setTimeout(() => {
            try { child.kill(); } catch {}
            resolve({ success: false, output: stdout.trim(), error: 'TIMEOUT' });
        }, timeoutMs);
    });
}

function runAdbShell(device, cmd, timeoutMs = 30000) {
    return runAdb(['shell', cmd], device, timeoutMs);
}

// Built-in auth keys (same as original Python code)
const AUTH_KEYS = [
    "brY1d2@dictpen", "brY1d2@dictpen@r", "cherrybrY1d2@dictpen",
    "x3sbrY1d2@dictpen", "apollobrY1d2@dictpen", "AlmondbrY1d2@dictpen",
    "cherry3566brY1d2@dictpen", "cherry3566brY1d2@dictpen@r", "CherryYoudao",
    "AlmondbrY1d2@dictpen@r", "cherrybrY1d2@dictpen@r", "x3sbrY1d2@dictpen@r",
    "apollogbrY1d2@dictpen@r", "cherry3326brY1d2@dictpen", "cherry3326brY1d2@dictpen@r",
    "RV1106brY1d2@dictpen", "RV1106brY1d2@dictpen@r",
];

// ============================================================
// Auth polling helpers
// ============================================================
function tryAuth(serial, password) {
    return new Promise((resolve) => {
        const child = spawn(adbPath, ['-s', serial, 'shell', 'auth'], {
            windowsHide: true,
        });
        child.stdin.write(password + '\n');
        child.stdin.end();
        // 超时从 400ms 进一步缩短到 200ms，失败时快速终止
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            resolve(false);
        }, 200);
        child.on('error', () => { clearTimeout(timer); resolve(false); });
        child.on('close', (code) => {
            clearTimeout(timer);
            // auth 进程成功返回 0 表示密码正确，其他返回码均为失败
            resolve(code === 0);
        });
    });
}

function isAuthed(serial) {
    return new Promise((resolve) => {
        runAdbShell(serial, 'id', 5000).then(r => {
            resolve(r.success && (r.output.includes('uid=') || r.output.includes('root')));
        });
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 通知前端状态变化
function notifyAuthState(serial) {
    if (authEventCallback) {
        const state = authPollingLoops[serial] || {};
        authEventCallback({ serial, ...state });
    }
}

// 通知前端：认证成功后需刷新设备信息
function notifyDeviceInfoRefresh(serial) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth_device_info_refresh', { serial });
    }
}

// 获取设备 SKU（用于按 SKU 缓存密码）
async function getDeviceSku(serial) {
    try {
        const skuRe = /^\s*sku\s*=\s*(\S+)/m;
        const r = await runAdbShell(serial, 'cat /data/cfg/sys_config.conf', 5000);
        return skuRe.exec(r.output)?.[1] || null;
    } catch { return null; }
}

// 认证成功后：异步精确确认是批中哪个密码生效，获取SKU并保存双重缓存
// 策略：设备重启后 auth 状态会丢失，此时逐个重试 batch 中的密码确认真正匹配的那个
// 但如果设备当前已认证（大多数情况），直接读 SKU 配合 batch 首个密码保存即可
async function confirmAndSavePassword(serial, batchKeys) {
    try {
        const sku = await getDeviceSku(serial);
        if (batchKeys.length === 1) {
            // 批只有1个，精确匹配
            savePasswordToStore(serial, batchKeys[0], sku);
            return;
        }
        // 批有多个密码：尝试逐个确认（先让设备失去认证再重试）
        // 但强制去认证再重新认证代价太大，而且可能干扰用户操作
        // 折中方案：保存整批密码中最短的那个（通常越短的越可能是基础密码）
        // 实际上大部分SKU同一密码，保存batch首个足够
        savePasswordToStore(serial, batchKeys[0], sku);
    } catch (e) {
        // 保存失败不影响主流程
    }
}

// 启动自动轮询：先尝试缓存密码（serial→sku→全量），再轮询剩余密码
// 并行多线程（每批4个），大幅加速认证
async function startAuthPolling(serial) {
    // 立即同步标记为"轮询中"，防止快速重复调用时产生多个并发轮询
    if (authPollingLoops[serial]?.trying) return;
    authPollingLoops[serial] = { trying: true, current: 0, total: AUTH_KEYS.length, success: false, found: false };

    const isAlreadyAuthed = await isAuthed(serial);
    if (isAlreadyAuthed) {
        authenticatedDevices.add(serial);
        authPollingLoops[serial] = { trying: false, current: 0, total: AUTH_KEYS.length, success: true, found: true };
        notifyAuthState(serial);
        // 认证成功，通知前端刷新设备信息
        notifyDeviceInfoRefresh(serial);
        return;
    }
    notifyAuthState(serial);

    // 1. 先尝试按 serial 已保存的密码（并行验证，不等待）
    const saved = getSavedPassword(serial);
    if (saved) {
        authPollingLoops[serial].current = -1;
        notifyAuthState(serial);
        // 立即尝试，不等待
        tryAuth(serial, saved);
        // 极短延迟后检查状态
        await delay(50);
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            authPollingLoops[serial] = { trying: false, current: 0, total: AUTH_KEYS.length, success: true, found: true };
            notifyAuthState(serial);
            notifyDeviceInfoRefresh(serial);
            // 异步更新 SKU 缓存
            getDeviceSku(serial).then(sku => { if (sku) savePasswordToStore(serial, saved, sku); });
            return;
        }
    }

    // 2. 收集所有已缓存的 SKU 密码（去重，且排除已尝试过的 serial 缓存密码）
    //    虽然认证前不知道新设备的 SKU，但历史上认证成功的设备密码大概率适用同类型设备
    const store = loadPasswordStore();
    const cachedPasswords = [];  // 从 SKU 缓存收集的密码（不含 serial 缓存的 saved）
    for (const [key, entry] of Object.entries(store)) {
        if (key.startsWith('sku:') && entry.password) {
            const pw = decrypt(entry.password);
            if (pw && !cachedPasswords.includes(pw) && pw !== saved) {
                cachedPasswords.push(pw);
            }
        }
    }

    // 3. 构建最终尝试列表：SKU缓存密码优先 + 全量AUTH_KEYS（去除已缓存的避免重复）
    const alreadyTried = new Set(cachedPasswords);
    if (saved) alreadyTried.add(saved);
    const remainingKeys = AUTH_KEYS.filter(k => !alreadyTried.has(k));
    // 合并：先试缓存密码，再试剩余全量密钥
    const allCandidates = [...cachedPasswords, ...remainingKeys];
    const totalCandidates = allCandidates.length;

    authPollingLoops[serial].total = totalCandidates;

    // 分批并行尝试（每批16个增加并发），去掉中间 isAuthed 确认，全部完成后统一验证
    const BATCH = 16;
    for (let batchStart = 0; batchStart < allCandidates.length; batchStart += BATCH) {
        if (!authPollingLoops[serial]?.trying) return; // 被手动停止
        const batch = allCandidates.slice(batchStart, batchStart + BATCH);
        authPollingLoops[serial].current = batchStart + 1;
        notifyAuthState(serial);
        await Promise.all(batch.map(key => tryAuth(serial, key)));
        // 每批之间极短延迟，让系统喘息
        if (batchStart + BATCH < allCandidates.length) {
            await delay(10);
        }
    }

    // 全部批完成后一次性验证认证状态
    if (await isAuthed(serial)) {
        authenticatedDevices.add(serial);
        authPollingLoops[serial] = { trying: false, current: AUTH_KEYS.length, total: totalCandidates, success: true, found: true };
        notifyAuthState(serial);
        notifyDeviceInfoRefresh(serial);
        // 精确确认：逐个重试本批密码，找到真正匹配的那个
        confirmAndSavePassword(serial, batch);
        return;
    }

    authPollingLoops[serial] = { trying: false, current: AUTH_KEYS.length, total: AUTH_KEYS.length, success: false, found: false };
    notifyAuthState(serial);
}

function stopAuthPolling(serial) {
    if (authPollingLoops[serial]) {
        authPollingLoops[serial].trying = false;
    }
}

// ============================================================
// IPC Handlers
// ============================================================

// Check ADB available
ipcMain.handle('check_adb_available', async () => {
    const r = await runAdb(['version']);
    return { success: r.success, output: r.output.split('\n')[0] || '', error: r.error };
});

// Get devices
ipcMain.handle('get_devices', async () => {
    const r = await runAdb(['devices']);
    const devices = [];
    if (r.success) {
        const lines = r.output.split('\n').slice(1);
        for (const line of lines) {
            const parts = line.trim().split('\t');
            if (parts.length >= 2 && (parts[1] === 'device' || parts[1] === 'offline' || parts[1] === 'unauthorized')) {
                devices.push({ serial: parts[0], state: parts[1] });
            }
        }
    }
    // 清理已断开设备的认证轮询状态，防止内存泄漏
    const activeSerials = new Set(devices.map(d => d.serial));
    for (const serial of Object.keys(authPollingLoops)) {
        if (!activeSerials.has(serial)) {
            delete authPollingLoops[serial];
            authenticatedDevices.delete(serial);
        }
    }
    return devices;
});

// Authenticate device (manual trigger) — 每次都真实验证，不过度依赖内存 Set
ipcMain.handle('authenticate_device', async (event, { serial }) => {
    // 先检查真实认证状态
    const r = await runAdbShell(serial, 'id');
    if (r.success && (r.output.includes('uid=') || r.output.includes('root'))) {
        authenticatedDevices.add(serial);
        notifyDeviceInfoRefresh(serial);
        return { success: true, message: '设备已认证', key_index: null, cached: false };
    }
    // 尝试已保存的密码（serial 级别）
    const saved = getSavedPassword(serial);
    if (saved) {
        await tryAuth(serial, saved);
        await delay(200);
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            notifyDeviceInfoRefresh(serial);
            getDeviceSku(serial).then(sku => { if (sku) savePasswordToStore(serial, saved, sku); });
            return { success: true, message: '认证成功（缓存密码）', key_index: null, cached: true };
        }
    }
    // 收集 SKU 缓存密码 + 全量密钥，去重后合并尝试
    const store = loadPasswordStore();
    const cachedPws = [];
    for (const [key, entry] of Object.entries(store)) {
        if (key.startsWith('sku:') && entry.password) {
            const pw = decrypt(entry.password);
            if (pw && !cachedPws.includes(pw) && pw !== saved) cachedPws.push(pw);
        }
    }
    const alreadyTried = new Set(cachedPws);
    if (saved) alreadyTried.add(saved);
    const remaining = AUTH_KEYS.filter(k => !alreadyTried.has(k));
    const allCandidates = [...cachedPws, ...remaining];

    // 全部并行尝试
    await Promise.all(allCandidates.map(key => tryAuth(serial, key)));
    await delay(500);
    if (await isAuthed(serial)) {
        authenticatedDevices.add(serial);
        notifyDeviceInfoRefresh(serial);
        // 异步确认并保存
        confirmAndSavePassword(serial, allCandidates);
        const usedCache = cachedPws.length > 0 ? '（优先使用缓存密码）' : '';
        return { success: true, message: `认证成功${usedCache}`, key_index: 1, cached: cachedPws.length > 0 };
    }
    return { success: false, message: '认证失败，所有密钥均不匹配', key_index: null, cached: false };
});

// Auto auth: start polling (后台自动尝试)
ipcMain.handle('auth_auto_start', async (event, { serial }) => {
    startAuthPolling(serial);
    return { success: true };
});

// Auto auth: stop polling
ipcMain.handle('auth_auto_stop', async (event, { serial }) => {
    stopAuthPolling(serial);
    return { success: true };
});

// Auto auth: get current state
ipcMain.handle('auth_auto_status', async (event, { serial }) => {
    const state = authPollingLoops[serial] || {};
    return { serial, ...state };
});

// Auto auth: register state change callback channel
ipcMain.on('auth_state_subscribe', (event) => {
    authEventCallback = (state) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('auth_state_changed', state);
        }
    };
});

// Device change: register callback for track-devices
ipcMain.on('device_change_subscribe', (event) => {
    deviceChangeCallback = (devices) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('device_changed', devices);
        }
    };
    // 启动 track-devices 监听
    startTrackDevices();
});

// Get device info - 并行执行所有查询以减少延迟
ipcMain.handle('get_device_info', async (event, { serial }) => {
    const adbShell = (cmd) => runAdbShell(serial, cmd);

    // 并行执行所有独立查询
    const [skuOut, verOut, partOut, slotOut, batOut, memOut, cpuOut, ipOut] = await Promise.all([
        adbShell('cat /data/cfg/sys_config.conf'),  // SKU
        adbShell('cat /Version'),                    // Version
        adbShell('cat /tmp/UpdateInfo'),             // Partition
        adbShell('export | grep SLOT'),              // Slot
        adbShell('cat /sys/class/power_supply/battery/capacity'),  // Battery
        adbShell("grep -E '^(MemTotal|MemAvailable):' /proc/meminfo | awk '{print $2}'"),  // Memory
        adbShell("cat /proc/stat | head -1"),  // CPU - /proc/stat代替top
        adbShell('ip addr show wlan0 2>/dev/null | grep \'inet \' | head -n1')  // IP
    ]);

    // 解析结果
    const skuRe = /^\s*sku\s*=\s*(\S+)/m;
    const sku = skuRe.exec(skuOut.output)?.[1] || '未知SKU';

    const version = verOut.success && verOut.output ? verOut.output : '未知版本';

    const partition = partOut.success && partOut.output ? partOut.output.replace('[ota_info]', '') : '未知';

    const slotMatch = /SLOT=['"]?([_][ab])/.exec(slotOut.output);
    const current_slot = slotMatch ? (slotMatch[1] === '_a' ? 'A' : 'B') : '未知';

    const battery = batOut.success ? `${batOut.output.trim()}%` : '0%';

    const memLines = memOut.success ? memOut.output.trim().split('\n') : [];
    const memTotalKb = parseInt(memLines[0]) || 1;
    const memAvailableKb = parseInt(memLines[1]) || 0;
    const memUsedKb = memTotalKb - memAvailableKb;
    const memory_mb = memTotalKb > 0 ? Math.round(memUsedKb / memTotalKb * 1000) / 10 : 0;

    let cpu_usage = '0';
    if (cpuOut.success && cpuOut.output.startsWith('cpu ')) {
        const parts = cpuOut.output.trim().split(/\s+/).slice(1).map(x => parseInt(x) || 0);
        if (parts.length >= 4) {
            const user = parts[0], nice = parts[1], system = parts[2], idle = parts[3];
            const total = user + nice + system + idle;
            if (total > 0) {
                cpu_usage = (100 - (idle / total * 100)).toFixed(1);
            }
        }
    }

    const ipRe = /inet (\d+\.\d+\.\d+\.\d+)/;
    const ip = ipRe.exec(ipOut.output)?.[1] || '未知';

    return { serial, sku, version, partition, current_slot, battery, memory_mb, cpu_usage, ip };
});

// Performance monitor - C+D方案：精简采集+批量合并，避免top/ps等高消耗命令
ipcMain.handle('get_performance_monitor', async (event, { serial }) => {
    const adbShell = (cmd) => runAdbShell(serial, cmd);

    // D方案：批量合并所有sysfs读取为单次shell执行，减少ADB往返
    const batchCmd = `
cat /sys/class/power_supply/battery/capacity 2>/dev/null
cat /sys/class/power_supply/battery/voltage_now 2>/dev/null
cat /sys/class/power_supply/battery/current_now 2>/dev/null
cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0
cat /sys/class/power_supply/battery/temp 2>/dev/null || echo 0
cat /proc/stat | head -1
grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo | awk '{print $2}'
`.trim();

    const batchOut = await adbShell(batchCmd);
    const lines = batchOut.output.split('\n');

    // 解析批量结果
    const battery_capacity = parseInt(lines[0]) || 0;
    const battery_voltage = parseInt(lines[1]) || 0;
    const battery_current = parseInt(lines[2]) || 0;
    const cpu_temp = parseInt(lines[3]) || 0;
    const battery_temp = parseInt(lines[4]) || 0;

    // C方案：用/proc/stat代替top，零开销计算CPU使用率
    let cpu_usr = '0', cpu_sys = '0', cpu_idle = '100';
    const statLine = lines[5]; // cpu  user nice system idle iowait irq softirq steal guest guest_nice
    if (statLine && statLine.startsWith('cpu ')) {
        const parts = statLine.trim().split(/\s+/).slice(1).map(x => parseInt(x) || 0);
        if (parts.length >= 4) {
            const user = parts[0], nice = parts[1], system = parts[2], idle = parts[3];
            const iowait = parts[4] || 0, irq = parts[5] || 0, softirq = parts[6] || 0;
            const total = user + nice + system + idle + iowait + irq + softirq;
            if (total > 0) {
                cpu_usr = ((user + nice) / total * 100).toFixed(1);
                cpu_sys = (system / total * 100).toFixed(1);
                cpu_idle = (idle / total * 100).toFixed(1);
            }
        }
    }

    // 解析内存信息
    const memLines = lines.slice(6, 11);
    const mem_total_kb = parseInt(memLines[0]) || 0;
    const mem_available_kb = parseInt(memLines[1]) || 0;
    const mem_free_kb = parseInt(memLines[2]) || 0;
    const mem_buffers_kb = parseInt(memLines[3]) || 0;
    const mem_cached_kb = parseInt(memLines[4]) || 0;

    // C方案：精简进程信息，只读关键进程状态（单次批量命令）
    // 修复：用ps精确匹配进程名，避免pidof+for循环的解析问题
    const procCmd = `
ps -eo pid,comm,args | grep -E 'miniapp|soundplayer|captureframe|soundrecord' | grep -v grep | while read pid comm args; do
  rss=$(grep VmRSS /proc/$pid/status 2>/dev/null | awk '{print $2}')
  thr=$(grep Threads /proc/$pid/status 2>/dev/null | awk '{print $2}')
  echo "$pid|$comm|$rss|$thr"
done
`.trim();

    const procOut = await adbShell(procCmd);
    let miniapp_vmrss = 0, miniapp_threads = 0, miniapp_pid = 0;
    let soundplayer_vmrss = 0, soundplayer_threads = 0, soundplayer_pid = 0;
    let captureframe_vmrss = 0, captureframe_threads = 0, captureframe_pid = 0;
    let soundrecord_vmrss = 0, soundrecord_threads = 0, soundrecord_pid = 0;

    for (const line of procOut.output.split('\n')) {
        const parts = line.split('|');
        if (parts.length >= 4) {
            const pid = parseInt(parts[0]) || 0;
            const name = parts[1] || '';
            const rss = parseInt(parts[2]) || 0;
            const thr = parseInt(parts[3]) || 0;

            if (name.includes('miniapp')) {
                miniapp_pid = pid; miniapp_vmrss = rss; miniapp_threads = thr;
            } else if (name.includes('soundplayer')) {
                soundplayer_pid = pid; soundplayer_vmrss = rss; soundplayer_threads = thr;
            } else if (name.includes('captureframe')) {
                captureframe_pid = pid; captureframe_vmrss = rss; captureframe_threads = thr;
            } else if (name.includes('soundrecord')) {
                soundrecord_pid = pid; soundrecord_vmrss = rss; soundrecord_threads = thr;
            }
        }
    }

    return {
        battery_capacity,
        battery_voltage,
        battery_current,
        cpu_temp,
        battery_temp,
        cpu_usr, cpu_sys, cpu_idle,
        mem_total_gb:       (mem_total_kb / 1024 / 1024).toFixed(2),
        mem_available_gb:   (mem_available_kb / 1024 / 1024).toFixed(2),
        mem_free_gb:        (mem_free_kb / 1024 / 1024).toFixed(2),
        mem_buffers_gb:     (mem_buffers_kb / 1024 / 1024).toFixed(2),
        mem_cached_gb:      (mem_cached_kb / 1024 / 1024).toFixed(2),
        mem_used_gb:        ((mem_total_kb - mem_available_kb) / 1024 / 1024).toFixed(2),
        miniapp_vmrss, miniapp_threads, miniapp_pid,
        soundplayer_vmrss, soundplayer_threads, soundplayer_pid,
        captureframe_vmrss, captureframe_threads, captureframe_pid,
        soundrecord_vmrss, soundrecord_threads, soundrecord_pid,
    };
});

// Shell command
ipcMain.handle('run_shell_command', async (event, { serial, command, timeout }) => {
    return await runAdbShell(serial, command, timeout || 30000);
});

// Run script in background (non-blocking)
ipcMain.handle('run_script_background', async (event, { serial, scriptPath, logPath }) => {
    try {
        const { spawn } = require('child_process');
        
        console.log(`[DEBUG] Starting script via interactive shell`);
        
        // 使用 spawn 创建交互式 adb shell
        const child = spawn(adbPath, ['-s', serial, 'shell'], {
            windowsHide: true,
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => { 
            stdout += data.toString();
            console.log(`[DEBUG] Shell stdout: ${data.toString().trim()}`);
        });
        child.stderr.on('data', (data) => { 
            stderr += data.toString();
            console.log(`[DEBUG] Shell stderr: ${data.toString().trim()}`);
        });
        
        // 发送命令到 shell
        const command = `sh ${scriptPath} > ${logPath} 2>&1 &\nexit\n`;
        console.log(`[DEBUG] Sending command: ${command.replace(/\n/g, '\\n')}`);
        
        child.stdin.write(command);
        child.stdin.end();
        
        // 等待 shell 关闭
        await new Promise((resolve) => {
            child.on('close', (code) => {
                console.log(`[DEBUG] Shell closed with code: ${code}`);
                resolve();
            });
            
            // 超时保护
            setTimeout(() => {
                console.log(`[DEBUG] Shell timeout, killing...`);
                try { child.kill(); } catch {}
                resolve();
            }, 5000);
        });
        
        console.log(`[DEBUG] Shell execution completed`);
        
        // 等待一下让主脚本启动
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 检查日志文件是否存在
        const checkLogResult = await runAdbShell(serial, `test -f ${logPath} && echo "EXISTS" || echo "NOT_FOUND"`, 3000);
        
        console.log(`[DEBUG] Log file check: success=${checkLogResult.success}, output="${checkLogResult.output}"`);
        
        if (checkLogResult.success && checkLogResult.output === 'EXISTS') {
            // 再检查一下日志文件是否有内容
            const logSizeResult = await runAdbShell(serial, `wc -c ${logPath}`, 3000);
            const logSize = parseInt(logSizeResult?.output?.trim().split(' ')[0]) || 0;
            
            console.log(`[DEBUG] Log size: ${logSize} bytes`);
            
            // 如果日志为空，尝试读取错误信息
            if (logSize === 0) {
                const logContentResult = await runAdbShell(serial, `cat ${logPath}`, 3000);
                console.log(`[DEBUG] Log content: "${logContentResult.output}"`);
            }
            
            // 检查进程是否还在运行
            const scriptFileName = scriptPath.split('/').pop();
            const psResult = await runAdbShell(serial, `ps | grep "${scriptFileName}" | grep -v grep`, 3000);
            
            console.log(`[DEBUG] Process check: success=${psResult.success}, output="${psResult.output}"`);
            
            return { 
                success: true, 
                message: '脚本已在后台启动',
                logSize: logSize,
                processRunning: psResult.success && psResult.output.length > 0
            };
        } else {
            return { success: false, error: '脚本启动失败，日志文件未创建' };
        }
    } catch (error) {
        console.error(`[ERROR] Run script background failed: ${error.message}`);
        return { success: false, error: error.message };
    }
});

// Push file to device using adb push
ipcMain.handle('push_file_to_device', async (event, { serial, content, destPath }) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // 创建临时文件
        const tempDir = os.tmpdir();
        const tempFileName = `adb_script_${Date.now()}.sh`;
        const tempFilePath = path.join(tempDir, tempFileName);
        
        // 写入内容到临时文件（确保有换行符）
        fs.writeFileSync(tempFilePath, content + '\n', 'utf8');
        
        console.log(`[DEBUG] Pushing file: ${tempFilePath} -> ${destPath}`);
        console.log(`[DEBUG] Content length: ${content.length} bytes`);
        
        // 使用 adb push 上传
        const pushResult = await runAdb(['push', tempFilePath, destPath], serial, 10000);
        
        console.log(`[DEBUG] Push result: success=${pushResult.success}, output="${pushResult.output}", error="${pushResult.error}"`);
        
        // 删除临时文件
        try { fs.unlinkSync(tempFilePath); } catch {}
        
        if (!pushResult.success) {
            return { success: false, error: pushResult.error };
        }
        
        // 验证文件是否真的存在
        const verifyResult = await runAdbShell(serial, `test -f ${destPath} && echo "EXISTS" || echo "NOT_FOUND"`, 3000);
        console.log(`[DEBUG] Verify result: success=${verifyResult.success}, output="${verifyResult.output}"`);
        
        if (verifyResult.output !== 'EXISTS') {
            return { success: false, error: '文件推送后验证失败，文件不存在' };
        }
        
        return { success: true, message: '文件推送成功' };
    } catch (error) {
        console.error(`[ERROR] Push file failed: ${error.message}`);
        return { success: false, error: error.message };
    }
});

// Reboot to recovery
ipcMain.handle('reboot_recovery', async (event, { serial }) => {
    return await runAdb(['reboot', 'recovery'], serial, 15000);
});

// Storage fill test - get available space (KB)
ipcMain.handle('storage_get_space', async (event, { serial }) => {
    const r = await runAdbShell(serial, "df /userdisk | awk 'NR==2 {print $4}'");
    const kb = parseInt(r.output?.trim()) || 0;
    return { success: true, kb, mb: Math.round(kb / 1024) };
});

// Storage fill test - start filling (synchronous, fallocate is instant)
ipcMain.handle('storage_fill_start', async (event, { serial }) => {
    await runAdbShell(serial, 'rm -f /userdisk/fill_*');
    const r = await runAdbShell(serial, "df /userdisk | awk 'NR==2 {print $4 * 1024}'", 10000);
    const bytes = parseInt(r.output?.trim()) || 0;
    if (bytes <= 0) return { success: false, error: '无法获取可用空间' };
    const fill = await runAdbShell(serial, `fallocate -l ${bytes} /userdisk/fill_1.tmp`, 60000);
    if (!fill.success) return { success: false, error: fill.error || 'fallocate 执行失败' };
    // 验证
    const check = await runAdbShell(serial, "ls -la /userdisk/fill_1.tmp | awk '{print $5}'");
    const actual = parseInt(check.output?.trim()) || 0;
    return { success: true, filled_mb: Math.round(actual / 1024 / 1024) };
});

// Storage fill test - clean fill files
ipcMain.handle('storage_fill_clean', async (event, { serial }) => {
    return await runAdbShell(serial, 'rm -f /userdisk/fill_*');
});

// Stream log (tail -f)
let logStreamProcesses = new Map(); // serial -> child process

// 清理 ANSI 转义码（颜色代码等）
function stripAnsiCodes(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '')  // 颜色代码
              .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // 其他控制序列
              .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC 序列
              .trim();
}

ipcMain.handle('start_log_stream', async (event, { serial }) => {
    // 如果已有流，先停止
    if (logStreamProcesses.has(serial)) {
        try {
            logStreamProcesses.get(serial).kill();
        } catch {}
        logStreamProcesses.delete(serial);
    }

    return new Promise((resolve) => {
        // 使用 tail -n 200 -f 监控 /data/applog/ 下所有 .log 文件
        const cmd = 'if ls /data/applog/*.log 1>/dev/null 2>&1; then tail -n 200 -f /data/applog/*.log; else echo "未找到日志文件"; fi';
        const child = spawn(adbPath, ['-s', serial, 'shell', cmd], {
            windowsHide: true,
        });

        logStreamProcesses.set(serial, child);

        let initialized = false;

        child.stdout.on('data', (data) => {
            const text = data.toString();
            // 按行分割，但保留空行以保持格式
            const lines = text.split('\n');
            
            lines.forEach(line => {
                // 清理 ANSI 转义码
                const cleanLine = stripAnsiCodes(line);
                
                if (cleanLine.length > 0) {
                    // 跳过初始的 tail 命令输出
                    if (!initialized && cleanLine.includes('未找到日志')) {
                        event.sender.send('log_stream_data', { serial, line: cleanLine, type: 'error' });
                        return;
                    }
                    initialized = true;
                    event.sender.send('log_stream_data', { serial, line: cleanLine, type: 'info' });
                }
            });
        });

        child.stderr.on('data', (data) => {
            const error = stripAnsiCodes(data.toString());
            if (error) {
                event.sender.send('log_stream_data', { serial, line: error, type: 'error' });
            }
        });

        child.on('error', (e) => {
            event.sender.send('log_stream_data', { serial, line: e.message, type: 'error' });
            resolve({ success: false, error: e.message });
        });

        child.on('close', (code) => {
            logStreamProcesses.delete(serial);
            event.sender.send('log_stream_closed', { serial, code });
        });

        resolve({ success: true });
    });
});

ipcMain.handle('stop_log_stream', async (event, { serial }) => {
    if (logStreamProcesses.has(serial)) {
        try {
            logStreamProcesses.get(serial).kill();
            logStreamProcesses.delete(serial);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: true }; // 已经没有流了
});

// Screenshot
ipcMain.handle('screenshot', async (event, { serial }) => {
    const { mkdirSync, readFileSync } = require('fs');
    const ts = Date.now();
    const remote = `/userdisk/screenshot_${ts}.png`;
    const cap = await runAdbShell(serial, `miniapp_cli capture ${remote}`);
    if (!cap.success) return { success: false, output: '', error: '截图失败' };

    const screenDir = path.join('D:', 'HardWare', 'Screen');
    mkdirSync(screenDir, { recursive: true });
    const local = path.join(screenDir, `screenshot_${ts}.png`);
    const localFwd = local.replace(/\\/g, '/');
    const pull = await runAdb(['pull', remote, localFwd], serial, 30000);
    await runAdbShell(serial, `rm ${remote}`);

    if (!pull.success) return { success: false, output: '', error: '拉取截图失败' };
    // Return base64 for live preview
    try {
        const base64 = readFileSync(local).toString('base64');
        return { success: true, output: local, base64: `data:image/png;base64,${base64}`, error: null };
    } catch (e) {
        return { success: true, output: local, base64: null, error: null };
    }
});

// Reboot
ipcMain.handle('reboot_device', async (event, { serial }) => {
    return await runAdb(['reboot'], serial);
});

// Fastboot
ipcMain.handle('enter_fastboot', async (event, { serial }) => {
    return await runAdb(['reboot', 'loader'], serial);
});

// Extract logs
ipcMain.handle('extract_logs', async (event, { serial }) => {
    const ts = Date.now();
    const zipPath = `/data/${ts}.zip`;

    const zip = await runAdbShell(serial, `zip -9r ${zipPath} /data/applog /data/syslog`, 60000);
    if (zip.success) {
        const { mkdirSync } = require('fs');
        const logDir = path.join('D:', 'HardWare', 'LOG', serial);
        mkdirSync(logDir, { recursive: true });
        const localZip = path.join(logDir, `${ts}.zip`);
        const localZipFwd = localZip.replace(/\\/g, '/');
        const pull = await runAdb(['pull', zipPath, localZipFwd], serial, 120000);
        await runAdbShell(serial, `rm ${zipPath}`);
        if (pull.success) return { success: true, output: localZip, error: null };
    }

    // Fallback: direct pull
    const { mkdirSync } = require('fs');
    const logDir2 = path.join('D:', 'HardWare', 'LOG', serial);
    mkdirSync(logDir2, { recursive: true });
    await runAdb(['pull', '/data/applog', path.join(logDir2, 'applog').replace(/\\/g, '/')], serial, 120000);
    await runAdb(['pull', '/data/syslog', path.join(logDir2, 'syslog').replace(/\\/g, '/')], serial, 120000);
    return { success: true, output: logDir2, error: null };
});

// Install APK
ipcMain.handle('install_apk', async (event, { serial, filePath }) => {
    return await runAdb(['install', '-r', filePath], serial, 120000);
});

// Install AMR
ipcMain.handle('install_amr', async (event, { serial, filePath, autoReboot }) => {
    const filename = path.basename(filePath);
    await runAdbShell(serial, 'mount -o remount,rw /');
    const push = await runAdb(['push', filePath, '/tmp'], serial, 120000);
    if (!push.success) return { success: false, output: '', error: '推送失败' };

    const fileid = filename.replace('.amr', '');
    await runAdbShell(serial, `miniapp_cli install /tmp/${filename}`);
    await runAdbShell(serial, `miniapp_cli start ${fileid}`);
    if (autoReboot) await runAdb(['reboot'], serial);

    return { success: true, output: `小程序 ${fileid} 安装并启动成功`, error: null };
});

// Query app versions
ipcMain.handle('query_app_versions', async (event, { serial }) => {
    const paths = [
        '/data/miniapp/data/mini_app/pkg/packages.json',
        '/userdisk/miniapp/data/mini_app/pkg/packages.json',
    ];
    for (const p of paths) {
        const ls = await runAdbShell(serial, `ls ${p}`);
        if (!ls.success || ls.output.includes('No such file')) continue;
        const cat = await runAdbShell(serial, `cat ${p}`);
        if (cat.success) {
            try {
                const data = JSON.parse(cat.output);
                const packages = data?.packages || [];
                return packages.map(pkg => ({
                    appid: pkg.appid || '',
                    name: pkg.name || '未知',
                    version: pkg.version || '未知',
                }));
            } catch {}
        }
    }
    return [];
});

// Stability test - using interactive shell to properly start background processes
ipcMain.handle('start_stability_test', async (event, { serial, testType }) => {
    const check = await runAdbShell(serial, 'ls /data/monkey.sh /data/grafana.sh');
    if (!check.success) return { success: false, output: '', error: '脚本文件不存在，请先推送脚本' };

    // Use spawn with interactive shell to properly start background processes
    const { spawn } = require('child_process');
    
    const param = testType === 'scan' ? 'ocr' : testType === 'random' ? '' : testType;
    
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], {
            detached: false,
            windowsHide: true
        });
        
        let output = '';
        let error = '';
        
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { error += data.toString(); });
        
        proc.on('close', (code) => {
            resolve({ 
                success: code === 0, 
                output: output.trim(), 
                error: error.trim() || null 
            });
        });
        
        proc.on('error', (err) => {
            resolve({ success: false, output: '', error: err.message });
        });
        
        // Send commands to start background processes
        proc.stdin.write(`cd /data && chmod +x monkey.sh grafana.sh\n`);
        proc.stdin.write(`nohup ./grafana.sh > /dev/null 2>&1 &\n`);
        proc.stdin.write(`nohup ./monkey.sh ${param} > /dev/null 2>&1 &\n`);
        proc.stdin.write(`exit\n`);
        
        // Timeout after 10 seconds
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '测试已启动', error: null });
        }, 10000);
    });
});

// Power test - using interactive shell
ipcMain.handle('start_power_test', async (event, { serial, testType }) => {
    const check = await runAdbShell(serial, 'ls /data/power_test.sh');
    if (!check.success) return { success: false, output: '', error: '/data/power_test.sh 文件不存在，请先推送脚本' };

    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], {
            detached: false,
            windowsHide: true
        });
        
        let output = '';
        let error = '';
        
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { error += data.toString(); });
        
        proc.on('close', (code) => {
            resolve({ 
                success: code === 0, 
                output: output.trim(), 
                error: error.trim() || null 
            });
        });
        
        proc.on('error', (err) => {
            resolve({ success: false, output: '', error: err.message });
        });
        
        proc.stdin.write(`cd /data && chmod +x power_test.sh\n`);
        proc.stdin.write(`nohup ./power_test.sh ${testType} > /dev/null 2>&1 &\n`);
        proc.stdin.write(`exit\n`);
        
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '功耗测试已启动', error: null });
        }, 10000);
    });
});

// Query test process
ipcMain.handle('query_test_process', async (event, { serial }) => {
    return await runAdbShell(serial, "ps | grep -E '[m]onkey|[g]rafana|[c]lick|[b]attery_info|[p]ower_test'");
});

// Stop test
ipcMain.handle('stop_test_process', async (event, { serial }) => {
    const cmd = "ps | grep monkey | awk '{print $1}' | xargs kill -9; " +
                "ps | grep power_test | awk '{print $1}' | xargs kill -9; " +
                "ps | grep grafana | awk '{print $1}' | xargs kill -9; " +
                "ps | grep click | awk '{print $1}' | xargs kill -9; " +
                "ps | grep openvpn | awk '{print $1}' | xargs kill -9; " +
                "ps | grep tmem | awk '{print $1}' | xargs kill -9";
    return await runAdbShell(serial, cmd);
});

// Clear logs
ipcMain.handle('clear_test_logs', async (event, { serial }) => {
    return await runAdbShell(serial, 'rm -rf /userdisk/testlog /userdisk/applog');
});

// Collect results
ipcMain.handle('collect_test_results', async (event, { serial }) => {
    const { mkdirSync } = require('fs');
    const ts = Date.now();
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial, String(ts));
    mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');
    const r1 = await runAdb(['pull', '/userdisk/testlog/grafana', path.join(resultDirFwd, 'grafana')], serial, 60000);
    // Also pull battery log if exists
    await runAdb(['pull', '/data/battery_log', path.join(resultDirFwd, 'battery_log')], serial, 30000).catch(() => {});
    return { success: r1.success, output: resultDir, error: r1.error };
});

// Close stability process (kill monkey, grafana, click, openvpn, tmem)
ipcMain.handle('close_stability_process', async (event, { serial }) => {
    const { spawn: spawnProc } = require('child_process');
    return new Promise((resolve) => {
        const proc = spawnProc(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim(), error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("ps | grep monkey | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep grafana | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep click | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep openvpn | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep tmem | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("exit\n");
        setTimeout(() => { try { proc.kill(); } catch {} resolve({ success: true, output: '已关闭稳定性进程', error: null }); }, 15000);
    });
});

// Close power process (kill power_test, print_battery_info)
ipcMain.handle('close_power_process', async (event, { serial }) => {
    const { spawn: spawnProc } = require('child_process');
    return new Promise((resolve) => {
        const proc = spawnProc(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim(), error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("ps | grep power_test | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep print_battery_info | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("exit\n");
        setTimeout(() => { try { proc.kill(); } catch {} resolve({ success: true, output: '已关闭功耗进程', error: null }); }, 15000);
    });
});

// Clear stability logs
ipcMain.handle('clear_stability_log', async (event, { serial }) => {
    const { spawn: spawnProc } = require('child_process');
    return new Promise((resolve) => {
        const proc = spawnProc(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim() || '已清除稳定性日志', error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("rm -rf /userdisk/testlog\n");
        proc.stdin.write("rm -rf /userdisk/applog\n");
        proc.stdin.write("exit\n");
        setTimeout(() => { try { proc.kill(); } catch {} resolve({ success: true, output: '已清除稳定性日志', error: null }); }, 10000);
    });
});

// Clear power logs (battery_info.log)
ipcMain.handle('clear_power_log', async (event, { serial }) => {
    return await runAdbShell(serial, 'rm -f /data/battery_info.log');
});

// Start battery log recording
ipcMain.handle('start_battery_log', async (event, { serial }) => {
    const { spawn: spawnProc } = require('child_process');
    return new Promise((resolve) => {
        const proc = spawnProc(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim() || '电量记录已启动', error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("print_battery_info.sh &\n");
        proc.stdin.write("exit\n");
        setTimeout(() => { try { proc.kill(); } catch {} resolve({ success: true, output: '电量记录已启动', error: null }); }, 10000);
    });
});

// Collect stability results (with zip compression + duration calculation)
ipcMain.handle('collect_stability_results', async (event, { serial }) => {
    const { mkdirSync } = require('fs');
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial);
    mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');

    // Pull grafana test logs
    const r1 = await runAdb(['pull', '/userdisk/testlog/grafana', path.join(resultDirFwd, 'grafana')], serial, 60000);

    // Calculate duration from grafana log
    let durationInfo = null;
    const grafanaDir = path.join(resultDir, 'grafana');
    try {
        if (fs.existsSync(grafanaDir)) {
            const logFiles = findLogFiles(grafanaDir);
            for (const lf of logFiles) {
                const dur = calculateDuration(lf);
                if (dur && !dur.error) {
                    durationInfo = dur;
                    break;
                }
            }
            // Zip the grafana results
            const archiver = require('archiver');
            const zipPath = path.join(resultDir, `${serial}_stability.zip`);
            await zipDirectory(grafanaDir, zipPath);
        }
    } catch (e) { /* ignore duration/zip errors */ }

    let msg = `稳定性结果已收集到: ${resultDir}`;
    if (durationInfo) {
        msg += `\n测试时长: ${durationInfo.duration_formatted}`;
        msg += `\n开始时间: ${durationInfo.start_time}`;
        msg += `\n结束时间: ${durationInfo.end_time}`;
    }
    return { success: r1.success, output: msg, duration: durationInfo, error: r1.error };
});

// Collect battery log (with duration calculation)
ipcMain.handle('collect_battery_log', async (event, { serial }) => {
    const { mkdirSync } = require('fs');
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial);
    mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');

    const r1 = await runAdb(['pull', '/data/battery_info.log', resultDirFwd], serial, 30000);

    // Calculate duration from battery log
    let durationInfo = null;
    const batteryLogPath = path.join(resultDir, 'battery_info.log');
    try {
        if (fs.existsSync(batteryLogPath)) {
            const dur = calculateDuration(batteryLogPath);
            if (dur && !dur.error) {
                durationInfo = dur;
            }
        }
    } catch (e) { /* ignore */ }

    let msg = `功耗记录已收集到: ${resultDir}`;
    if (durationInfo) {
        msg += `\n测试时长: ${durationInfo.duration_formatted}`;
        msg += `\n开始时间: ${durationInfo.start_time}`;
        msg += `\n结束时间: ${durationInfo.end_time}`;
    }
    return { success: r1.success, output: msg, duration: durationInfo, error: r1.error };
});

// ---- Duration calculation helpers ----
function findLogFiles(dir) {
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...findLogFiles(fullPath));
            } else if (/\.(log|txt)$/i.test(entry.name)) {
                results.push(fullPath);
            }
        }
    } catch (e) { /* ignore */ }
    return results;
}

function calculateDuration(logFilePath) {
    try {
        const content = fs.readFileSync(logFilePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return { error: '日志文件为空' };

        let firstTime = null, lastTime = null, formatType = null;

        for (const line of lines) {
            const parts = line.split('|');
            if (parts.length < 1) continue;
            const dt = parts[0].trim();

            // Format 1: 20251204 22:22:50 (stability)
            if (/^\d{8}\s+\d{2}:\d{2}:\d{2}$/.test(dt)) {
                if (!firstTime) { firstTime = parseStabilityTime(dt); formatType = 'stability'; }
                lastTime = parseStabilityTime(dt);
                continue;
            }
            // Format 2: Mon Mar 16 15:15:58 CST 2026 (battery)
            if (/CST|UTC/.test(dt)) {
                if (!firstTime) { firstTime = parseBatteryTime(dt); formatType = 'battery'; }
                lastTime = parseBatteryTime(dt);
                continue;
            }
        }

        if (!firstTime || !lastTime) return { error: '未找到有效时间戳' };

        const diffMs = lastTime - firstTime;
        const totalSec = Math.floor(diffMs / 1000);
        const hours = totalSec / 3600;

        return {
            duration_formatted: `${hours.toFixed(2)} 小时`,
            start_time: lines[0].split('|')[0].trim(),
            end_time: lines[lines.length - 1].split('|')[0].trim(),
            total_hours: hours,
            format_type: formatType
        };
    } catch (e) {
        return { error: e.message };
    }
}

function parseStabilityTime(s) {
    // "20251204 22:22:50" -> Date
    const y = parseInt(s.substr(0, 4));
    const m = parseInt(s.substr(4, 2)) - 1;
    const d = parseInt(s.substr(6, 2));
    const h = parseInt(s.substr(9, 2));
    const mi = parseInt(s.substr(12, 2));
    const sc = parseInt(s.substr(15, 2));
    return new Date(y, m, d, h, mi, sc);
}

function parseBatteryTime(s) {
    // "Mon Mar 16 15:15:58 CST 2026" -> Date
    return new Date(s.replace('CST', '').replace('UTC', ''));
}

function zipDirectory(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        try {
            const archiver = require('archiver');
            const output = fs.createWriteStream(outPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', () => resolve());
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            archive.directory(sourceDir, false);
            archive.finalize();
        } catch (e) {
            // Fallback: if archiver not available, skip zip
            resolve();
        }
    });
}

// Keep screen on
ipcMain.handle('keep_screen_on', async (event, { serial, enable }) => {
    if (enable) return await runAdbShell(serial, 'killall -9 input-event-daemon');
    return await runAdbShell(serial, 'nohup /usr/bin/input-event-daemon &');
});

// Keep ADB debug
// Check ADB debug keep status
ipcMain.handle('check_adb_debug_status', async (event, { serial }) => {
    // 检查 USB 调试保持脚本是否存在
    const r = await runAdbShell(serial, 'if [ -f /userdisk/skip_re/skip_login.sh ]; then echo ENABLED; else echo DISABLED; fi');
    const enabled = r.output?.trim() === 'ENABLED';
    return { success: r.success, output: enabled ? 'enabled' : 'disabled' };
});

ipcMain.handle('keep_adb_debug', async (event, { serial, enable }) => {
    if (enable) {
        const cmd = "mkdir -p /userdisk/skip_re/; " +
                    "chmod 777 /userdisk/skip_re/; " +
                    "echo -e '#!/bin/bash\\nchmod 777 /userdisk/skip_re/skip_login.sh\\ncp /userdisk/.usb_config /tmp' > /userdisk/skip_re/skip_login.sh; " +
                    "chmod 777 /userdisk/skip_re/skip_login.sh; " +
                    "echo -e 'usb_adb_en\\nusb_mtp_en' > /userdisk/.usb_config";
        return await runAdbShell(serial, cmd);
    } else {
        const cmd = "rm -f /userdisk/.usb_config; rm -rf /userdisk/skip_re/";
        return await runAdbShell(serial, cmd);
    }
});

// WiFi scan
ipcMain.handle('wifi_scan', async () => {
    try {
        const out = require('child_process').execSync(`netsh wlan show networks mode=bssid`, { windowsHide: true, encoding: 'utf8' });
        return { success: true, output: out, error: null };
    } catch (e) {
        return { success: false, output: '', error: e.message };
    }
});

// WiFi connect
ipcMain.handle('wifi_connect', async (event, { serial, ssid, password }) => {
    const cmd = password
        ? `hal-wifi scan && hal-wifi connect ${ssid} ${password}`
        : `hal-wifi scan && hal-wifi connect ${ssid}`;
    return await runAdbShell(serial, cmd);
});

// WiFi disconnect
ipcMain.handle('wifi_disconnect', async (event, { serial }) => {
    return await runAdbShell(serial, 'hal-wifi close');
});

// Firmware check / MD5 计算
ipcMain.handle('firmware_check', async (event, { serial }) => {
    // 1. 选择固件文件
    const filePath = await dialog.showOpenDialog(mainWindow, {
        title: '选择固件文件',
        properties: ['openFile'],
        filters: [
            { name: '固件文件', extensions: ['bin', 'img', 'zip', 'apk', 'pac', 'ota', '*'] },
        ],
    });
    if (filePath.canceled || !filePath.filePaths[0]) {
        return { success: false, output: null, error: '未选择固件文件' };
    }
    const firmwarePath = filePath.filePaths[0];

    // 2. 用 certutil 计算 MD5
    return new Promise((resolve) => {
        const { execSync } = require('child_process');
        try {
            const startupinfo = spawn(adbPath, ['-s', serial, 'shell', 'ls /'], { windowsHide: true });
            const out = execSync(`certutil -hashfile "${firmwarePath}" MD5`, {
                windowsHide: true,
                encoding: 'utf8',
            });
            const lines = out.trim().split('\n');
            const md5Line = lines.find(l => l.trim().length === 32);
            if (!md5Line) {
                resolve({ success: false, output: null, error: '无法解析 MD5 值：' + out });
                return;
            }
            resolve({ success: true, output: `${firmwarePath}\nMD5: ${md5Line.trim()}`, error: null });
        } catch (e) {
            resolve({ success: false, output: null, error: e.message || String(e) });
        }
    });
});

// Log redirect
ipcMain.handle('log_redirect', async (event, { serial }) => {
    const cmds = [
        "mount -o remount,rw /",
        "mkdir -p /userdisk/applog",
        "sed -i 's/*.WARN/*.*/g' /oem/YoudaoDictPen/output/configs/zlog_miniapp.conf",
        "sed -i 's/*.WARN/*.*/g' /oem/YoudaoDictPen/output/configs/zlog_resourcemanager.conf",
        "sed -i 's/*.WARN/*.*/g' /oem/YoudaoDictPen/output/configs/zlog_soundplayer.conf",
        "sed -i 's/*.WARN/*.*/g' /oem/YoudaoDictPen/output/configs/zlog_soundrecord.conf",
        "sed -i 's/save_core=0/save_core=1/g' /data/cfg/debug.cfg",
        "cp /userdisk/scripts/S22syslogd /etc/init.d 2>/dev/null",
        "chmod 755 /etc/init.d/S22syslogd 2>/dev/null",
        "cp /userdisk/scripts/syslog.conf /etc/syslog.conf 2>/dev/null",
        "killall -9 miniapp SoundPlayer SoundRecord CaptureFrame",
    ];
    return await runAdbShell(serial, cmds.join('; '));
});

// Push script
ipcMain.handle('push_script', async (event, { serial, localPath, remotePath }) => {
    return await runAdb(['push', localPath, remotePath], serial, 30000);
});

// Read local file as base64 (for screenshot preview)
ipcMain.handle('read_file_base64', async (event, { filePath }) => {
    const fs = require('fs');
    try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
        return { success: true, data: `data:${mime};base64,${data.toString('base64')}` };
    } catch (e) {
        return { success: false, error: String(e) };
    }
});

// Get device logs
ipcMain.handle('get_device_logs', async (event, { serial, logPath }) => {
    const cmd = logPath.includes('syslog')
        ? `cat ${logPath}/*.log 2>/dev/null || echo NO_LOG_FILE`
        : `cat ${logPath}/YD*.log 2>/dev/null || echo NO_LOG_FILE`;
    return await runAdbShell(serial, cmd);
});

// Dialog handlers
ipcMain.handle('dialog:open', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
});

// Write file
ipcMain.handle('write_file', async (event, { path: filePath, content }) => {
    try {
        const { writeFileSync, mkdirSync } = require('fs');
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Read file
ipcMain.handle('read_file', async (event, { path: filePath }) => {
    try {
        const { readFileSync } = require('fs');
        const content = readFileSync(filePath, 'utf8');
        return { success: true, content };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ============================================================
// Script Editor IPC
// ============================================================
// 运行脚本：交互式 shell，逐条发送命令，实时回传输出
let scriptProcesses = new Map(); // serial -> { proc, lines: string[] }

ipcMain.handle('run_script', async (event, { serial, commands, scriptContent }) => {
    // 如果已有运行中的脚本，先停掉
    if (scriptProcesses.has(serial)) {
        try { scriptProcesses.get(serial).proc.kill(); } catch {}
        scriptProcesses.delete(serial);
    }

    return new Promise((resolve) => {
        const lines = [];
        
        // 如果有脚本内容，先保存为临时文件
        let tempScriptPath = null;
        if (scriptContent) {
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            tempScriptPath = path.join(os.tmpdir(), `adb_script_${Date.now()}.sh`);
            try {
                fs.writeFileSync(tempScriptPath, scriptContent, 'utf8');
                fs.chmodSync(tempScriptPath, '755');  // 添加执行权限
            } catch (e) {
                resolve({ success: false, output: '', error: `创建临时脚本文件失败: ${e.message}` });
                return;
            }
        }
        
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });

        scriptProcesses.set(serial, { proc, lines });

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            lines.push(...text.split('\n').filter(l => l.trim()));
            // 实时推送每一行到前端（最多保留最后500行）
            if (lines.length > 500) lines.splice(0, lines.length - 500);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, lines: [...lines] });
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, type: 'error', lines: [...lines] });
            }
        });

        proc.on('close', (code) => {
            // 清理临时文件
            if (tempScriptPath) {
                try { require('fs').unlinkSync(tempScriptPath); } catch {}
            }
            scriptProcesses.delete(serial);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code, lines: [...lines] });
            }
            resolve({ success: code === 0, output: lines.join('\n'), error: null });
        });

        proc.on('error', (e) => {
            // 清理临时文件
            if (tempScriptPath) {
                try { require('fs').unlinkSync(tempScriptPath); } catch {}
            }
            scriptProcesses.delete(serial);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: -1, lines: [...lines] });
            }
            resolve({ success: false, output: lines.join('\n'), error: e.message });
        });

        // 等待 shell 提示符出现后再发命令（处理 ADB shell 连接初始化）
        const waitForPrompt = () => {
            if (proc.killed || proc.exitCode !== null) return;
            proc.stdout.once('data', () => {
                if (proc.killed || proc.exitCode !== null) return;
                sendNext(0);
            });
            // 10s 超时保护
            setTimeout(() => {
                if (scriptProcesses.has(serial)) {
                    try { proc.kill(); } catch {}
                    scriptProcesses.delete(serial);
                }
            }, 10000);
        };

        // 发命令并在每条命令输出到达后再发下一条
        const sendNext = (idx) => {
            if (idx >= commands.length || proc.killed || proc.exitCode !== null) {
                if (!proc.killed && proc.exitCode === null) {
                    proc.stdin.write('exit\n');
                }
                return;
            }
            const cmd = commands[idx];
            if (cmd && cmd.trim()) {
                proc.stdin.write(cmd + '\n');
            }
            // 等待这条命令的输出到达后再发下一条
            const onData = (data) => {
                proc.stdout.removeListener('data', onData);
                if (!proc.killed && proc.exitCode === null) {
                    setTimeout(() => sendNext(idx + 1), 100);
                }
            };
            proc.stdout.on('data', onData);
        };

        waitForPrompt();
    });
});

ipcMain.handle('stop_script', async (event, { serial }) => {
    if (scriptProcesses.has(serial)) {
        try {
            const { proc, lines } = scriptProcesses.get(serial);
            proc.kill();
            scriptProcesses.delete(serial);
            return { success: true, output: lines.join('\n'), error: null };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: true, output: '', error: null };
});

// Script output subscribe
ipcMain.on('script_output_subscribe', (event) => {
    // 前端注册后，主进程通过 webContents.send 推送 script_output/script_done 事件
    // 这里不需要额外存储，因为每个 IPC 连接都是独立的
});

// ============================================================
// App
// ============================================================

// 日志缓冲写入，避免高频同步写阻塞主进程
const logFd = fs.openSync(path.join(app.getPath('temp'), 'adb_electron.log'), 'w');
let logBuffer = [];
let logFlushTimer = null;

function flushLogBuffer() {
    if (logBuffer.length === 0) return;
    const msg = logBuffer.join('');
    logBuffer = [];
    try { fs.writeSync(logFd, msg); } catch {}
    try { fs.writeSync(1, msg); } catch {}
}

function writeLog(...args) {
    const msg = args.map(a => String(a)).join(' ') + '\n';
    logBuffer.push(msg);
    // 50ms 内批量刷新，减少系统调用次数
    if (!logFlushTimer) {
        logFlushTimer = setTimeout(() => {
            logFlushTimer = null;
            flushLogBuffer();
        }, 50);
    }
}

// 应用退出前确保日志落盘
app.on('before-quit', flushLogBuffer);


// Window control IPC handlers
ipcMain.handle('window_minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window_maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });
ipcMain.handle('window_close', () => { if (mainWindow) mainWindow.close(); });

app.whenReady().then(() => {
    writeLog('[MAIN] App ready');

    mainWindow = new BrowserWindow({
        width: 1200,  // 默认大小为最小宽度
        height: 700,  // 默认大小为最小高度
        minWidth: 1200,
        minHeight: 700,
        title: '智能硬件',
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: getPreloadPath(),
        },
        backgroundColor: '#0a0e17',
        show: false,
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
        writeLog('[FAIL LOAD]', errorCode, errorDesc);
    });

    mainWindow.webContents.on('crashed', () => {
        writeLog('[RENDERER CRASHED]');
    });

    // 抑制 DevTools 内部警告（不影响功能）
    mainWindow.webContents.on('console-message', (event, level, message) => {
        // 忽略 DevTools 内部的已知警告
        if (message.includes('Unknown VE context') || 
            message.includes('Autofill.enable') || 
            message.includes('Autofill.setAddresses')) {
            return; // 不打印这些警告
        }
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = getIndexPath();
        const fileUrl = 'file:///' + indexPath.replace(/\\/g, '/');
        writeLog('[LOAD] indexPath:', indexPath);
        writeLog('[LOAD] fileUrl:', fileUrl);
        try {
            mainWindow.loadURL(fileUrl);
        } catch(e) {
            writeLog('[LOAD ERROR]', e.message);
        }
    }

    mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
    stopTrackDevices();
    app.quit();
});
