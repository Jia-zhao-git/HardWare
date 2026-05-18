// Module: stability - Test management, process control, log collection

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { runAdbShell } = require('./adb');
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
        // Monkey 测试: 执行 /data/monkey.sh
        const monkeyCmd = `sh /data/monkey.sh &\n`;
        // Grafana 脚本测试: 执行 /data/grafana.sh
        const grafanaCmd = `sh /data/grafana.sh &\n`;
        
        if (testType === 'scan') {
            // 扫描稳定性：传递 scan 参数
            proc.stdin.write(`sh /data/monkey.sh scan &\n`);
        } else if (testType === 'random') {
            // 随机稳定性：传递 random 参数
            proc.stdin.write(`sh /data/monkey.sh random &\n`);
        } else if (testType === 'mem') {
            // 内存记录：传递 mem 参数
            proc.stdin.write(`sh /data/monkey.sh mem &\n`);
        } else if (testType === 'grafana') {
            proc.stdin.write(grafanaCmd);
        } else {
            // 默认执行 monkey.sh
            proc.stdin.write(monkeyCmd);
        }
        proc.stdin.write('exit\n');
        // 不提前关闭，让进程在后台继续运行
        resolve({ success: true, output: `已启动${testType}测试`, error: null });
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
    const r = await runAdbShell(serial, 'ps | grep -E "monkey|grafana|power_test|click" | grep -v grep');
    return { success: r.success, output: r.output || '未运行', error: r.error };
}

async function stop_test_process(event, { serial }) {
    const r = await runAdbShell(serial, 'pkill -9 -f "monkey|grafana|power_test|click"');
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
    return await runAdbShell(serial, 'rm -f /data/battery_info.log');
}

async function start_battery_log(event, { serial }) {
    const adbPath = getState().adbPath || 'adb';
    return new Promise((resolve) => {
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim() || '电量记录已启动', error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("print_battery_info.sh &\n");
        proc.stdin.write("exit\n");
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: '电量记录已启动', error: null });
        }, 10000);
    });
}

async function collect_stability_results(event, { serial }) {
    const { spawn: spawnProc } = require('child_process');
    return new Promise((resolve) => {
        const proc = spawnProc('adb', ['-s', serial, 'shell'], { detached: false, windowsHide: true });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); });
        proc.on('close', () => { resolve({ success: true, output: output.trim(), error: null }); });
        proc.on('error', (e) => { resolve({ success: false, output: '', error: e.message }); });
        proc.stdin.write("cat /userdisk/testlog/grafana/test_result.txt\n");
        proc.stdin.write("exit\n");
        setTimeout(() => {
            try { proc.kill(); } catch {}
            resolve({ success: true, output: output.trim() || '无测试结果', error: null });
        }, 10000);
    });
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
