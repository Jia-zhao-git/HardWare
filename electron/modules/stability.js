// Module: stability - Test management, process control, log collection

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { runAdb, runAdbShell } = require('./adb');
const { calculateDuration } = require('./misc');
const { getState } = require('./context');

async function start_stability_test(event, { serial, testType }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });
        proc.stdout.on('data', (d) => {
            const text = d.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, lines: [text] });
            }
        });
        proc.stderr.on('data', (d) => {
            const text = d.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, type: 'error', lines: [text] });
            }
        });
        proc.on('close', (code) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: code || 0 });
            }
        });
        proc.on('error', (e) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: -1, error: e.message });
            }
            resolve({ success: false, output: '', error: e.message });
        });
        // cd 到 /data/ 目录
        proc.stdin.write('cd /data/\n');
        // chmod 赋权
        proc.stdin.write('chmod +x monkey.sh\n');
        proc.stdin.write('chmod +x grafana.sh\n');
        // 始终先启动 grafana.sh 监控（sh 方式执行）
        proc.stdin.write('nohup sh grafana.sh > /dev/null 2>&1 &\n');
        // 根据 testType 启动 monkey.sh（sh 方式执行）
        if (testType === 'scan') {
            proc.stdin.write('nohup sh monkey.sh ocr > /dev/null 2>&1 &\n');
        } else if (testType === 'random') {
            proc.stdin.write('nohup sh monkey.sh > /dev/null 2>&1 &\n');
        } else if (testType === 'mem') {
            // 内存记录：只启动 grafana 监控，不运行 monkey
        } else {
            proc.stdin.write('nohup sh monkey.sh > /dev/null 2>&1 &\n');
        }
        proc.stdin.write('exit\n');
        resolve({ success: true, output: `已启动${testType}测试 (后台运行)`, error: null });
    });
}

async function start_power_test(event, { serial, testType }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });
        proc.stdout.on('data', (d) => {
            const text = d.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, lines: [text] });
            }
        });
        proc.stderr.on('data', (d) => {
            const text = d.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, type: 'error', lines: [text] });
            }
        });
        proc.on('close', (code) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: code || 0 });
            }
        });
        proc.on('error', (e) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: -1, error: e.message });
            }
            resolve({ success: false, output: '', error: e.message });
        });
        // 根据测试类型执行不同的功耗脚本
        let powerCmd;
        if (testType === 'idle') {
            // 屏幕常亮功耗
            powerCmd = `sh /data/power_test.sh idle &\n`;
        } else if (testType === 'ocr') {
            // 扫描功耗
            powerCmd = `sh /data/power_test.sh ocr &\n`;
        } else {
            // 默认执行
            powerCmd = `sh /data/power_test.sh &\n`;
        }
        proc.stdin.write(powerCmd);
        proc.stdin.write('exit\n');
        resolve({ success: true, output: '已启动功耗测试', error: null });
    });
}

async function query_test_process(event, { serial }) {
    const r = await runAdbShell(serial, 'ps | grep -E "monkey|grafana|power_test|click|print_battery_info" | grep -v grep');
    return { success: r.success, output: r.output || '未运行', error: r.error };
}

async function stop_test_process(event, { serial }) {
    const r = await runAdbShell(serial, 'pkill -9 -f "monkey|grafana|power_test|click|print_battery_info"');
    return { success: r.success, output: r.output || '已停止', error: r.error };
}

async function clear_test_logs(event, { serial }) {
    const r = await runAdbShell(serial, 'rm -rf /userdisk/testlog /userdisk/applog');
    return { success: r.success, output: r.output || '已清除测试日志', error: r.error };
}

async function collect_test_results(event, { serial }) {
    const ts = Date.now();
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial, String(ts));
    fs.mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');
    const r1 = await runAdbShell(serial, `find /userdisk/testlog/grafana -type f 2>/dev/null`);
    if (r1.success && r1.output) {
        const files = r1.output.split('\n').filter(f => f.trim());
        for (const file of files) {
            try {
                const r2 = await runAdbShell(serial, `cat '${file}'`);
                if (r2.success) {
                    const outPath = path.join(resultDirFwd, path.basename(file));
                    fs.writeFileSync(outPath, r2.output, 'utf8');
                }
            } catch {}
        }
    }
    await runAdbShell(serial, `cp /data/battery_log /data/battery_log.bak 2>/dev/null`).catch(() => {});
    const startTime = new Date(ts).toLocaleString('zh-CN');
    return { success: true, output: resultDir, duration: `${Math.floor((Date.now() - ts) / 1000)}s`, error: null, startTime };
}

async function close_stability_process(event, { serial }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
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
        proc.stdin.write("ps | grep power_test | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep print_battery_info | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("exit\n");
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '已关闭稳定性进程', error: null });
        }, 15000);
    });
}

async function close_power_process(event, { serial }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim(), error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("ps | grep power_test | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("ps | grep print_battery_info | awk '{print $1}' | xargs kill -9\n");
        proc.stdin.write("exit\n");
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '已关闭功耗进程', error: null });
        }, 15000);
    });
}

async function clear_stability_log(event, { serial }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim() || '已清除稳定性日志', error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("rm -rf /userdisk/testlog\n");
        proc.stdin.write("rm -rf /userdisk/applog\n");
        proc.stdin.write("exit\n");
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '已清除稳定性日志', error: null });
        }, 10000);
    });
}

async function clear_power_log(event, { serial }) {
    return await runAdbShell(serial, 'rm -f /userdata/battery_info.log');
}

