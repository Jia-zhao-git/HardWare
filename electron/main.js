const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

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
let authenticatedDevices = new Set();

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
    return devices;
});

// Authenticate device
ipcMain.handle('authenticate_device', async (event, { serial }) => {
    if (authenticatedDevices.has(serial)) {
        return { success: true, message: '设备已认证（缓存）', key_index: null, cached: true };
    }
    // Check actual auth
    const r = await runAdbShell(serial, 'id');
    if (r.success && (r.output.includes('uid=') || r.output.includes('root'))) {
        authenticatedDevices.add(serial);
        return { success: true, message: '设备已认证', key_index: null, cached: false };
    }
    // Try all keys
    for (let i = 0; i < AUTH_KEYS.length; i++) {
        const key = AUTH_KEYS[i];
        const child = spawn(adbPath, ['-s', serial, 'shell', 'auth'], { windowsHide: true });
        await new Promise(resolve => {
            child.stdin.write(key + '\n');
            child.stdin.end();
            setTimeout(resolve, 600);
            setTimeout(() => { try { child.kill(); } catch {} }, 1000);
        });
        const check = await runAdbShell(serial, 'id');
        if (check.success && (check.output.includes('uid=') || check.output.includes('root'))) {
            authenticatedDevices.add(serial);
            return { success: true, message: '认证成功', key_index: i + 1, cached: false };
        }
    }
    return { success: false, message: '认证失败，所有密钥均不匹配', key_index: null, cached: false };
});

