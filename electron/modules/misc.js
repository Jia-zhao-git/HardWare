// Module: misc - Miscellaneous operations

const fs = require('fs');
const path = require('path');
const { runAdb, runAdbShell } = require('./adb');

// ---- Duration calculation helpers ----
function findLogFiles(dir) {
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...findLogFiles(fullPath));
            } else if (entry.name.endsWith('.log') || entry.name.includes('battery')) {
                results.push(fullPath);
            }
        }
    } catch (e) {}
    return results;
}

function parseLogTimestamp(line) {
    // Try various timestamp formats
    const patterns = [
        /(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2})/,
        /(\d{2}:\d{2}:\d{2})/,
        /(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/,
    ];
    for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
            const ts = new Date(match[1]);
            if (!isNaN(ts.getTime())) return ts;
        }
    }
    return null;
}

function calculateDuration(batteryLogPath) {
    try {
        const content = fs.readFileSync(batteryLogPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return { error: 'Empty log file' };
        
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];
        
        const startTime = parseLogTimestamp(firstLine);
        const endTime = parseLogTimestamp(lastLine);
        
        if (!startTime || !endTime) {
            return { error: 'Could not parse timestamps', start_time: firstLine.slice(0, 50), end_time: lastLine.slice(0, 50) };
        }
        
        const durationMs = endTime - startTime;
        const hours = Math.floor(durationMs / 3600000);
        const minutes = Math.floor((durationMs % 3600000) / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        
        return {
            duration_ms: durationMs,
            duration_formatted: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
            start_time: startTime.toLocaleString('zh-CN'),
            end_time: endTime.toLocaleString('zh-CN'),
        };
    } catch (e) {
        return { error: e.message };
    }
}

async function collect_battery_log(event, { serial }) {
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial);
    fs.mkdirSync(resultDir, { recursive: true });
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
}

module.exports = {
    collect_battery_log,
    calculateDuration,
};