async function start_battery_log(event, { serial }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ["-s", serial, "shell"], { windowsHide: true });
        let output = '';
        let resolved = false;
        const doResolve = (success, out, err) => {
            if (resolved) return;
            resolved = true;
            resolve({ success, output: out, error: err });
        };
        proc.stdout.on("data", (d) => { output += d.toString(); });
        proc.stderr.on("data", (d) => { output += d.toString(); });
        proc.on("close", (code) => { doResolve(code === 0 || code === null, output.trim(), code !== 0 && code !== null ? output.trim() : null); });
        proc.on("error", (e) => { doResolve(false, "", e.message); });
        // nohup + & 保持后台运行，exit 关闭交互 shell，nohup 阻止 SIGHUP 杀死后台进程
        proc.stdin.write("nohup sh /usr/bin/print_battery_info.sh >/dev/null 2>&1 &\n");
        proc.stdin.write("exit\n");
        setTimeout(() => doResolve(true, "电量记录已启动 (后台运行)", null), 1000);
    });
}
async function collect_stability_results(event, { serial }) {

    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial);
    fs.mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');

    // Step 1: 在设备内压缩 /userdisk/testlog/grafana 目录为 zip
    let deviceZipOk = false;
    try {
        const zipResult = await runAdbShell(serial, 
            'cd /userdisk/testlog && zip -r grafana.zip grafana/ 2>/dev/null && echo "ZIP_OK" || echo "ZIP_FAIL"'
        );
        if (zipResult.success && zipResult.output.includes('ZIP_OK')) {
            deviceZipOk = true;
        }
    } catch (e) { /* ignore - 设备可能不支持 zip */ }

    // Step 2: Pull 原始 grafana 目录
    const pullResult = await runAdb(
        ['pull', '/userdisk/testlog/grafana', resultDirFwd],
        serial,
        60000
    );

    // Step 3: Pull 压缩包（如果设备压缩成功）
    let zipPulled = false;
    if (deviceZipOk) {
        try {
            const zipPullResult = await runAdb(
                ['pull', '/userdisk/testlog/grafana.zip', resultDirFwd],
                serial,
                30000
            );
            zipPulled = zipPullResult.success;
        } catch (e) { /* ignore */ }
    }

    // Step 4: 如果设备压缩失败，在本地压缩（作为fallback）
    if (!zipPulled) {
        const grafanaDir = path.join(resultDir, 'grafana');
        if (fs.existsSync(grafanaDir)) {
            try {
                const { execSync } = require('child_process');
                const zipPath = path.join(resultDir, 'grafana.zip');
                execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${grafanaDir}' -DestinationPath '${zipPath}' -Force"`, 
                    { windowsHide: true, timeout: 30000 });
                zipPulled = true;
            } catch (e) { /* ignore */ }
        }
    }

    // 计算日志时长
    let durationInfo = null;
    const grafanaDir = path.join(resultDir, 'grafana');
    if (fs.existsSync(grafanaDir)) {
        const batteryLogPath = path.join(grafanaDir, 'battery_info.log');
        try {
            if (fs.existsSync(batteryLogPath)) {
                const dur = calculateDuration(batteryLogPath);
                if (dur && !dur.error) durationInfo = dur;
            }
        } catch (e) { /* ignore */ }
    }

    // 收集完成后关闭设备上的进程
    try {
        await runAdbShell(serial, 'pkill -9 -f monkey; pkill -9 -f grafana');
        // 清理设备上的临时压缩文件
        await runAdbShell(serial, 'rm -f /userdisk/testlog/grafana.zip');
    } catch (e) { /* ignore */ }

    // 构建详细的结果信息
    let resultMsg = `✅ 收集成功\n📁 路径: ${resultDir}`;
    if (durationInfo) {
        resultMsg += `\n⏱ 时长: ${durationInfo.duration_formatted}`;
        resultMsg += `\n🕐 开始: ${durationInfo.start_time}`;
        resultMsg += `\n🕐 结束: ${durationInfo.end_time}`;
    }
    resultMsg += `\n📦 设备压缩: ${deviceZipOk ? '成功' : '失败(已本地压缩)'}`;
    resultMsg += `\n📥 原始文件: ${pullResult.success ? '已拉取' : '拉取失败'}`;
    resultMsg += `\n🗜️ 压缩包: ${zipPulled ? '已拉取' : '未生成'}`;

    return {
        success: pullResult.success,
        output: resultDir,
        duration: durationInfo,
        error: pullResult.error,
        resultMsg, // 额外返回详细信息给UI展示
    };
}

async function start_log_stream(event, { serial, logType }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => {
            const text = d.toString();
            output += text;
            if (!event.sender.isDestroyed()) {
                event.sender.send('log_stream', { serial, logType, line: text });
            }
        });
        proc.stderr.on('data', (d) => {
            const text = d.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('log_stream', { serial, logType, line: text, type: 'error' });
            }
        });
        proc.on('close', () => {
            resolve({ success: true, output: output.trim(), error: null });
        });
        proc.on('error', (e) => {
            resolve({ success: false, output: '', error: e.message });
        });
        const logCmd = logType === 'app' ? 'logcat -v time' :
                       logType === 'kernel' ? 'dmesg -w' :
                       logType === 'battery' ? 'dumpsys battery' : 'logcat -v time';
        proc.stdin.write(logCmd + '\n');
        proc.stdin.write('exit\n');
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: output.trim(), error: null });
        }, 30000);
    });
}

async function stop_log_stream(event, { serial }) {
    const r = await runAdbShell(serial, 'pkill -9 logcat');
    return { success: r.success, output: '已停止日志流', error: r.error };
}

module.exports = {
    start_stability_test,
    start_power_test,
    query_test_process,
    stop_test_process,
    clear_test_logs,
    collect_test_results,
    close_stability_process,
    close_power_process,
    clear_stability_log,
    clear_power_log,
    start_battery_log,
    collect_stability_results,
    start_log_stream,
    stop_log_stream,
};





