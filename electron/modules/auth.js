// Module: auth - Device authentication, polling, and state management

const { spawn } = require('child_process');
const { getState } = require('./context');
const { runAdbShell } = require('./adb');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 加密存储的认证密钥（AES-256-GCM 加密，运行时解密）
const AUTH_KEYS_ENC = [
    "9gDoQMzvnAJv8SmdlmS2/xwPUECY2US2tk1jercnoCBTy1w+Ayz3Ib3w",
    "oJc19zFRGgLexNaYO/pBTIot8IPup8rz1KA/d1aUlyzsZZ5PPlY2WsLyMS8=",
    "wBw3VvfDTpsO6jWDxLbpr/R8sq9Z/3hd7YXI0kxeTCsHfKy21d6jSb0tBcofTt+T",
    "iQuk8GK2RiKSWZ+BHr2/Dg9A1Eh5gV6yFGrFPKcvvOtbiSuHyIFieq4yuOH9",
    "cshCjNQtv+lEYCG3zzXSDVEJ9F0j8rOvl36MFU1G46fyQWaba8jaIn4pvaoq4hds",
    "zKZl4CPSE1U7TTkEcawV+s/C5fQAD/FZcXbnT3smmnj0d8op4DA8BC5D+AslLIue",
    "EUSM2padqCBrS0rA5Dl0Kb2cDs13KqHoXhRVHEgdLJ8PjV2NlbvzoEBgIEIb3fMeQO9BBA==",
    "e0BppFWtC/HKIjUNH+ZH0VqHXBTTlapEJVysrKeJm839mMHBV3vvNWhjv3njbbnu7mihewe/",
    "qT3euTRXrzEwikDAjBn+94Q8A845aMHyLnvWL6OqsgsYa20u8QCirQ==",
    "7sLbkrdGazKN8dAn5qhoOQIVUN73R7Hb7Fl1IYYNk8F7Kl1i221ojf1oD8uvdKL2Yj0=",
    "pdsIV3RrSrryl6jvTLoZHaKGYllp6PiQTbyS/Uq2zNYYxGGyelRlhf3xIxMy5LE3a9o=",
    "yDp9kwqIESoDzo+Y7dtt+/n4vwtB5vaQOHTJuoW95sPceVJUBdiTUm+AL2uq7bs=",
    "4GXuu8s51Oy/B69VbuwPAqcVwkafY5jMpvNAa/sDSCB3n9rVZvKXlQEE8I2EYXCVwDLM",
    "TntdlbJl1W9PZl35Z30USfkvpXg0ak86xiNFJutr52ogHjXgNnIMN93KYF9y3cY3b79LgQ==",
    "NshLFFyMXPqJoUk3LLW/yoZiCkiolVIsMy36A/ikTHj0rL0Os8qoIWlORITt6qqs8lxxrHd6",
    "du3oaw9iT7a6DAeENA2fIwjYhvxHLCVeyiEFX1Fpo1Ju8uhPxOLTgicfSfHKTWnE",
    "q2qCCVX0OjzIBQheNm4rGgU0XlIS9KHaP8XOjNtskkuRQikbqqKMQ2D2zTffI4tyC7A="
];

// 解密缓存
let _decryptedAuthKeys = null;

/**
 * 获取解密后的认证密钥数组（带缓存）
 * @returns {string[]} 解密后的密钥数组
 */
function getAuthKeys() {
    if (_decryptedAuthKeys) return _decryptedAuthKeys;
    
    const MACHINE_KEY = crypto.createHash('sha256')
        .update(process.env.COMPUTERNAME || 'default')
        .update('ADB_TOOLS_ENC_KEY_V1')
        .digest();
    
    _decryptedAuthKeys = AUTH_KEYS_ENC.map(enc => {
        try {
            const buf = Buffer.from(enc, 'base64');
            const iv = buf.subarray(0, 12);
            const tag = buf.subarray(12, 28);
            const encrypted = buf.subarray(28);
            const decipher = crypto.createDecipheriv('aes-256-gcm', MACHINE_KEY, iv);
            decipher.setAuthTag(tag);
            return decipher.update(encrypted) + decipher.final('utf8');
        } catch { return null; }
    }).filter(k => k);
    
    return _decryptedAuthKeys;
}

const authenticatedDevices = new Set();
let authEventCallback = null;

// ============================================================
// 密码缓存 helpers（从备份项目移植）
// ============================================================
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
    const password = (process.env.COMPUTERNAME || 'default') + '__adb_tools_local__' + app.getPath('userData');
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

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

function getSavedPasswordBySku(sku) {
    if (!sku) return null;
    const store = loadPasswordStore();
    const entry = store[`sku:${sku}`];
    if (!entry) return null;
    return decrypt(entry.password);
}

