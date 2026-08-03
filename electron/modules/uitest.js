// Module: uitest - UI Automation Test for Youdao Dictionary Pen
// IPC handlers:
//   uitest_start    { serial, testFile, loops, durationMin }
//   uitest_stop     { serial }
//   uitest_status   {}
//   uitest_list_reports {}
//   uitest_open_report  { reportPath }

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getState } = require('./context');

// --------------------------------------------------------------------------
// Paths
// --------------------------------------------------------------------------
// dictpen-ui tool lives next to ADB-TOOLS root
const DICTPEN_UI_ROOT = path.join(__dirname, '../../dictpen-ui');
const DICTPEN_UI_PY   = path.join(DICTPEN_UI_ROOT, 'dictpen-ui.py');
const RUNS_DIR        = path.join(DICTPEN_UI_ROOT, 'runs');

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------
const testState = {
    running: false,
    serial: null,
    proc: null,
    startTime: null,
    logs: [],      // last 2000 lines
    summaryReport: null,
    cycles: 0,
    lastStatus: 'idle',
    stoppedByUser: false,  // prevent duplicate uitest_done
    preExistingRunDirs: new Set(),  // run dirs that existed before current session
};

function addLog(line) {
    testState.logs.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${line}`);
    if (testState.logs.length > 2000) testState.logs.shift();
}

function broadcastLog(win, line) {
    addLog(line);
    if (win && !win.isDestroyed()) {
        win.webContents.send('uitest_log', { line });
    }
}

// --------------------------------------------------------------------------
// uitest_start
// --------------------------------------------------------------------------
async function uitest_start(event, { serial, testFile, loops, durationMin }) {
    if (testState.running) {
        return { success: false, error: 'Test already running' };
    }
    if (!fs.existsSync(DICTPEN_UI_PY)) {
        return { success: false, error: `dictpen-ui not found: ${DICTPEN_UI_PY}` };
    }
    const testFilePath = path.isAbsolute(testFile)
        ? testFile
        : path.join(DICTPEN_UI_ROOT, testFile);
    if (!fs.existsSync(testFilePath)) {
        return { success: false, error: `Test file not found: ${testFilePath}` };
    }

    const win = event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : null;

    const args = [
        DICTPEN_UI_PY,
        '--serial', serial,
        'run', testFilePath,
        '--loop', String(loops || 0),
    ];
    if (durationMin && durationMin > 0) {
        args.push('--duration', String(durationMin));
    }

    const pythonPath = (() => {
        // Try python3 first, then python, then full path
        const candidates = process.platform === 'win32'
            ? ['python', 'python3', 'py']
            : ['python3', 'python'];
        // Use synchronous which-like check
        const { execSync } = require('child_process');
        for (const cmd of candidates) {
            try {
                execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 3000 });
                return cmd;
            } catch (_) {}
        }
        return candidates[0]; // fallback
    })();
    const proc = spawn(pythonPath, args, {
        cwd: DICTPEN_UI_ROOT,
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1' },
    });

    testState.running    = true;
    testState.stoppedByUser = false;

    // Snapshot existing run dirs so stop-report only includes this session's cycles
    testState.preExistingRunDirs = new Set(
        fs.existsSync(RUNS_DIR)
            ? fs.readdirSync(RUNS_DIR).filter(f => {
                const p = path.join(RUNS_DIR, f, 'run.json');
                return fs.existsSync(p);
              })
            : []
    );
    testState.serial     = serial;
    testState.proc       = proc;
    testState.startTime  = Date.now();
    testState.logs       = [];
    testState.summaryReport = null;
    testState.cycles     = 0;
    testState.lastStatus = 'running';

    broadcastLog(win, `[START] serial=${serial} loops=${loops || '∞'} duration=${durationMin || '—'}min`);

    proc.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        text.split('\n').forEach(line => {
            if (!line.trim()) return;
            broadcastLog(win, line.trim());
            // detect summary_report path
            try {
                const obj = JSON.parse(line.trim());
                if (obj.summary_report) testState.summaryReport = obj.summary_report;
                if (obj.cycle) testState.cycles = obj.cycle;
                if (obj.status) testState.lastStatus = obj.status;
            } catch (_) {}
        });
    });

    proc.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        text.split('\n').forEach(line => {
            if (line.trim()) broadcastLog(win, '[ERR] ' + line.trim());
        });
    });

    proc.on('close', (code) => {
        testState.running  = false;
        testState.proc     = null;
        const msg = `[DONE] exit code=${code} cycles=${testState.cycles}`;
        addLog(msg);
        if (win && !win.isDestroyed()) {
            win.webContents.send('uitest_log', { line: msg });
            // Don't send uitest_done if already stopped by user (report already generated)
            if (!testState.stoppedByUser) {
                win.webContents.send('uitest_done', {
                    code,
                    cycles: testState.cycles,
                    summaryReport: testState.summaryReport,
                    lastStatus: testState.lastStatus,
                });
            }
        }
    });

    return { success: true };
}

// --------------------------------------------------------------------------
// uitest_stop
// --------------------------------------------------------------------------
async function uitest_stop(event, {}) {
    if (!testState.running || !testState.proc) {
        return { success: false, error: 'Not running' };
    }
    try {
        testState.proc.kill('SIGTERM');
        // on Windows SIGTERM may not work; use taskkill
        if (process.platform === 'win32' && testState.proc.pid) {
            spawn('taskkill', ['/F', '/T', '/PID', String(testState.proc.pid)], { windowsHide: true });
        }
        testState.running = false;
        testState.stoppedByUser = true;

        // Generate summary report from existing runs after stopping
        const win = event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : null;
        setTimeout(() => _generate_report_from_runs(win), 1500);

        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

// --------------------------------------------------------------------------
// Internal: generate summary report from runs/ directory
// --------------------------------------------------------------------------
function _generate_report_from_runs(win) {
    if (!fs.existsSync(RUNS_DIR)) return;
    const allDirs = fs.readdirSync(RUNS_DIR)
        .filter(f => { const p = path.join(RUNS_DIR, f, 'run.json'); return fs.existsSync(p); })
        .sort();
    // Only include runs created during this session
    const runDirs = allDirs.filter(d => !testState.preExistingRunDirs.has(d)).slice(-100);
    if (runDirs.length < 1) return;

    // Read all run.json files
    const results = [];
    for (const d of runDirs) {
        try {
            const raw = fs.readFileSync(path.join(RUNS_DIR, d, 'run.json'), 'utf8');
            const r = JSON.parse(raw);
            results.push(r);
        } catch (_) {}
    }
    if (results.length === 0) return;

    // Build simple summary HTML
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const warned = results.filter(r => r.status === 'warned').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const crashes = results.filter(r => r.crash_issues && r.crash_issues.length > 0).length;

    // Memory trend
    const memLabels = [];
    const memData = [];
    for (let i = 0; i < results.length; i++) {
        const ms = results[i].mem_series || [];
        if (ms.length > 0) {
            memLabels.push('c' + (i + 1));
            memData.push(Math.round(ms[0].mem_available_kb / 1024));
        }
    }

    // Failed step summary
    const cycleRows = results.map((r, i) => {
        const failedSteps = (r.steps || []).filter(s => s.status === 'failed');
        const crashCell = (r.crash_issues && r.crash_issues.length > 0)
            ? r.crash_issues.map(c => c.proc + '(' + c.issue + ')').join(', ')
            : 'OK';
        const ms = r.mem_series || [];
        const memS = ms.length > 0 ? Math.round(ms[0].mem_available_kb / 1024) : '?';
        const memE = ms.length > 0 ? Math.round(ms[ms.length - 1].mem_available_kb / 1024) : '?';
        const failedNames = failedSteps.map(s => s.name).join('; ') || '-';
        return `<tr>
  <td>${i + 1}</td>
  <td>${r.run_id || ''}</td>
  <td class="${r.status}">${r.status || '?'}</td>
  <td>${crashCell}</td>
  <td>${memS}</td>
  <td>${memE}</td>
  <td style="font-size:11px">${failedNames}</td>
</tr>`;
    }).join('\n');

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const outPath = path.join(RUNS_DIR, `summary-${ts}.html`);

    const html = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>DictPen Report</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#fafafa}
table{border-collapse:collapse;width:100%;background:#fff;margin-bottom:16px}
td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top}
th{background:#f0f0f0}
.passed{color:#148a08;font-weight:700}
.warned{color:#b07800;font-weight:700}
.failed{color:#c00;font-weight:700}
.stat{display:inline-block;margin:8px 12px 8px 0;padding:10px 18px;border:1px solid #ddd;background:#fff;border-radius:6px;font-size:18px}
canvas{max-width:960px;width:100%;background:#fff;border:1px solid #ddd;display:block;margin-bottom:24px}
</style>
<h1>DictPen UI Test Report (Stopped)</h1>
<p>Generated: ${now.toLocaleString('zh-CN')} &nbsp; Cycles: ${total}</p>
<div>
  <div class='stat'>Cycles<br><b>${total}</b></div>
  <div class='stat passed'>Passed<br><b>${passed}</b></div>
  <div class='stat warned'>Warned<br><b>${warned}</b></div>
  <div class='stat failed'>Failed<br><b>${failed}</b></div>
  <div class='stat ${crashes ? 'failed' : 'passed'}'>Crashes<br><b>${crashes}</b></div>
</div>
<h2>Memory Available (MB)</h2>
<canvas id="c" height="60"></canvas>
<script>
(function(){
  var L=${JSON.stringify(memLabels)},D=${JSON.stringify(memData)};
  var c=document.getElementById('c'),ctx=c.getContext('2d');
  var W=960,H=120;c.width=W;c.height=H;var n=D.length;
  if(n<1)return;
  var max=Math.max.apply(null,D),min=Math.min.apply(null,D);
  var pad={l:60,r:120,t:14,b:26},w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  function sx(i){return pad.l+(n<2?w/2:i/(n-1)*w)}
  function sy(v){return pad.t+h-((v-min)/((max-min)||1))*h}
  ctx.strokeStyle='#eee';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){var y=pad.t+g*h/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();ctx.fillStyle='#888';ctx.font='11px sans-serif';ctx.textAlign='right';ctx.fillText(Math.round(min+(max-min)*(1-g/4))+'MB',pad.l-4,y+4)}
  ctx.strokeStyle='#1a7';ctx.lineWidth=2;ctx.beginPath();
  D.forEach(function(v,i){i===0?ctx.moveTo(sx(i),sy(v)):ctx.lineTo(sx(i),sy(v))});
  ctx.stroke();
  var step=Math.max(1,Math.floor(n/20));
  ctx.fillStyle='#555';ctx.font='10px sans-serif';ctx.textAlign='center';
  L.forEach(function(l,i){if(i%step===0)ctx.fillText(l,sx(i),H-4)});
  ctx.fillStyle='#1a7';ctx.fillRect(W-120,8,14,4);ctx.fillStyle='#333';ctx.textAlign='left';ctx.font='11px sans-serif';ctx.fillText('Available MB',W-102,16);
})();
</script>
<h2>Cycles</h2>
<table><tr><th>#</th><th>Run ID</th><th>Status</th><th>Process</th><th>Mem Start</th><th>Mem End</th><th>Failed Steps</th></tr>
${cycleRows}
</table>
</html>`;
    fs.writeFileSync(outPath, html, 'utf8');
    testState.summaryReport = outPath;
    addLog('[REPORT] Summary generated: ' + outPath);
    if (win && !win.isDestroyed()) {
        win.webContents.send('uitest_log', { line: '[REPORT] Summary report: ' + path.basename(outPath) });
        win.webContents.send('uitest_done', {
            code: 0,
            cycles: testState.cycles,
            summaryReport: outPath,
            lastStatus: testState.lastStatus,
        });
    }
}

