// Module: auth - Device authentication, polling, and state management

const { spawn } = require('child_process');
const { getState } = require('./context');
const { runAdbShell, cleanDeviceSerial } = require('./adb');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 加密存储的认证密钥（AES-256-GCM 加密，运行时解密）
// 密钥来源：固定日期 '2026-06-25' + 'ADB_TOOLS_FIXED_KEY_V1'
const AUTH_KEYS_ENC = [
    "rX1rZiGPaQHDw/nujzUGYB5RsARWSLDjqv9B2D0v7avDqaSAxI1ofufD",
    "xDmTKsmi4p6UgkXVmki8jdqXuGcwwey1Zr7b7WOtpcwdeLAHfpVEu5kFnYY=",
    "AI3oa9J+81tvYoDXITDc+J7DgHCjzWNXe0vHKPJUI6Vq7qTmhIg6ROPyyK7JAT4d",
    "2nKcNP3mPEPnfoGeMewLnTFhmYNqWlsRH0E2NNA5Cz5njryz8SWOpFnA3By0",
    "YbEdalhoxjUiR3CoQYg5xFX1M5RlP787oM76UkokKi7JWtMjqtdYAUrlwmxFIzWx",
    "zsF94OcDyyoJA58qftqOPnisCyYpv7Cohx3yoC7YgzYoqxb1HzdNT7jvheSbLijX",
    "sVyUprMJyWLJo+Jv47WuX9MCLTCO6KzPw+YRiaFNXETT+as6UoZr5yKYPtazwYb+fSbw/A==",
    "vgvxN8ZApMZY4FT9ZRgoat5NJLL0lGQLEP9gfIrYIBioRoLVFBAmoCC4vvxacG1Ha+sj/+Ip",
    "lR+3pqPoxoaSQ9ZDH2jiiDw0Zf86hGNF6LVNnwYD4TOfrzdMQF/i/Q==",
    "3roj8crZ8jDNtQ1Xry0pEL4npBKrqi9nixycUacy3JoUGdfwXT/wrsri4pg6/+D6QDY=",
    "8JOE+9sO83LzZSlNAIqw8smdYalRNGbU5pBpUer1b59SLatuucVpdTTeaZQCUuZT8Tk=",
    "jy3ou4ly9svueUONZJbCkyTeyMSO7k119MKOJnD1pGT/3GT0CDn94b/CwLifKpA=",
    "9BCGxmgI7149UP8GjOTzncrjpOx00j1UIYW1wQqPjSQ4CQ4I9Z8eSQWmCFJ2jmN22qAW",
    "7Qeb+jOh3NDOuV+/1DJ8/TfCc4vXIWY5ingMykPisEc9ri4y9knTacgCDHGlW/sytpouBQ==",
    "k/jLwTmFkJ9TUaHFpHarjVFL1R7G1piqsBi7UmYIMOcL8QAtsDRrtodXg+hgMz7y7+JC+UW8",
    "L2biwl50aTYCfYy0+8FyLlqyXKs2WzqdF5O5Jr2kLzPRt/V+nRKydBRQmjV44spD",
    "2Y2vRAEAO+1XRRTXQEkADgPZCUujrltgxKY+wSVLDer1yUFV7w1ZIc19ld/wgh69Wvk=",
];

// ============================================================
// 固定密钥：所有设备共用同一套密码
// 密钥来源：固定日期字符串 hash 派生
// ============================================================

/**
 * 从固定日期字符串派生 32 字节密钥
 * 格式：YYYY-MM-DD
 * @returns {Buffer}
 */
function getSharedKey() {
    return crypto.createHash('sha256')
        .update('2026-06-25')
        .update('ADB_TOOLS_FIXED_KEY_V1')
        .digest();
}

/**
 * 统一解密入口
 * @param {string} enc base64 编码的密文
 * @param {Buffer} key 32字节密钥
 * @returns {string|null}
 */
function decryptWithKey(enc, key) {
    try {
        const buf = Buffer.from(enc, 'base64');
        if (buf.length < 28) return null;
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const encrypted = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
    } catch { return null; }
}

