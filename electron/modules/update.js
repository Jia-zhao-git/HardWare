// Module: update - Version check and disable control

const { app, dialog, shell } = require('electron');
const https = require('https');
const http = require('http');
const { getState } = require('./context');

const VERSION_URL = 'https://raw.githubusercontent.com/Jia-zhao-git/HardWare/refs/heads/main/ADB-Version.ini';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let checkTimer = null;
let lastCheckTime = 0;

function log(msg) {
    console.log(`[update] ${new Date().toLocaleTimeString('zh-CN')} ${msg}`);
}

/**
 * Parse INI content into key-value object
 * Supports multi-line values: lines without '=' after a key=value line
 * are appended to the previous key's value.
 */
function parseIni(content) {
    const result = {};
    const lines = content.split(/\r?\n/);
    let currentKey = null;
    let currentValueParts = [];

    const saveCurrent = () => {
        if (currentKey !== null) {
            result[currentKey] = currentValueParts.join('\n').trim();
            currentValueParts = [];
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and section headers; treat empty lines as value boundary
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
            saveCurrent();
            currentKey = null;
            continue;
        }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            saveCurrent();
            currentKey = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            currentValueParts = val ? [val] : [];
        } else if (currentKey !== null) {
            // Continuation line - append to current value
            currentValueParts.push(trimmed);
        }
    }

    saveCurrent();
    return result;
}

/**
 * Fetch version.ini from GitHub
 */
function fetchVersionIni() {
    return new Promise((resolve, reject) => {
        const client = VERSION_URL.startsWith('https') ? https : http;
        const timeout = 10000;
        
        log(`正在检测新版本... GET ${VERSION_URL}`);
        
        const req = client.get(VERSION_URL, { timeout }, (res) => {
            if (res.statusCode !== 200) {
                log(`检测失败: HTTP ${res.statusCode}`);
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                log(`检测成功: 获取到 ${(data.length)} 字节配置`);
                resolve(data);
            });
        });
        
        req.on('error', (e) => {
            log(`检测失败: ${e.message}`);
            reject(e);
        });
        req.on('timeout', () => {
            req.destroy();
            log('检测超时 (10s)');
            reject(new Error('Timeout'));
        });
    });
}

/**
 * Show update available dialog
 * 前往下载 → 打开下载链接
 * 关闭/退出 → 退出程序
 */
async function showUpdateDialog(latestVersion, downloadUrl, message, changelog) {
    const detail = changelog ? `
更新内容：
${changelog}

当前版本：${app.getVersion()}
最新版本：v${latestVersion}` : `
当前版本：${app.getVersion()}
最新版本：v${latestVersion}`;

    const result = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: message || `发现新版本 v${latestVersion}`,
        detail,
        buttons: ['前往下载', '退出程序'],
        defaultId: 0,
        cancelId: 1
    });

    if (result.response === 0 && downloadUrl) {
        log('用户点击了「前往下载」');
        shell.openExternal(downloadUrl);
        // 下载后也退出，让用户手动安装
        app.quit();
    } else {
        log('用户取消了更新，退出程序');
        // 用户点击「退出程序」或关闭弹窗 → 退出
        app.quit();
    }
}

/**
 * Show disabled dialog (blocking)
 */
async function showDisabledDialog(message) {
    await dialog.showMessageBox({
        type: 'info',
        title: '当前版本已停用',
        message: '请联系 zhaojia06 获取最新版本',
        buttons: ['确认'],
        noLink: true
    });
    app.quit();
}

/**
 * Perform version check
 */
async function doVersionCheck(win, showUi = true) {
    const now = Date.now();
    if (now - lastCheckTime < 60000) return; // Debounce: at least 1 min between checks
    
    try {
        const content = await fetchVersionIni();
        const config = parseIni(content);
        
        lastCheckTime = now;
        
        // Check disabled flag
        const disabled = config.disabled === '1';
        
        if (disabled) {
            log(`配置解析: disabled=1 (已停用)`);
            if (win && !win.isDestroyed()) {
                win.hide();
            }
            await showDisabledDialog(config.message);
            return;
        }
        
        // Check new version
        if (!showUi) {
            log('静默检测完成，不弹 UI');
            return;
        }
        
        const latest = config.latest;
        const current = app.getVersion();
        
        log(`配置解析: disabled=${config.disabled}, latest=${config.latest}, changelog=${config.changelog ? '有(' + config.changelog.length + '字符)' : '无'}, 当前版本=${current}`);
        
        if (latest && isNewerVersion(latest, current)) {
            log(`发现新版本: ${latest} > ${current}，弹窗提示用户`);
            await showUpdateDialog(latest, config.url || config.download_url, config.message, config.changelog);
        } else {
            log(`版本检测完成: 当前已是最新版本 (${current})`);
        }
    } catch (e) {
        // Network error or parse error - skip this check
        log(`检测跳过: ${e.message}`);
    }
}

/**
 * Compare version strings (semver-like)
 */
function isNewerVersion(latest, current) {
    const lParts = latest.split('.').map(Number);
    const cParts = current.split('.').map(Number);
    const maxLen = Math.max(lParts.length, cParts.length);
    
    for (let i = 0; i < maxLen; i++) {
        const l = lParts[i] || 0;
        const c = cParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

/**
 * Start periodic version check
 */
function startPeriodicCheck(win) {
    if (checkTimer) {
        log('周期性检测已启动，跳过重复启动');
        return;
    }
    
    log('启动版本检测: 首次3秒后检测，之后每1小时检测一次');
    
    // Initial check after 3 seconds (let app fully load)
    setTimeout(() => {
        doVersionCheck(win, true);
    }, 3000);
    
    // Periodic check every hour
    checkTimer = setInterval(() => {
        log('周期性检测触发 (1小时间隔)');
        doVersionCheck(win, true);
    }, CHECK_INTERVAL_MS);
}

/**
 * Stop periodic check
 */
function stopPeriodicCheck() {
    if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
        log('周期性检测已停止');
    }
}

module.exports = {
    doVersionCheck,
    startPeriodicCheck,
    stopPeriodicCheck,
    fetchVersionIni,
    parseIni
};