// Get device info
ipcMain.handle('get_device_info', async (event, { serial }) => {
    const adbShell = (cmd) => runAdbShell(serial, cmd);

    // SKU
    const skuRe = /^\s*sku\s*=\s*(\S+)/m;
    const skuOut = await adbShell('cat /data/cfg/sys_config.conf');
    const sku = skuRe.exec(skuOut.output)?.[1] || '未知SKU';

    // Version
    const verOut = await adbShell('cat /Version');
    const version = verOut.success && verOut.output ? verOut.output : '未知版本';

    // Partition
    const partOut = await adbShell('cat /tmp/UpdateInfo');
    const partition = partOut.success && partOut.output ? partOut.output.replace('[ota_info]', '') : '未知';

    // Slot - fix: use correct regex to match _a or _b
    const slotOut = await adbShell('export | grep SLOT');
    const slotMatch = /SLOT=['"]?([_][ab])/.exec(slotOut.output);
    const current_slot = slotMatch ? (slotMatch[1] === '_a' ? 'A' : 'B') : '未知';

    // Battery
    const batOut = await adbShell('cat /sys/class/power_supply/battery/capacity');
    const battery = batOut.success ? `${batOut.output.trim()}%` : '0%';

    // Memory
    const memOut = await adbShell('free | grep Mem');
    const memParts = memOut.success ? memOut.output.trim().split(/\s+/) : [];
    const memTotal = parseFloat(memParts[1] || 1);
    const memUsed = parseFloat(memParts[2] || 0);
    const memory_mb = memTotal > 0 ? Math.round(memUsed / memTotal * 1000) / 10 : 0;

    // CPU - fix: use top to get real CPU usage
    const cpuOut = await adbShell('top -n 1 -b 2>/dev/null | head -5');
    let cpu_usage = '0';
    if (cpuOut.success) {
        // Try to parse CPU line from top output
        const cpuLine = cpuOut.output.split('\n').find(l => l.includes('%Cpu') || l.includes('CPU'));
        if (cpuLine) {
            const idleMatch = /(\d+\.?\d*)\s*%?\s*id/.exec(cpuLine);
            if (idleMatch) {
                cpu_usage = (100 - parseFloat(idleMatch[1])).toFixed(1);
            }
        }
    }

    // IP
    const ipRe = /inet (\d+\.\d+\.\d+\.\d+)/;
    const ipOut = await adbShell('ip addr show wlan0 2>/dev/null | grep \'inet \' | head -n1');
    const ip = ipRe.exec(ipOut.output)?.[1] || '未知';

    return { serial, sku, version, partition, current_slot, battery, memory_mb, cpu_usage, ip };
});

// Performance monitor
ipcMain.handle('get_performance_monitor', async (event, { serial }) => {
    const adbShell = (cmd) => runAdbShell(serial, cmd);

    // Battery
    const batOut = await adbShell('cat /sys/class/power_supply/battery/capacity\ncat /sys/class/power_supply/battery/voltage_now\ncat /sys/class/power_supply/battery/current_now');
    const batLines = batOut.output.split('\n');

    // System
    const sysOut = await adbShell('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0\ncat /sys/class/power_supply/battery/temp 2>/dev/null || echo 0\ngrep ^MemAvailable: /proc/meminfo | awk \'{print $2}\'\ngrep ^MemFree: /proc/meminfo | awk \'{print $2}\'\ngrep ^Buffers: /proc/meminfo | awk \'{print $2}\'\ngrep ^Cached: /proc/meminfo | head -1 | awk \'{print $2}\'');
    const sysLines = sysOut.output.split('\n');

    // CPU usage from top
    const cpuOut = await adbShell('top -n 1 -b 2>/dev/null | head -5');
    let cpu_usr = '0', cpu_sys = '0', cpu_idle = '100';
    if (cpuOut.success) {
        const cpuLine = cpuOut.output.split('\n').find(l => l.includes('%Cpu') || l.includes('CPU'));
        if (cpuLine) {
            const usrMatch = /(\d+\.?\d*)\s*%?\s*us/.exec(cpuLine);
            const sysMatch = /(\d+\.?\d*)\s*%?\s*sy/.exec(cpuLine);
            const idleMatch = /(\d+\.?\d*)\s*%?\s*id/.exec(cpuLine);
            if (usrMatch) cpu_usr = usrMatch[1];
            if (sysMatch) cpu_sys = sysMatch[1];
            if (idleMatch) cpu_idle = idleMatch[1];
        }
    }

    // Process
    const psOut = await adbShell('ps');
    let miniapp_vmrss = 0, miniapp_threads = 0;
    let soundplayer_vmrss = 0, soundplayer_threads = 0;
    let captureframe_vmrss = 0, captureframe_threads = 0;
    let soundrecord_vmrss = 0, soundrecord_threads = 0;

    const pids = {};
    for (const line of psOut.output.split('\n')) {
        const lower = line.toLowerCase();
        const pid = line.trim().split(/\s+/)[0];
        if (lower.includes('miniapp') && !lower.includes('grep')) pids['miniapp'] = pid;
        if (lower.includes('soundplayer') && !lower.includes('grep')) pids['soundplayer'] = pid;
        if (lower.includes('captureframe') && !lower.includes('grep')) pids['captureframe'] = pid;
        if (lower.includes('soundrecord') && !lower.includes('grep')) pids['soundrecord'] = pid;
    }

    for (const [name, pid] of Object.entries(pids)) {
        const stOut = await adbShell(`cat /proc/${pid}/status 2>/dev/null | grep -E '^(VmRSS|Threads):'`);
        for (const line of stOut.output.split('\n')) {
            if (line.startsWith('VmRSS:')) {
                const v = parseInt(line.split(/\s+/)[1]) || 0;
                if (name === 'miniapp') miniapp_vmrss = v;
                if (name === 'soundplayer') soundplayer_vmrss = v;
                if (name === 'captureframe') captureframe_vmrss = v;
                if (name === 'soundrecord') soundrecord_vmrss = v;
            }
            if (line.startsWith('Threads:')) {
                const v = parseInt(line.split(/\s+/)[1]) || 0;
                if (name === 'miniapp') miniapp_threads = v;
                if (name === 'soundplayer') soundplayer_threads = v;
                if (name === 'captureframe') captureframe_threads = v;
                if (name === 'soundrecord') soundrecord_threads = v;
            }
        }
    }

    return {
        battery_capacity: parseInt(batLines[0]) || 0,
        battery_voltage: parseInt(batLines[1]) || 0,
        battery_current: parseInt(batLines[2]) || 0,
        cpu_temp: parseInt(sysLines[0]) || 0,
        battery_temp: parseInt(sysLines[1]) || 0,
        cpu_usr, cpu_sys, cpu_idle,
        mem_available: parseInt(sysLines[2]) || 0,
        mem_free: parseInt(sysLines[3]) || 0,
        mem_buffers: parseInt(sysLines[4]) || 0,
        mem_cached: parseInt(sysLines[5]) || 0,
        miniapp_vmrss, miniapp_threads, miniapp_pid: parseInt(pids['miniapp']) || 0,
        soundplayer_vmrss, soundplayer_threads, soundplayer_pid: parseInt(pids['soundplayer']) || 0,
        captureframe_vmrss, captureframe_threads, captureframe_pid: parseInt(pids['captureframe']) || 0,
        soundrecord_vmrss, soundrecord_threads, soundrecord_pid: parseInt(pids['soundrecord']) || 0,
    };
});

// Shell command
ipcMain.handle('run_shell_command', async (event, { serial, command }) => {
    return await runAdbShell(serial, command);
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

// Firmware check
ipcMain.handle('firmware_check', async (event, { serial }) => {
    const cmds = [
        "echo '=== SYSTEM ===' && df /system",
        "echo '=== CONFIG ===' && ls -l /data/cfg/sys_config.conf /Version /tmp/UpdateInfo 2>/dev/null",
        "echo '=== SELINUX ===' && getenforce",
        "echo '=== BUILD ===' && getprop ro.build.fingerprint",
        "echo '=== STORAGE ===' && df /data",
        "echo '=== BOOT ===' && getprop ro.boot.verifiedbootstate",
    ];
    return await runAdbShell(serial, cmds.join(' && '));
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
// ============================================================
// App
// ============================================================

const logFd = fs.openSync(path.join(app.getPath('temp'), 'adb_electron.log'), 'w');
function writeLog(...args) {
    const msg = args.map(a => String(a)).join(' ') + '\n';
    try { fs.writeSync(logFd, msg); } catch {}
    try { fs.writeSync(1, msg); } catch {}
}


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

app.on('window-all-closed', () => { app.quit(); });
