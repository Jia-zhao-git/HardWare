// Module: adb - Core ADB operations

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 清洗设备 SN：去除 ADB 在前面附加的 USB 端口/集线器编号（纯数字前缀）
 * 例：00187G50900011900015 → 7G50900011900015
 *     000000197G50900011900015 → 7G50900011900015
 *     7G50900011900015 → 7G50900011900015（无变化）
 */
function cleanDeviceSerial(raw) {
    if (!raw) return raw;
    // 找第一个 "数字后紧接字母" 的位置 → 这是真实 SN 的起点
    const m = raw.match(/\d(?=[A-Za-z])/);
    return m ? raw.substring(m.index) : raw;
}
const { getState } = require('./context');

const AUTH_KEYS = [
    "brY1d2@dictpen", "brY1d2@dictpen@r", "cherrybrY1d2@dictpen",
    "x3sbrY1d2@dictpen", "apollobrY1d2@dictpen", "AlmondbrY1d2@dictpen",
    "cherry3566brY1d2@dictpen", "cherry3566brY1d2@dictpen@r", "CherryYoudao",
    "AlmondbrY1d2@dictpen@r", "cherrybrY1d2@dictpen@r", "x3sbrY1d2@dictpen@r",
    "apollogbrY1d2@dictpen@r", "cherry3326brY1d2@dictpen", "cherry3326brY1d2@dictpen@r",
    "RV1106brY1d2@dictpen", "RV1106brY1d2@dictpen@r",
];

let authenticatedDevices = new Set();

function runAdb(args, device, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const serialArg = device ? ['-s', device] : [];
        const cmdArgs = [...serialArg, ...args];
        const child = spawn('adb', cmdArgs, { windowsHide: true, timeout: timeoutMs });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        child.on('close', (code) => {
            resolve({ success: code === 0, output: stdout.trim(), error: stderr.trim() || null });
        });
        setTimeout(() => {
            try { child.kill(); } catch {}
            resolve({ success: false, output: stdout.trim(), error: 'TIMEOUT' });
        }, timeoutMs);
    });
}

function runAdbShell(device, cmd, timeoutMs = 30000) {
    return runAdb(['shell', cmd], device, timeoutMs);
}

async function check_adb_available(event, data) {
    const r = await runAdb(['version']);
    return { success: r.success, output: r.output.split('\n','\r')[0] || '', error: r.error };
}

async function get_devices(event, data) {
    const r = await runAdb(['devices']);
    const devices = [];
    if (r.success) {
        const lines = r.output.split('\n').slice(1);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split('\t');
            if (parts.length >= 2 && (parts[1] === 'device' || parts[1] === 'offline' || parts[1] === 'unauthorized')) {
                const serial = parts[0].trim();
                // 过滤传输层 ID（包含冒号）和空 serial
                if (serial && !serial.includes(':') && serial.length > 0) {
                    devices.push({ serial, state: parts[1] });
                }
            }
        }
    }
    const state = getState();
    const activeSerials = new Set(devices.map(d => d.serial));
    for (const serial of Object.keys(state.authPollingLoops || {})) {
        if (!activeSerials.has(serial)) {
            delete state.authPollingLoops[serial];
            authenticatedDevices.delete(serial);
        }
    }
    return devices;
}

async function authenticate_device(event, { serial }) {
    // 代理到 auth.js 的实现（避免重复定义）
    const auth = require('./auth');
    return auth.authenticate_device(event, { serial });
}

async function run_shell_command(event, { serial, command, timeout }) {
    return await runAdbShell(serial, command, timeout || 30000);
}

async function reboot_recovery(event, { serial }) {
    return await runAdbShell(serial, 'reboot recovery');
}

async function storage_get_space(event, { serial }) {
    const out = await runAdbShell(serial, 'df /data /system');
    return { success: out.success, output: out.output, error: out.error };
}

async function storage_fill_start(event, { serial }) {
    return await runAdbShell(serial, 'dd if=/dev/zero of=/data/fillfile bs=1M');
}

async function storage_fill_clean(event, { serial }) {
    return await runAdbShell(serial, 'rm -f /data/fillfile');
}

async function reboot_device(event, { serial }) {
    return await runAdb(['reboot'], serial);
}

async function enter_fastboot(event, { serial }) {
    return await runAdb(['reboot', 'loader'], serial);
}