/**
 * 加密函数（供管理员工具使用）
 * @param {string} plaintext 明文
 * @param {Buffer} key 32字节密钥
 * @returns {string} base64 编码的密文
 */
function encryptPassword(plaintext, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

// 解密缓存
let _decryptedAuthKeys = null;

/**
 * 获取解密后的认证密钥数组（带缓存）
 * @returns {string[]} 解密后的密钥数组
 */
function getAuthKeys() {
    if (_decryptedAuthKeys) return _decryptedAuthKeys;
    const key = getSharedKey();
    _decryptedAuthKeys = AUTH_KEYS_ENC.map(enc => decryptWithKey(enc, key)).filter(k => k !== null);
    return _decryptedAuthKeys;
}

const authenticatedDevices = new Set();
let authEventCallback = null;
// 手动认证进行中的 serial，防止与 auth_auto_start 竞速
let manualAuthInProgress = null;

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
    // 清洗后 SN 再存一份（覆盖 USB 前缀变动）
    const cleanSerial = cleanDeviceSerial(serial);
    if (cleanSerial !== serial) {
        store[cleanSerial] = { password: enc, sku: sku || null, updated_at: now };
    }
    // SN 前6位缓存
    const sn6 = cleanSerial.substring(0, 6);
    if (sn6.length === 6) {
        store[`sn6:${sn6}`] = { password: enc, updated_at: now };
    }
    _saveStore(store);
}

function getSavedPasswordBySnPrefix(serial) {
    const cleanSerial = cleanDeviceSerial(serial);
    const sn6 = cleanSerial.substring(0, 6);
    if (sn6.length < 6) return null;
    const store = loadPasswordStore();
    const entry = store[`sn6:${sn6}`];
    if (!entry) return null;
    return decrypt(entry.password);
}

function getSavedPassword(serial) {
    const store = loadPasswordStore();
    const entry = store[serial];
    if (!entry) {
        const cleanSerial = cleanDeviceSerial(serial);
        if (cleanSerial !== serial) {
            const cleanEntry = store[cleanSerial];
            if (cleanEntry) return decrypt(cleanEntry.password);
        }
        return null;
    }
    return decrypt(entry.password);
}

// ============================================================
// 认证 helpers
// ============================================================
function tryAuth(serial, password, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const child = spawn('adb', ['-s', serial, 'shell', 'auth'], { windowsHide: true });
        child.stdin.write(password + '\n');
        child.stdin.end();
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            resolve(false);
        }, timeoutMs);
        child.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}

function isAuthed(serial) {
    return new Promise((resolve) => {
        runAdbShell(serial, 'id', 1000).then(r => {
            resolve(r.success && (r.output.includes('uid=') || r.output.includes('root')));
        });
    });
}