// ============================================================
// 认证 helpers
// ============================================================
function tryAuth(serial, password, timeoutMs = 300) {
    return new Promise((resolve) => {
        const child = spawn('adb', ['-s', serial, 'shell', 'auth'], { windowsHide: true });
        child.stdin.write(password + '\n');
        child.stdin.end();
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            resolve(false);
        }, timeoutMs);
        child.on('error', () => { clearTimeout(timer); resolve(false); });
        child.on('close', (code) => {
            clearTimeout(timer);
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

async function getDeviceSku(serial) {
    try {
        const skuRe = /^\s*sku\s*=\s*(\S+)/m;
        const r = await runAdbShell(serial, 'cat /data/cfg/sys_config.conf', 5000);
        return skuRe.exec(r.output)?.[1] || null;
    } catch { return null; }
}

function notifyAuthState(serial) {
    if (authEventCallback) {
        const state = getState();
        const authState = state.authPollingLoops?.[serial] || {};
        authEventCallback({ serial, ...authState });
    }
}

function notifyDeviceInfoRefresh(event, serial) {
    if (!event.sender.isDestroyed()) {
        event.sender.send('auth_device_info_refresh', { serial });
    }
}

// ============================================================
// 优化的自动认证（从备份项目移植）
// ============================================================
async function auth_auto_start(event, { serial }) {
    const state = getState();
    
    // 防止重复启动
    if (state.authPollingLoops?.[serial]?.trying) {
        return { success: true, message: '已在轮询中' };
    }
    
    // 先检查是否已认证，避免 UI 闪烁
    const alreadyAuthed = await isAuthed(serial);
    if (alreadyAuthed) {
        authenticatedDevices.add(serial);
        state.authPollingLoops = state.authPollingLoops || {};
        state.authPollingLoops[serial] = { trying: false, current: 0, total: getAuthKeys().length, success: true, found: true };
        notifyAuthState(serial);
        return { success: true, message: '已认证' };
    }
    
    // 重置状态，开始认证流程
    state.authPollingLoops = state.authPollingLoops || {};
    state.authPollingLoops[serial] = { trying: true, current: 0, total: getAuthKeys().length, success: false, found: false };
    notifyAuthState(serial);
    
    // 1. 先尝试按 serial 已保存的密码
    const saved = getSavedPassword(serial);
    if (saved) {
        state.authPollingLoops[serial].current = -1;
        notifyAuthState(serial);
        await tryAuth(serial, saved);
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            state.authPollingLoops[serial] = { trying: false, current: 0, total: getAuthKeys().length, success: true, found: true };
            notifyAuthState(serial);
            notifyDeviceInfoRefresh(event, serial);
            const sku = await getDeviceSku(serial);
            if (sku) savePasswordToStore(serial, saved, sku);
            return { success: true, message: '认证成功（缓存密码）', cached: true };
        }
    }
    
    // 2. 收集所有已缓存的 SKU 密码
    const store = loadPasswordStore();
    const cachedPasswords = [];
    for (const [key, entry] of Object.entries(store)) {
        if (key.startsWith('sku:') && entry.password) {
            const pw = decrypt(entry.password);
            if (pw && !cachedPasswords.includes(pw) && pw !== saved) {
                cachedPasswords.push(pw);
            }
        }
    }
    
    // 3. 构建最终尝试列表
    // 注意：saved密码已经尝试过且失败了，所以不需要再试
    const alreadyTried = new Set();
    if (saved) alreadyTried.add(saved);
    
    // 去重缓存密码，避免重复尝试
    const uniqueCachedPws = cachedPasswords.filter(pw => !alreadyTried.has(pw));
    uniqueCachedPws.forEach(pw => alreadyTried.add(pw));
    
    // AUTH_KEYS中排除已尝试的（saved和缓存密码）
    const remainingKeys = getAuthKeys().filter(k => !alreadyTried.has(k));
    
    // 检查是否有带@r后缀的密码（Recovery模式常用）
    const recoveryKeys = remainingKeys.filter(k => k.endsWith('@r'));
    const normalKeys = remainingKeys.filter(k => !k.endsWith('@r'));
    
    // 顺序：缓存密码 -> Recovery密码(@r) -> 普通密码
    const allCandidates = [...uniqueCachedPws, ...recoveryKeys, ...normalKeys];
    const totalCandidates = allCandidates.length;
    
    // 确保状态对象仍然存在（可能被 get_devices 清理）
    if (!state.authPollingLoops[serial]) {
        state.authPollingLoops[serial] = { trying: true, current: 0, total: totalCandidates, success: false, found: false };
    } else {
        state.authPollingLoops[serial].total = totalCandidates;
    }
    
    // 4. 串行尝试每个密码，每次尝试后立即检查认证状态
    // Recovery模式下并发尝试可能导致问题，改为串行
    
    for (let i = 0; i < allCandidates.length; i++) {
        if (!state.authPollingLoops[serial]?.trying) {
            console.log(`[AUTH] Auth stopped for ${serial}`);
            return { success: false, message: '已停止' };
        }
        
        const password = allCandidates[i];
        state.authPollingLoops[serial].current = i + 1;
        notifyAuthState(serial);
        
        const success = await tryAuth(serial, password);
        
        // 每次尝试后立即检查是否已认证
        const authed = await isAuthed(serial);
        if (authed) {
            authenticatedDevices.add(serial);
            state.authPollingLoops[serial] = { trying: false, current: i + 1, total: totalCandidates, success: true, found: true };
            notifyAuthState(serial);
            notifyDeviceInfoRefresh(event, serial);
            const sku = await getDeviceSku(serial);
            savePasswordToStore(serial, password, sku);
            return { success: true, message: '认证成功' };
        }
        
        // 尝试间隔，避免过快
        if (i < allCandidates.length - 1) {
            await delay(10);
        }
    }
    
    // 5. 最终验证（理论上不会执行到这里，因为每批后都检查了）
    const finalAuthed = await isAuthed(serial);
    if (finalAuthed) {
        authenticatedDevices.add(serial);
        state.authPollingLoops[serial] = { trying: false, current: totalCandidates, total: totalCandidates, success: true, found: true };
        notifyAuthState(serial);
        notifyDeviceInfoRefresh(event, serial);
        return { success: true, message: '认证成功' };
    }
    
    state.authPollingLoops[serial] = { trying: false, current: totalCandidates, total: totalCandidates, success: false, found: false };
    notifyAuthState(serial);
    return { success: false, message: '认证失败' };
}

async function auth_auto_stop(event, { serial }) {
    const state = getState();
    if (state.authPollingLoops?.[serial]) {
        state.authPollingLoops[serial].trying = false;
    }
    return { success: true, message: '停止轮询' };
}

async function auth_auto_status(event, { serial }) {
    const state = getState();
    const authState = state.authPollingLoops?.[serial] || {};
    return { success: true, ...authState };
}

async function auth_state_subscribe(event, data) {
    authEventCallback = (state) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('auth_state_changed', state);
        }
    };
    return { success: true };
}