// --------------------------------------------------------------------------
// uitest_status
// --------------------------------------------------------------------------
async function uitest_status(event, {}) {
    return {
        running: testState.running,
        serial: testState.serial,
        startTime: testState.startTime,
        cycles: testState.cycles,
        lastStatus: testState.lastStatus,
        summaryReport: testState.summaryReport,
        logCount: testState.logs.length,
        recentLogs: testState.logs.slice(-100),
    };
}

// --------------------------------------------------------------------------
// uitest_list_reports  — list summary-*.html under runs/
// --------------------------------------------------------------------------
async function uitest_list_reports(event, {}) {
    if (!fs.existsSync(RUNS_DIR)) return { reports: [] };
    const files = fs.readdirSync(RUNS_DIR)
        .filter(f => f.startsWith('summary-') && f.endsWith('.html'))
        .sort().reverse()
        .slice(0, 20)
        .map(f => ({
            name: f,
            path: path.join(RUNS_DIR, f),
            mtime: fs.statSync(path.join(RUNS_DIR, f)).mtime.toISOString(),
        }));
    return { reports: files };
}

// --------------------------------------------------------------------------
// uitest_open_report  — open HTML in default browser
// --------------------------------------------------------------------------
async function uitest_open_report(event, { reportPath }) {
    try {
        const { shell } = require('electron');
        await shell.openPath(reportPath);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

// --------------------------------------------------------------------------
// uitest_delete_report  — delete a summary report file
// --------------------------------------------------------------------------
async function uitest_delete_report(event, { reportPath }) {
    try {
        if (!fs.existsSync(reportPath)) return { success: false, error: 'File not found' };
        // Security: only allow deleting summary-*.html or run directories under RUNS_DIR
        const p = path.resolve(reportPath);
        const runsDir = path.resolve(RUNS_DIR);
        if (!p.startsWith(runsDir)) return { success: false, error: 'Invalid path' };
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
        } else {
            fs.unlinkSync(p);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

// --------------------------------------------------------------------------
// uitest_list_tests  — list .yaml files in tests/
// --------------------------------------------------------------------------
async function uitest_list_tests(event, {}) {
    const testsDir = path.join(DICTPEN_UI_ROOT, 'tests');
    if (!fs.existsSync(testsDir)) return { tests: [] };
    const files = fs.readdirSync(testsDir)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map(f => ({ name: f, path: path.join(testsDir, f) }));
    return { tests: files, testsDir };
}

// --------------------------------------------------------------------------
// uitest_get_logs
// --------------------------------------------------------------------------
async function uitest_get_logs(event, { offset }) {
    const o = offset || 0;
    return { logs: testState.logs.slice(o), total: testState.logs.length };
}

// --------------------------------------------------------------------------
// uitest_read_test  — read test YAML content
// --------------------------------------------------------------------------
async function uitest_read_test(event, { testFile }) {
    const p = path.isAbsolute(testFile) ? testFile : path.join(DICTPEN_UI_ROOT, testFile);
    if (!fs.existsSync(p)) return { success: false, error: 'File not found: ' + p };
    return { success: true, content: fs.readFileSync(p, 'utf8'), path: p };
}

// --------------------------------------------------------------------------
// uitest_write_test  — save test YAML content
// --------------------------------------------------------------------------
async function uitest_write_test(event, { testFile, content }) {
    const p = path.isAbsolute(testFile) ? testFile : path.join(DICTPEN_UI_ROOT, testFile);
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, 'utf8');
        return { success: true, path: p };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

// --------------------------------------------------------------------------
// uitest_run_gen  — re-generate all-apps.yaml from live device
// --------------------------------------------------------------------------
async function uitest_run_gen(event, { serial }) {
    const genPy = path.join(DICTPEN_UI_ROOT, 'gen_all_apps_test.py');
    if (!fs.existsSync(genPy)) return { success: false, error: 'gen_all_apps_test.py not found' };
    const win = event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : null;
    return new Promise((resolve) => {
        const { execSync } = require('child_process');
        let pythonCmd = 'python';
        try { execSync('python3 --version', { stdio: 'ignore', timeout: 3000 }); pythonCmd = 'python3'; } catch (_) {}
        const env = { ...process.env, PYTHONUTF8: '1' };
        if (serial) env.DICTPEN_SERIAL = serial;
        const proc = require('child_process').spawn(pythonCmd, [genPy], {
            cwd: DICTPEN_UI_ROOT, windowsHide: true, env,
        });
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); if (win && !win.isDestroyed()) win.webContents.send('uitest_log', { line: d.toString().trim() }); });
        proc.stderr.on('data', d => { out += d.toString(); if (win && !win.isDestroyed()) win.webContents.send('uitest_log', { line: '[ERR] ' + d.toString().trim() }); });
        proc.on('close', code => resolve({ success: code === 0, output: out, code }));
    });
}

// --------------------------------------------------------------------------
// uitest_calibrate  — auto-detect touch mapping for the current device
// --------------------------------------------------------------------------
async function uitest_calibrate(event, { serial }) {
    const calPy = path.join(DICTPEN_UI_ROOT, 'dictpen_ui', 'calibrate.py');
    if (!fs.existsSync(calPy)) return { success: false, error: 'calibrate.py not found' };
    const win = event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : null;
    return new Promise((resolve) => {
        const { execSync } = require('child_process');
        let pythonCmd = 'python';
        try { execSync('python3 --version', { stdio: 'ignore', timeout: 3000 }); pythonCmd = 'python3'; } catch (_) {}
        const env = { ...process.env, PYTHONUTF8: '1' };
        const proc = require('child_process').spawn(pythonCmd, [
            '-c',
            `import sys;sys.path.insert(0,'${DICTPEN_UI_ROOT}');from dictpen_ui.calibrate import calibrate;r=calibrate('${serial}');import json;print(json.dumps(r))`
        ], { cwd: DICTPEN_UI_ROOT, windowsHide: true, env });
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); if (win && !win.isDestroyed()) win.webContents.send('uitest_log', { line: d.toString().trim() }); });
        proc.stderr.on('data', d => { out += d.toString(); if (win && !win.isDestroyed()) win.webContents.send('uitest_log', { line: '[ERR] ' + d.toString().trim() }); });
        proc.on('close', code => {
            try {
                const lines = out.trim().split('\n');
                const last = lines[lines.length - 1];
                const result = JSON.parse(last);
                resolve({ success: code === 0, ...result });
            } catch (e) {
                resolve({ success: false, output: out, error: String(e) });
            }
        });
    });
}

// --------------------------------------------------------------------------
// Register all handlers
// --------------------------------------------------------------------------
function register(ipcMain) {
    ipcMain.handle('uitest_start',        uitest_start);
    ipcMain.handle('uitest_stop',         uitest_stop);
    ipcMain.handle('uitest_status',       uitest_status);
    ipcMain.handle('uitest_list_reports', uitest_list_reports);
    ipcMain.handle('uitest_open_report',  uitest_open_report);
    ipcMain.handle('uitest_delete_report',uitest_delete_report);
    ipcMain.handle('uitest_list_tests',   uitest_list_tests);
    ipcMain.handle('uitest_get_logs',     uitest_get_logs);
    ipcMain.handle('uitest_read_test',    uitest_read_test);
    ipcMain.handle('uitest_write_test',   uitest_write_test);
    ipcMain.handle('uitest_run_gen',      uitest_run_gen);
    ipcMain.handle('uitest_calibrate',    uitest_calibrate);
}

module.exports = { register };