// 带重试的 isAuthed：tryAuth 成功后设备 auth daemon 可能需要时间生效
async function isAuthedWithRetry(serial, retries = 3, delayMs = 200) {
    for (let i = 0; i < retries; i++) {
        if (await isAuthed(serial)) return true;
        if (i < retries - 1) await delay(delayMs);
    }
    return false;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDeviceSku(serial) {
    try {
        const skuRe = /^\s*sku\s*=\s*(\S+)/m;
        const r = await runAdbShell(serial, 'cat /data/cfg/sys_config.conf', 2000);
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
    if (state.authPollingLoops?.[serial]?.trying) return { success: true, message: '已在认证中' };
    
    // 防止与手动认证竞速
    if (manualAuthInProgress === serial) {
        return { success: true, message: '手动认证进行中' };
    }
    
    if (await isAuthed(serial)) {
        authenticatedDevices.add(serial);
        state.authPollingLoops = state.authPollingLoops || {};
        state.authPollingLoops[serial] = { trying: false, current: 0, total: getAuthKeys().length, success: true, found: true };
        notifyAuthState(serial);
        // 已授权设备：把已有密码同步到 SN6 缓存
        const existingPw = getSavedPassword(serial);
        if (existingPw) {
            getDeviceSku(serial).then(sku => savePasswordToStore(serial, existingPw, sku)).catch(() => savePasswordToStore(serial, existingPw, null));
        }
        return { success: true, message: '已认证' };
    }
    
    state.authPollingLoops = state.authPollingLoops || {};
    state.authPollingLoops[serial] = { trying: true, current: 0, total: getAuthKeys().length, success: false, found: false };
    notifyAuthState(serial);
    
    // 设备刚连接时 ADB 不稳定，等待一段时间让连接稳定
    await delay(1000);
    
    // 缓存密码：serial 精确 + SN 前6位，并行尝试
    const saved = getSavedPassword(serial);
    const snPrefixPwd = getSavedPasswordBySnPrefix(serial);
    const cacheCandidates = [...new Set([saved, snPrefixPwd].filter(Boolean))];
    
    if (cacheCandidates.length > 0) {
        if (state.authPollingLoops[serial]) state.authPollingLoops[serial].current = -1;
        notifyAuthState(serial);
        const cacheResults = await Promise.all(cacheCandidates.map(p => tryAuth(serial, p)));
        for (let i = 0; i < cacheResults.length; i++) {
            if (cacheResults[i] && await isAuthedWithRetry(serial)) {
                authenticatedDevices.add(serial);
                if (state.authPollingLoops[serial]) {
                    state.authPollingLoops[serial] = { trying: false, current: 0, total: getAuthKeys().length, success: true, found: true };
                }
                notifyAuthState(serial);
                notifyDeviceInfoRefresh(event, serial);
                const pw = cacheCandidates[i];
                const label = pw === saved ? '缓存密码' : 'SN前缀缓存';
                const sku = await getDeviceSku(serial);
                savePasswordToStore(serial, pw, sku);
                return { success: true, message: `认证成功（${label}）`, cached: true };
            }
        }
    }
    
    
    const alreadyTried = new Set();
    cacheCandidates.forEach(p => alreadyTried.add(p));
    
    const remainingKeys = getAuthKeys().filter(k => !alreadyTried.has(k));
    const recoveryKeys = remainingKeys.filter(k => k.endsWith('@r'));
    const normalKeys = remainingKeys.filter(k => !k.endsWith('@r'));
    const allCandidates = [...recoveryKeys, ...normalKeys];
    const totalCandidates = allCandidates.length;
    
    if (!state.authPollingLoops[serial]) {
        state.authPollingLoops[serial] = { trying: true, current: 0, total: totalCandidates, success: false, found: false };
    } else {
        state.authPollingLoops[serial].total = totalCandidates;
    }
    
    // 4. 并行尝试，每批 BATCH 个，成功即停
    const BATCH = 6;
    for (let batchStart = 0; batchStart < allCandidates.length; batchStart += BATCH) {
        if (!state.authPollingLoops[serial]?.trying) {
            return { success: false, message: '已停止' };
        }
        const batch = allCandidates.slice(batchStart, batchStart + BATCH);
        const batchResults = await Promise.all(batch.map(password => tryAuth(serial, password)));
        
        for (let j = 0; j < batchResults.length; j++) {
            if (!state.authPollingLoops[serial]) break;
            state.authPollingLoops[serial].current = batchStart + j + 1;
            notifyAuthState(serial);
            if (!batchResults[j]) continue;
            // tryAuth 返回 true，再验证 isAuthed（带重试）
            const authed = await isAuthedWithRetry(serial);
            if (authed) {
                authenticatedDevices.add(serial);
                if (state.authPollingLoops[serial]) {
                    state.authPollingLoops[serial] = { trying: false, current: batchStart + j + 1, total: totalCandidates, success: true, found: true };
                }
                notifyAuthState(serial);
                notifyDeviceInfoRefresh(event, serial);
                const password = batch[j];
                const sku = await getDeviceSku(serial);
                savePasswordToStore(serial, password, sku);
                return { success: true, message: '认证成功' };
            }
        }
        
    }
    
    const finalAuthed = await isAuthedWithRetry(serial);
    if (finalAuthed) {
        authenticatedDevices.add(serial);
        if (state.authPollingLoops[serial]) {
            state.authPollingLoops[serial] = { trying: false, current: totalCandidates, total: totalCandidates, success: true, found: true };
        }
        notifyAuthState(serial);
        notifyDeviceInfoRefresh(event, serial);
        return { success: true, message: '认证成功' };
    }
    
    if (state.authPollingLoops[serial]) {
        state.authPollingLoops[serial] = { trying: false, current: totalCandidates, total: totalCandidates, success: false, found: false };
    }
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
    // 加锁，防止与 auth_auto_start 竞速
    if (manualAuthInProgress === serial) {
        return { success: true, message: '认证已在进行中' };
    }
    manualAuthInProgress = serial;
    try {
        if (await isAuthed(serial)) {
            authenticatedDevices.add(serial);
            notifyDeviceInfoRefresh(event, serial);
            // 同步已有密码到 SN6 缓存
            const existingPw = getSavedPassword(serial);
            if (existingPw) {
                getDeviceSku(serial).then(sku => savePasswordToStore(serial, existingPw, sku)).catch(() => savePasswordToStore(serial, existingPw, null));
            }
            return { success: true, message: '设备已认证', key_index: null, cached: false };
        }
        
        // 缓存密码并行尝试
        const saved = getSavedPassword(serial);
        const snPrefixPwd2 = getSavedPasswordBySnPrefix(serial);
        const cacheCandidates2 = [...new Set([saved, snPrefixPwd2].filter(Boolean))];
        
        if (cacheCandidates2.length > 0) {
            const cacheResults = await Promise.all(cacheCandidates2.map(p => tryAuth(serial, p)));
            for (let i = 0; i < cacheResults.length; i++) {
                if (cacheResults[i]) {
                    const authed = await isAuthedWithRetry(serial);
                    if (authed) {
                        authenticatedDevices.add(serial);
                        notifyDeviceInfoRefresh(event, serial);
                        const pw = cacheCandidates2[i];
                        const label = pw === saved ? '缓存密码' : 'SN前缀缓存';
                        const sku = await getDeviceSku(serial);
                        savePasswordToStore(serial, pw, sku);
                        return { success: true, message: `认证成功（${label}）`, cached: true };
                    }
                }
            }
        }
        
        const alreadyTried = new Set();
        cacheCandidates2.forEach(p => alreadyTried.add(p));
        
        const remainingKeys = getAuthKeys().filter(k => !alreadyTried.has(k));
        const recoveryKeys = remainingKeys.filter(k => k.endsWith('@r'));
        const normalKeys = remainingKeys.filter(k => !k.endsWith('@r'));
        const allCandidates = [...recoveryKeys, ...normalKeys];
        
        // 并行尝试，每批 BATCH 个，成功即停
        const BATCH = 6;
        for (let batchStart = 0; batchStart < allCandidates.length; batchStart += BATCH) {
            const batch = allCandidates.slice(batchStart, batchStart + BATCH);
            const batchResults = await Promise.all(batch.map(password => tryAuth(serial, password)));
            
            for (let j = 0; j < batchResults.length; j++) {
                if (!batchResults[j]) continue;
                const authed = await isAuthedWithRetry(serial);
                if (authed) {
                    authenticatedDevices.add(serial);
                    notifyDeviceInfoRefresh(event, serial);
                    const password = batch[j];
                    const sku = await getDeviceSku(serial);
                    savePasswordToStore(serial, password, sku);
                    return { success: true, message: '认证成功', key_index: batchStart + j + 1, cached: false };
                }
            }
        }
        
        return { success: false, message: '认证失败，所有密钥均不匹配', key_index: null, cached: false };
    } finally {
        manualAuthInProgress = null;
    }
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
            buffer = lines.pop() || '';
            
            const devices = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const parts = trimmed.split('\t');
                // 过滤非设备行：serial 不能包含冒号（传输层ID格式如 1234:5678），且状态必须是指定值
                if (parts.length >= 2 && (parts[1] === 'device' || parts[1] === 'offline' || parts[1] === 'unauthorized')) {
                    const serial = parts[0].trim();
                      if (serial && !serial.includes(':') && serial.length > 0) {
                          devices.push({ serial, state: parts[1] });
                    }
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
