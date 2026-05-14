// Module: tools - Screenshot, firmware check, APK/AMR install, app version queries

const path = require('path');
const { spawn } = require('child_process');
const { runAdb, runAdbShell } = require('./adb');
const { getState } = require('./context');

async function screenshot(event, { serial }) {
    const fs = require('fs');
    const ts = Date.now();
    const remote = `/userdisk/screenshot_${ts}.png`;
    
    // Use miniapp_cli capture (same as original implementation)
    const cap = await runAdbShell(serial, `miniapp_cli capture ${remote}`);
    if (!cap.success) return { success: false, output: '', error: '截图失败' };

    const screenDir = path.join('D:', 'HardWare', 'Screen');
    fs.mkdirSync(screenDir, { recursive: true });
    const local = path.join(screenDir, `screenshot_${ts}.png`);
    const localFwd = local.replace(/\\/g, '/');
    const pull = await runAdb(['pull', remote, localFwd], serial, 30000);
    await runAdbShell(serial, `rm ${remote}`);

    if (!pull.success) return { success: false, output: '', error: '拉取截图失败' };
    
    // Return base64 for live preview
    try {
        const base64 = fs.readFileSync(local).toString('base64');
        return { success: true, output: local, base64: `data:image/png;base64,${base64}`, error: null };
    } catch (e) {
        return { success: true, output: local, base64: null, error: null };
    }
}

async function firmware_check(event, { serial }) {
    const { dialog } = require('electron');
    const { getState } = require('./context');
    const mainWindow = getState().mainWindow;

    if (!mainWindow) {
        return { success: false, output: null, error: '主窗口未就绪' };
    }

    // 1. 选择固件文件
    const filePathResult = await dialog.showOpenDialog(mainWindow, {
        title: '选择固件文件',
        properties: ['openFile'],
        filters: [
            { name: '固件文件', extensions: ['bin', 'img', 'zip', 'apk', 'pac', 'ota', '*'] },
        ],
    });
    if (filePathResult.canceled || !filePathResult.filePaths[0]) {
        return { success: false, output: null, error: '未选择固件文件' };
    }
    const firmwarePath = filePathResult.filePaths[0];

    // 2. 用 certutil 计算 MD5
    return new Promise((resolve) => {
        const { execSync } = require('child_process');
        try {
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
}

async function install_apk(event, { serial, filePath }) {
    return await runAdb(['install', '-r', filePath], serial, 120000);
}

async function install_amr(event, { serial, filePath, autoReboot }) {
    const filename = path.basename(filePath);
    await runAdbShell(serial, 'mount -o remount,rw /');
    const push = await runAdb(['push', filePath, '/tmp'], serial, 120000);
    if (!push.success) return { success: false, output: '', error: '推送失败' };

    const fileid = filename.replace('.amr', '');
    await runAdbShell(serial, `miniapp_cli install /tmp/${filename}`);
    await runAdbShell(serial, `miniapp_cli start ${fileid}`);
    if (autoReboot) await runAdb(['reboot'], serial);

    return { success: true, output: `小程序 ${fileid} 安装并启动成功`, error: null };
}

async function query_app_versions(event, { serial }) {
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
}

module.exports = {
    screenshot,
    firmware_check,
    install_apk,
    install_amr,
    query_app_versions,
};