// 手动触发认证（用于 DevicePage 的认证按钮）
async function authenticate_device(event, { serial }) {
    // 检查是否已认证
    if (await isAuthed(serial)) {
        authenticatedDevices.add(serial);
        notifyDeviceInfoRefresh(event, serial);
        return { success: true, message: '设备已认证', key_index: null, cached: false };
    }
    
    // 尝试已保存的密码
    const saved = getSavedPassword(serial);
    if (saved) {
        await tryAuth(serial, saved);
        await delay(100);
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            notifyDeviceInfoRefresh(event, serial);
            const sku = await getDeviceSku(serial);
            if (sku) savePasswordToStore(serial, saved, sku);
            return { success: true, message: '认证成功（缓存密码）', key_index: null, cached: true };
        }
    }
    
    // 收集 SKU 缓存密码 + 全量密钥
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
    const remaining = getAuthKeys().filter(k => !alreadyTried.has(k));
    
    // Recovery模式优先尝试带@r后缀的密码
    const recoveryKeys = remaining.filter(k => k.endsWith('@r'));
    const normalKeys = remaining.filter(k => !k.endsWith('@r'));
    const allCandidates = [...cachedPws, ...recoveryKeys, ...normalKeys];
    
    // 串行尝试每个密码，每次尝试后立即检查认证状态
    for (let i = 0; i < allCandidates.length; i++) {
        const password = allCandidates[i];
        const success = await tryAuth(serial, password);
        
        // 每次尝试后立即检查是否已认证
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            notifyDeviceInfoRefresh(event, serial);
            const sku = await getDeviceSku(serial);
            savePasswordToStore(serial, password, sku);
            const usedCache = cachedPws.length > 0 && i < cachedPws.length ? '（优先使用缓存密码）' : '';
            return { success: true, message: `认证成功${usedCache}`, key_index: i + 1, cached: cachedPws.length > 0 && i < cachedPws.length };
        }
        
        if (i < allCandidates.length - 1) {
            await delay(10);
        }
    }
    return { success: false, message: '认证失败，所有密钥均不匹配', key_index: null, cached: false };
}

let deviceChangeCallback = null;
let trackDevicesProcess = null;

async function device_change_subscribe(event, data) {
    deviceChangeCallback = (devices) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('device_changed', devices);
        }
    };
    // Start track-devices listener using adb track-devices for real-time updates
    if (!trackDevicesProcess) {
        const { spawn } = require('child_process');
        trackDevicesProcess = spawn('adb', ['track-devices'], { windowsHide: true });
        
        let buffer = '';
        trackDevicesProcess.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            const devices = [];
            for (const line of lines) {
                const parts = line.trim().split('\t');
                if (parts.length >= 2 && (parts[1] === 'device' || parts[1] === 'offline' || parts[1] === 'unauthorized')) {
                    devices.push({ serial: parts[0], state: parts[1] });
                }
            }
            if (devices.length > 0 && deviceChangeCallback) {
                deviceChangeCallback(devices);
            }
        });
        
        trackDevicesProcess.on('error', () => {
            trackDevicesProcess = null;
        });
        trackDevicesProcess.on('close', () => {
            trackDevicesProcess = null;
        });
    }
    return { success: true };
}

module.exports = {
    auth_auto_start,
    auth_auto_stop,
    auth_auto_status,
    auth_state_subscribe,
    authenticate_device,
    device_change_subscribe,
};
