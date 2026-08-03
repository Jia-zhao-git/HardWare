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
            win.webContents.send('uitest_done', {
                code,
                cycles: testState.cycles,
                summaryReport: testState.summaryReport,
                lastStatus: testState.lastStatus,
            });
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
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
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
    ipcMain.handle('uitest_list_tests',   uitest_list_tests);
    ipcMain.handle('uitest_get_logs',     uitest_get_logs);
    ipcMain.handle('uitest_read_test',    uitest_read_test);
    ipcMain.handle('uitest_write_test',   uitest_write_test);
    ipcMain.handle('uitest_run_gen',      uitest_run_gen);
    ipcMain.handle('uitest_calibrate',    uitest_calibrate);
}

module.exports = { register };