async function extract_logs(event, { serial }) {
    const ts = Date.now();
    const zipPath = `/data/${ts}.zip`;
    const zip = await runAdbShell(serial, `zip -9r ${zipPath} /data/applog /data/syslog`, 60000);
    if (zip.success) {
        const logDir = path.join('D:', 'HardWare', 'LOG', serial);
        fs.mkdirSync(logDir, { recursive: true });
        const localZip = path.join(logDir, `${ts}.zip`);
        const localZipFwd = localZip.replace(/\\/g, '/');
        const pull = await runAdb(['pull', zipPath, localZipFwd], serial, 120000);
        await runAdbShell(serial, `rm ${zipPath}`);
        if (pull.success) return { success: true, output: localZip, error: null };
    }
    // Fallback: direct pull
    const logDir2 = path.join('D:', 'HardWare', 'LOG', serial);
    fs.mkdirSync(logDir2, { recursive: true });
    await runAdb(['pull', '/data/applog', path.join(logDir2, 'applog').replace(/\\/g, '/')], serial, 120000);
    await runAdb(['pull', '/data/syslog', path.join(logDir2, 'syslog').replace(/\\/g, '/')], serial, 120000);
    return { success: true, output: logDir2, error: null };
}

async function push_file_to_device(event, { serial, content, destPath }) {
    const tmpPath = path.join(require('os').tmpdir(), `push_${Date.now()}`);
    fs.writeFileSync(tmpPath, content);
    try {
        return await runAdb(['push', tmpPath, destPath], serial, 60000);
    } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
    }
}

async function push_script(event, { serial, localPath, remotePath }) {
    return await runAdb(['push', localPath, remotePath], serial, 30000);
}

let _pullLock = false;
async function pull_file(event, { serial, remotePath, localPath }) {
    while (_pullLock) await new Promise(r => setTimeout(r, 200));
    _pullLock = true;
    try {
        const fs2 = require("fs");
        const path2 = require("path");
        const os = require("os");
        const { spawn } = require("child_process");
        const dir = path2.dirname(localPath);
        const filename = path2.basename(localPath);
        try { fs2.mkdirSync(dir, { recursive: true }); } catch(e) { /* dir may already exist (e.g. drive root) */ }
        const tmpFile = path2.join(os.tmpdir(), "adb_pull_" + Date.now() + "_" + filename);
        const androidPath = remotePath.startsWith("/") ? remotePath : "/" + remotePath;
        return new Promise((resolve) => {
            const proc = spawn("adb", ["-s", serial, "pull", androidPath, tmpFile], { windowsHide: true });
            let stderr = "";
            proc.stderr.on("data", (d) => { stderr += d.toString(); });
            proc.on("close", (code) => {
                if (code === 0 && fs2.existsSync(tmpFile)) {
                    try {
                        fs2.renameSync(tmpFile, localPath);
                        resolve({ success: true, output: "saved to " + localPath });
                    } catch(renameErr) {
                        try {
                            fs2.copyFileSync(tmpFile, localPath);
                            fs2.unlinkSync(tmpFile);
                            resolve({ success: true, output: "copied to " + localPath });
                        } catch(copyErr) {
                            fs2.unlinkSync(tmpFile);
                            resolve({ success: false, output: "rename/copy failed: " + copyErr.message, error: copyErr.message });
                        }
                    }
                } else {
                    if (fs2.existsSync(tmpFile)) fs2.unlinkSync(tmpFile);
                    resolve({ success: false, output: "adb exit " + code + ": " + stderr });
                }
            });
        });
    } finally {
        _pullLock = false;
    }
}

async function log_redirect(event, { serial }) {
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
}

