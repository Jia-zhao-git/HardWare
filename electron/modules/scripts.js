// Module: scripts - ADB script execution (background, interactive, streaming)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getState } = require('./context');

async function run_script_background(event, { serial, scriptPath, logPath }) {
    const adbPath = getState().adbPath || 'adb';
    const proc = spawn(adbPath, ['-s', serial, 'shell', 'sh', scriptPath], {
        windowsHide: true,
        detached: false,
    });
    let output = '';
    proc.stdout.on('data', (d) => {
        const text = d.toString();
        output += text;
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
        // Write log if logPath provided
        if (logPath && output) {
            try {
                fs.mkdirSync(path.dirname(logPath), { recursive: true });
                fs.writeFileSync(logPath, output, 'utf8');
            } catch (e) {
                // ignore write errors
            }
        }
        if (!event.sender.isDestroyed()) {
            event.sender.send('script_done', { serial, code, lines: output.split('\n').filter(l => l.trim()) });
        }
    });
    proc.on('error', (e) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('script_done', { serial, code: -1, error: e.message });
        }
    });
    // Don't keep reference — background script runs independently
    return { success: true, output: '后台脚本已启动', error: null };
}

async function stop_script(event, { serial }) {
    const scriptProcesses = getState().scriptProcesses;
    const info = scriptProcesses.get(serial);
    if (info && info.proc) {
        try {
            info.proc.kill('SIGTERM');
        } catch (e) {
            // ignore
        }
        scriptProcesses.delete(serial);
    }
    return { success: true, output: '脚本已停止', error: null };
}

async function run_script(event, { serial, commands, scriptContent }) {
    // If a script is already running for this device, kill it first
    const scriptProcesses = getState().scriptProcesses || {};
    if (scriptProcesses[serial]) {
        try { scriptProcesses[serial].proc.kill(); } catch {}
        scriptProcesses.delete(serial);
    }

    return new Promise((resolve) => {
        const lines = [];

        // If script content provided, save to temp file first
        let tempScriptPath = null;
        if (scriptContent) {
            tempScriptPath = path.join(os.tmpdir(), `adb_script_${Date.now()}.sh`);
            try {
                fs.writeFileSync(tempScriptPath, scriptContent, 'utf8');
                fs.chmodSync(tempScriptPath, '755');
            } catch (e) {
                resolve({ success: false, output: '', error: `创建临时脚本文件失败: ${e.message}` });
                return;
            }
        }

        const adbPath = getState().adbPath || 'adb';
        const proc = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });

        scriptProcesses.set(serial, { proc, lines });

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            lines.push(...text.split('\n').filter(l => l.trim()));
            // Keep only last 500 lines
            if (lines.length > 500) lines.splice(0, lines.length - 500);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, lines: [...lines] });
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_output', { serial, line: text, type: 'error', lines: [...lines] });
            }
        });

        proc.on('close', (code) => {
            // Clean up temp file
            if (tempScriptPath) {
                try { fs.unlinkSync(tempScriptPath); } catch {}
            }
            scriptProcesses.delete(serial);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code, lines: [...lines] });
            }
            resolve({ success: code === 0, output: lines.join('\n'), error: null });
        });

        proc.on('error', (e) => {
            if (tempScriptPath) {
                try { fs.unlinkSync(tempScriptPath); } catch {}
            }
            scriptProcesses.delete(serial);
            if (!event.sender.isDestroyed()) {
                event.sender.send('script_done', { serial, code: -1, lines: [...lines], error: e.message });
            }
            resolve({ success: false, output: lines.join('\n'), error: e.message });
        });

        // Wait for shell prompt before sending commands
        const waitForPrompt = () => {
            if (proc.killed || proc.exitCode !== null) return;
            proc.stdout.once('data', () => {
                if (proc.killed || proc.exitCode !== null) return;
                sendNext(0);
            });
            // 10s timeout protection
            setTimeout(() => {
                if (scriptProcesses.has(serial)) {
                    try { proc.kill(); } catch {}
                    scriptProcesses.delete(serial);
                }
            }, 10000);
        };

        // Send commands sequentially, waiting for output after each
        const sendNext = (idx) => {
            if (idx >= commands.length || proc.killed || proc.exitCode !== null) {
                if (!proc.killed && proc.exitCode === null) {
                    proc.stdin.write('exit\n');
                }
                return;
            }
            const cmd = commands[idx];
            if (cmd && cmd.trim()) {
                proc.stdin.write(cmd + '\n');
            }
            const onData = (data) => {
                proc.stdout.removeListener('data', onData);
                if (!proc.killed && proc.exitCode === null) {
                    setTimeout(() => sendNext(idx + 1), 100);
                }
            };
            proc.stdout.on('data', onData);
        };

        waitForPrompt();
    });
}

async function script_output_subscribe(event, data) {
    // Frontend registers here; main process pushes script_output/script_done via webContents.send
    // No extra storage needed — each IPC connection is independent
    return { success: true };
}

module.exports = {
    run_script_background,
    stop_script,
    run_script,
    script_output_subscribe,
};
