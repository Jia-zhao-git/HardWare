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

/**
 * 解析日志行的时间戳，支持两种格式：
 * 1. 稳定性日志格式: "20251204 22:22:50|capacity|73|..."（YYYYMMDD HH:MM:SS）
 * 2. 功耗日志格式:   "Fri Dec 5 00:02:44 CST 2025|..."（英文日期 + 时区）
 */
function parseLogTimestamp(line) {
    // 格式1: YYYYMMDD HH:MM:SS（稳定性日志）
    const format1 = line.match(/^(\d{8})\s+(\d{2}:\d{2}:\d{2})/);
    if (format1) {
        const ts = new Date(
            parseInt(format1[1].slice(0, 4)),      // year
            parseInt(format1[1].slice(4, 6)) - 1,   // month (0-based)
            parseInt(format1[1].slice(6, 8)),       // day
            parseInt(format1[2].slice(0, 2)),        // hour
            parseInt(format1[2].slice(3, 5)),        // min
            parseInt(format1[2].slice(6, 8))         // sec
        );
        if (!isNaN(ts.getTime())) return { ts, raw: format1[1] + ' ' + format1[2] };
    }
    
    // 格式2: 英文日期格式 "Fri Dec 5 00:02:44 CST 2025"（功耗日志）
    const format2 = line.match(/^([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+[A-Z]+\s+(\d{4})/);
    if (format2) {
        const dateStr = format2[1] + ' ' + format2[2];  // "Fri Dec 5 00:02:44 2025"
        const ts = new Date(dateStr);
        if (!isNaN(ts.getTime())) return { ts, raw: line.split('|')[0] || dateStr };
    }
    
    return null;
}

function calculateDuration(batteryLogPath) {
    try {
        const content = fs.readFileSync(batteryLogPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return { error: '日志文件为空' };
        
        // 过滤有效的时间戳行
        const validLines = [];
        for (const line of lines) {
            const parsed = parseLogTimestamp(line);
            if (parsed) validLines.push({ line, ...parsed });
        }
        
        if (validLines.length < 2) return { error: '未找到足够的时间戳数据' };
        
        const first = validLines[0];
        const last = validLines[validLines.length - 1];
        
        const durationMs = last.ts - first.ts;
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const totalHours = (totalSeconds / 3600).toFixed(2);
        
        return {
            duration_ms: durationMs,
            duration_formatted: ` ${totalHours} 小时`,
            total_hours: parseFloat(totalHours),
            start_time: first.raw,
            end_time: last.raw,
            format_type: 'timestamp_diff',
        };
    } catch (e) {
        return { error: e.message };
    }
}

async function collect_battery_log(event, { serial }) {
    const resultDir = path.join('D:', 'HardWare', 'Stableness', serial);
    fs.mkdirSync(resultDir, { recursive: true });
    const resultDirFwd = resultDir.replace(/\\/g, '/');

    // 只拉取电池日志文件
    const r1 = await runAdb(['pull', '/userdata/battery_info.log', resultDirFwd], serial, 30000);

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

// ---- Script file operations ----
// scriptsDir: 用户配置的本地脚本存放目录
let _scriptsDir = null;

async function set_scripts_dir(event, { dir }) {
    _scriptsDir = dir;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    return { success: true };
}

async function list_scripts(event, { serial }) {
    if (!_scriptsDir) return { success: false, error: 'scripts dir not set', scripts: [] };
    try {
        const metaPath = path.join(_scriptsDir, '.meta.json');
        let meta = {};
        if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
        const files = fs.readdirSync(_scriptsDir)
            .filter(f => f.endsWith('.sh'))
            .map(f => {
                const scriptMeta = meta[f] || {};
                return {
                    name: f.replace(/\.sh$/, ''),
                    filename: f,
                    serial: scriptMeta.serial || '',
                    modified: scriptMeta.modified || fs.statSync(path.join(_scriptsDir, f)).mtime.toISOString(),
                };
            })
            .filter(f => !serial || f.serial === serial);
        return { success: true, scripts: files };
    } catch (e) {
        return { success: false, error: e.message, scripts: [] };
    }
}

async function read_script_file(event, { filename }) {
    if (!_scriptsDir) return { success: false, error: 'scripts dir not set' };
    try {
        const content = fs.readFileSync(path.join(_scriptsDir, filename), 'utf8');
        return { success: true, content };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function write_script_file(event, { filename, content, serial }) {
    if (!_scriptsDir) return { success: false, error: 'scripts dir not set' };
    try {
        fs.mkdirSync(_scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(_scriptsDir, filename), content, 'utf8');
        // 更新 meta
        const metaPath = path.join(_scriptsDir, '.meta.json');
        let meta = {};
        if (fs.existsSync(metaPath)) {
            try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
        }
        meta[filename] = { serial: serial || '', modified: new Date().toISOString() };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function delete_script_file(event, { filename }) {
    if (!_scriptsDir) return { success: false, error: 'scripts dir not set' };
    try {
        const fullPath = path.join(_scriptsDir, filename);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        // 更新 meta
        const metaPath = path.join(_scriptsDir, '.meta.json');
        if (fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                delete meta[filename];
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
            } catch {}
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    collect_battery_log,
    calculateDuration,
    set_scripts_dir,
    list_scripts,
    read_script_file,
    write_script_file,
    delete_script_file,
    generateStabilityReport,
};

async function generateStabilityReport(event, { sn }) {
    const { execFile } = require('child_process');
    try {
        const scriptPath = 'D:\\ADB-TOOLS-V1.0\\.cowork-temp\\stability_batch.py';
        const result = await new Promise((resolve, reject) => {
            execFile('python3', [scriptPath], {
                maxBuffer: 10 * 1024 * 1024,
                timeout: 120000,
            }, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
        const snDir = path.join('D:\\HardWare\\Stableness', sn);
        const htmlPath = path.join(snDir, 'stability_report.html');
        const pngPath = path.join(snDir, 'stability_report.png');
        return {
            success: true,
            html: fs.existsSync(htmlPath) ? htmlPath : null,
            png: fs.existsSync(pngPath) ? pngPath : null,
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