async function read_file_base64(event, { filePath }) {
    try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
        return { success: true, data: `data:${mime};base64,${data.toString('base64')}` };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function get_device_logs(event, { serial, logPath }) {
    const cmd = logPath.includes('syslog')
        ? `cat ${logPath}/*.log 2>/dev/null || echo NO_LOG_FILE`
        : `cat ${logPath}/YD*.log 2>/dev/null || echo NO_LOG_FILE`;
    return await runAdbShell(serial, cmd);
}

async function get_device_info(event, { serial }) {
    const adbShell = (cmd) => runAdbShell(serial, cmd);
    
    // 先用 adb devices -l 获取真实 serial（映射 USB 层 ID → 真实 serial）
    let realSerial = serial;
    const devList = await runAdb(['devices', '-l']);
    if (devList.success) {
        const lines = devList.output.split('\n').slice(1);
        for (const line of lines) {
            const m = line.trim().match(/^(\S+)\s+device\s/);
            if (m && m[1]) {
                realSerial = m[1];
                break; // 取第一个在线设备
            }
        }
    }
    
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
    
    const version = verOut.success && verOut.output ? verOut.output.trim() : '未知版本';
    
    const partition = partOut.success && partOut.output ? partOut.output.trim().replace('[ota_info]', '') : '未知';
    
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
    
    return { serial: realSerial, sku, version, partition, current_slot, battery, memory_mb, cpu_usage, ip };
}

async function keep_screen_on(event, { serial, enable }) {
    if (enable) return await runAdbShell(serial, 'killall -9 input-event-daemon');
    return await runAdbShell(serial, 'nohup /usr/bin/input-event-daemon &');
}

async function check_adb_debug_status(event, { serial }) {
    // 检查 USB 调试保持脚本是否存在
    const r = await runAdbShell(serial, 'if [ -f /userdisk/skip_re/skip_login.sh ]; then echo ENABLED; else echo DISABLED; fi');
    const enabled = r.output?.trim() === 'ENABLED';
    return { success: r.success, output: enabled ? 'enabled' : 'disabled' };
}

async function keep_adb_debug(event, { serial, enable }) {
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
}

async function wifi_connect(event, { serial, ssid, password }) {
    const cmd = password
        ? `hal-wifi scan && hal-wifi connect ${ssid} ${password}`
        : `hal-wifi scan && hal-wifi connect ${ssid}`;
    return await runAdbShell(serial, cmd);
}

async function wifi_disconnect(event, { serial }) {
    return await runAdbShell(serial, 'hal-wifi close');
}

async function wifi_scan(event, data) {
    try {
        const out = require('child_process').execSync('netsh wlan show networks mode=bssid', { windowsHide: true, encoding: 'utf8' });
        return { success: true, output: out, error: null };
    } catch (e) {
        return { success: false, output: '', error: e.message };
    }
}

// CPU usage cache for calculating delta
const cpuStatsCache = new Map();

async function get_performance_monitor(event, { serial }) {
    const adbShell = (cmd) => runAdbShell(serial, cmd);
    
    // 单次批量命令：sysfs + /proc/stat + meminfo + 进程信息全部合并为一次ADB往返
    const batchCmd = `
cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo 0
cat /sys/class/power_supply/battery/voltage_now 2>/dev/null || echo 0
cat /sys/class/power_supply/battery/current_now 2>/dev/null || echo 0
cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0
cat /sys/class/power_supply/battery/temp 2>/dev/null || echo 0
cat /proc/stat | head -1
grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo | awk '{print $2}'
ps w | grep -E 'miniapp|SoundPlayer|CaptureFrame|SoundRecord' | grep -v grep | grep -v logger | grep -v guardian_run | while read -r pid rest; do cmdline=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\\0' ' '); if [ -z "$cmdline" ]; then continue; fi; rss=$(grep VmRSS /proc/$pid/status 2>/dev/null | awk '{print $2}'); thr=$(grep Threads /proc/$pid/status 2>/dev/null | awk '{print $2}'); echo "$pid|$cmdline|\${rss:-0}|\${thr:-0}"; done
`.trim();

    const batchOut = await adbShell(batchCmd);

    const lines = batchOut.output.split('\n');

    const battery_capacity = parseInt(lines[0]) || 0;
    const battery_voltage = parseInt(lines[1]) || 0;
    const battery_current = parseInt(lines[2]) || 0;
    const cpu_temp = parseInt(lines[3]) || 0;
    const battery_temp = parseInt(lines[4]) || 0;
    
    // 用/proc/stat代替top，零开销计算CPU使用率（与上次采样比较）
    let cpu_usr = '0', cpu_sys = '0', cpu_idle = '100';
    const statLine = lines[5];
    if (statLine && statLine.startsWith('cpu ')) {
        const parts = statLine.trim().split(/\s+/).slice(1).map(x => parseInt(x) || 0);
        if (parts.length >= 4) {
            const user = parts[0], nice = parts[1], system = parts[2], idle = parts[3];
            const iowait = parts[4] || 0, irq = parts[5] || 0, softirq = parts[6] || 0;
            const total = user + nice + system + idle + iowait + irq + softirq;
            
            const prev = cpuStatsCache.get(serial);
            if (prev && total > prev.total) {
                const totalDelta = total - prev.total;
                const userDelta = (user + nice) - (prev.user + prev.nice);
                const sysDelta = system - prev.system;
                const idleDelta = (idle + iowait) - (prev.idle + prev.iowait);
                
                cpu_usr = ((userDelta / totalDelta) * 100).toFixed(1);
                cpu_sys = ((sysDelta / totalDelta) * 100).toFixed(1);
                cpu_idle = ((idleDelta / totalDelta) * 100).toFixed(1);
            }
            
            cpuStatsCache.set(serial, { user, nice, system, idle, iowait, irq, softirq, total });
        }
    }
    
    // 解析内存信息（grep+awk已提取纯数字）
    const memLines = lines.slice(6, 11);
    const mem_total_kb = parseInt(memLines[0]) || 0;
    const mem_available_kb = parseInt(memLines[1]) || 0;
    const mem_free_kb = parseInt(memLines[2]) || 0;
    const mem_buffers_kb = parseInt(memLines[3]) || 0;
    const mem_cached_kb = parseInt(memLines[4]) || 0;
    
    // 解析进程信息（从第11行开始，格式：pid|cmdline|rss|threads）
    let miniapp_vmrss = 0, miniapp_threads = 0, miniapp_pid = 0;
    let soundplayer_vmrss = 0, soundplayer_threads = 0, soundplayer_pid = 0;
    let captureframe_vmrss = 0, captureframe_threads = 0, captureframe_pid = 0;
    let soundrecord_vmrss = 0, soundrecord_threads = 0, soundrecord_pid = 0;

    for (let i = 11; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.includes('|')) continue;
        const parts = line.split('|');
        if (parts.length < 4) continue;
        const pid = parseInt(parts[0]) || 0;
        if (pid === 0) continue;
        const cmdline = parts[1] || '';
        const rss = parseInt(parts[2]) || 0;
        const thr = parseInt(parts[3]) || 0;

        // 用cmdline路径匹配进程类型（comm不可靠，SoundPlayer等显示为main）
        if (cmdline.includes('/oem/') && cmdline.includes('SoundPlayer')) {
            soundplayer_pid = pid; soundplayer_vmrss = rss; soundplayer_threads = thr;
        } else if (cmdline.includes('/oem/') && cmdline.includes('SoundRecord')) {
            soundrecord_pid = pid; soundrecord_vmrss = rss; soundrecord_threads = thr;
        } else if (!cmdline.includes('guardian') && !cmdline.includes('runCapFrame') &&
                   (cmdline.includes('CaptureFrame') || cmdline.includes('captureframe'))) {
            captureframe_pid = pid; captureframe_vmrss = rss; captureframe_threads = thr;
        } else if (cmdline.includes('miniapp') && !cmdline.includes('logger')) {
            miniapp_pid = pid; miniapp_vmrss = rss; miniapp_threads = thr;
        }
    }
    
    // 计算内存使用百分比和GB值
    const mem_used_kb = mem_total_kb - mem_available_kb;
    const mem_total_gb = (mem_total_kb / 1024 / 1024).toFixed(2);
    const mem_used_gb = (mem_used_kb / 1024 / 1024).toFixed(2);
    const mem_pct = mem_total_kb > 0 ? ((mem_used_kb / mem_total_kb) * 100).toFixed(1) : 0;
    
    return {
        battery_capacity,
        battery_voltage,
        battery_current,
        cpu_temp,
        battery_temp,
        cpu_usr, cpu_sys, cpu_idle,
        mem_total_kb, mem_available_kb, mem_free_kb, mem_buffers_kb, mem_cached_kb,
        mem_total_gb, mem_used_gb, mem_pct,
        miniapp_pid, miniapp_vmrss, miniapp_threads,
        soundplayer_pid, soundplayer_vmrss, soundplayer_threads,
        captureframe_pid, captureframe_vmrss, captureframe_threads,
        soundrecord_pid, soundrecord_vmrss, soundrecord_threads,
    };
}

module.exports = {
    check_adb_available, get_devices, authenticate_device, run_shell_command,
    reboot_recovery, storage_get_space, storage_fill_start, storage_fill_clean,
    reboot_device, enter_fastboot, extract_logs, push_file_to_device, push_script, pull_file,
    log_redirect, read_file_base64, get_device_logs, get_device_info,
    keep_screen_on, check_adb_debug_status, keep_adb_debug,
    wifi_connect, wifi_disconnect, wifi_scan, get_performance_monitor,
    runAdb, runAdbShell, cleanDeviceSerial,
};
