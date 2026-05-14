// electron/main.js - Modular router (~250 lines)

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Module imports
// ============================================================================
const { getState, setState } = require('./modules/context');
const httpServer = require('./modules/http-server');

// IPC handler modules
const adb = require('./modules/adb');
const auth = require('./modules/auth');
const files = require('./modules/files');
const misc = require('./modules/misc');
const scripts = require('./modules/scripts');
const stability = require('./modules/stability');
const tools = require('./modules/tools');
const window = require('./modules/window');

// ============================================================================
// Shared state
// ============================================================================
let mainWindow = null;
const authPollingLoops = {};
const scriptProcesses = new Map(); // modules use .get()/.set()
const logStreamProcesses = new Map();

// ============================================================================
// Helpers
// ============================================================================
function getPreloadPath() {
    return path.join(__dirname, 'preload.js');
}

function getDistPath() {
    if (process.env.NODE_ENV === 'development') {
        return null;
    }
    const asarUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist');
    if (fs.existsSync(asarUnpacked)) {
        return asarUnpacked;
    }
    return path.join(__dirname, '../dist');
}

// ============================================================================
// Window
// ============================================================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 650,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: getPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
        },
        frame: false,
        show: false,
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.webContents.on('did-fail-load', (evt, code, desc) => {
        console.error('[FAIL LOAD]', code, desc);
    });

    // Suppress known DevTools warnings
    mainWindow.webContents.on('console-message', (evt, level, message) => {
        if (message.includes('Unknown VE context') ||
            message.includes('Autofill.enable') ||
            message.includes('Autofill.setAddresses')) {
            return;
        }
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // Production: load from asar
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================================
// IPC Handlers - ADB module
// ============================================================================
function registerADBHandlers() {
    if (adb.check_adb_available) ipcMain.handle('check_adb_available', adb.check_adb_available);
    if (adb.get_devices) ipcMain.handle('get_devices', adb.get_devices);
    if (adb.run_shell_command) ipcMain.handle('run_shell_command', adb.run_shell_command);
    if (adb.push_file_to_device) ipcMain.handle('push_file_to_device', adb.push_file_to_device);
    if (adb.get_device_info) ipcMain.handle('get_device_info', adb.get_device_info);
    if (adb.get_performance_monitor) ipcMain.handle('get_performance_monitor', adb.get_performance_monitor);
    if (adb.reboot_device) ipcMain.handle('reboot_device', adb.reboot_device);
    if (adb.reboot_recovery) ipcMain.handle('reboot_recovery', adb.reboot_recovery);
    if (adb.enter_fastboot) ipcMain.handle('enter_fastboot', adb.enter_fastboot);
    if (adb.storage_get_space) ipcMain.handle('storage_get_space', adb.storage_get_space);
    if (adb.storage_fill_start) ipcMain.handle('storage_fill_start', adb.storage_fill_start);
    if (adb.storage_fill_clean) ipcMain.handle('storage_fill_clean', adb.storage_fill_clean);
    if (adb.keep_screen_on) ipcMain.handle('keep_screen_on', adb.keep_screen_on);
    if (adb.check_adb_debug_status) ipcMain.handle('check_adb_debug_status', adb.check_adb_debug_status);
    if (adb.keep_adb_debug) ipcMain.handle('keep_adb_debug', adb.keep_adb_debug);
    if (adb.wifi_scan) ipcMain.handle('wifi_scan', adb.wifi_scan);
    if (adb.wifi_connect) ipcMain.handle('wifi_connect', adb.wifi_connect);
    if (adb.wifi_disconnect) ipcMain.handle('wifi_disconnect', adb.wifi_disconnect);
    if (adb.extract_logs) ipcMain.handle('extract_logs', adb.extract_logs);
    if (adb.push_script) ipcMain.handle('push_script', adb.push_script);
    if (adb.log_redirect) ipcMain.handle('log_redirect', adb.log_redirect);
    if (adb.read_file_base64) ipcMain.handle('read_file_base64', adb.read_file_base64);
    if (adb.get_device_logs) ipcMain.handle('get_device_logs', adb.get_device_logs);
}

// ============================================================================
// IPC Handlers - Auth module
// ============================================================================
function registerAuthHandlers() {
    if (auth.authenticate_device) ipcMain.handle('authenticate_device', auth.authenticate_device);
    if (auth.auth_auto_start) ipcMain.handle('auth_auto_start', auth.auth_auto_start);
    if (auth.auth_auto_stop) ipcMain.handle('auth_auto_stop', auth.auth_auto_stop);
    if (auth.auth_auto_status) ipcMain.handle('auth_auto_status', auth.auth_auto_status);
    if (auth.auth_state_subscribe) {
        ipcMain.on('auth_state_subscribe', (event) => auth.auth_state_subscribe(event));
    }
    if (auth.device_change_subscribe) {
        ipcMain.on('device_change_subscribe', (event) => auth.device_change_subscribe(event));
    }
}

// ============================================================================
// IPC Handlers - Files module (dialogOpen, dialogSave, writeFile, readFile)
// ============================================================================
function registerFileHandlers() {
    // dialog:open
    ipcMain.handle('dialog:open', async (event, options) => {
        const result = await dialog.showOpenDialog(mainWindow, options);
        return result.canceled ? null : result.filePaths[0];
    });
    // dialog:save
    ipcMain.handle('dialog:save', async (event, options) => {
        const result = await dialog.showSaveDialog(mainWindow, options);
        return result.canceled ? null : result.filePath;
    });
    // write_file
    if (files.writeFile) {
        ipcMain.handle('write_file', (event, args) => files.writeFile(args));
    }
    // read_file
    if (files.readFile) {
        ipcMain.handle('read_file', (event, args) => files.readFile(args));
    }
}

// ============================================================================
// IPC Handlers - Tools module
// ============================================================================
function registerToolHandlers() {
    if (tools.screenshot) ipcMain.handle('screenshot', tools.screenshot);
    if (tools.firmware_check) ipcMain.handle('firmware_check', tools.firmware_check);
    if (tools.install_apk) ipcMain.handle('install_apk', tools.install_apk);
    if (tools.install_amr) ipcMain.handle('install_amr', tools.install_amr);
    if (tools.query_app_versions) ipcMain.handle('query_app_versions', tools.query_app_versions);
}

// ============================================================================
// IPC Handlers - Scripts module
// ============================================================================
function registerScriptHandlers() {
    if (scripts.run_script_background) ipcMain.handle('run_script_background', scripts.run_script_background);
    if (scripts.stop_script) ipcMain.handle('stop_script', scripts.stop_script);
    if (scripts.run_script) ipcMain.handle('run_script', scripts.run_script);
    if (scripts.script_output_subscribe) {
        ipcMain.on('script_output_subscribe', (event) => scripts.script_output_subscribe(event));
    }
}

// ============================================================================
// IPC Handlers - Stability module
// ============================================================================
function registerStabilityHandlers() {
    if (stability.start_stability_test) ipcMain.handle('start_stability_test', stability.start_stability_test);
    if (stability.start_power_test) ipcMain.handle('start_power_test', stability.start_power_test);
    if (stability.query_test_process) ipcMain.handle('query_test_process', stability.query_test_process);
    if (stability.stop_test_process) ipcMain.handle('stop_test_process', stability.stop_test_process);
    if (stability.clear_test_logs) ipcMain.handle('clear_test_logs', stability.clear_test_logs);
    if (stability.collect_test_results) ipcMain.handle('collect_test_results', stability.collect_test_results);
    if (stability.close_stability_process) ipcMain.handle('close_stability_process', stability.close_stability_process);
    if (stability.close_power_process) ipcMain.handle('close_power_process', stability.close_power_process);
    if (stability.clear_stability_log) ipcMain.handle('clear_stability_log', stability.clear_stability_log);
    if (stability.clear_power_log) ipcMain.handle('clear_power_log', stability.clear_power_log);
    if (stability.start_battery_log) ipcMain.handle('start_battery_log', stability.start_battery_log);
    if (stability.collect_stability_results) ipcMain.handle('collect_stability_results', stability.collect_stability_results);
    if (stability.start_log_stream) ipcMain.handle('start_log_stream', stability.start_log_stream);
    if (stability.stop_log_stream) ipcMain.handle('stop_log_stream', stability.stop_log_stream);
}

// ============================================================================
// IPC Handlers - Misc module
// ============================================================================
function registerMiscHandlers() {
    if (misc.collect_battery_log) ipcMain.handle('collect_battery_log', misc.collect_battery_log);
}

// ============================================================================
// IPC Handlers - Window module
// ============================================================================
function registerWindowHandlers() {
    if (window.window_minimize) ipcMain.handle('window_minimize', window.window_minimize);
    if (window.window_maximize) ipcMain.handle('window_maximize', window.window_maximize);
    if (window.window_close) ipcMain.handle('window_close', window.window_close);
}

// ============================================================================
// Register all handlers
// ============================================================================
function registerAllHandlers() {
    registerADBHandlers();
    registerAuthHandlers();
    registerFileHandlers();
    registerToolHandlers();
    registerScriptHandlers();
    registerStabilityHandlers();
    registerMiscHandlers();
    registerWindowHandlers();
}

// ============================================================================
// Log buffering (from original main.js)
// ============================================================================
const logFd = fs.openSync(path.join(app.getPath('temp'), 'adb_electron.log'), 'w');
let logBuffer = [];
let logFlushTimer = null;

function flushLogBuffer() {
    if (logBuffer.length === 0) return;
    const msg = logBuffer.join('');
    logBuffer = [];
    try { fs.writeSync(logFd, msg); } catch {}
    try { fs.writeSync(1, msg); } catch {}
}

function writeLog(...args) {
    const msg = args.map(a => String(a)).join(' ') + '\n';
    logBuffer.push(msg);
    if (!logFlushTimer) {
        logFlushTimer = setTimeout(() => {
            logFlushTimer = null;
            flushLogBuffer();
        }, 50);
    }
}

app.on('before-quit', flushLogBuffer);

// ============================================================================
// App lifecycle
// ============================================================================
app.whenReady().then(() => {
    writeLog('[MAIN] App ready');

    // Start HTTP server for production dist/
    const distPath = getDistPath();
    const startApp = () => {
        if (!mainWindow) createWindow();
    };

    if (distPath && process.env.NODE_ENV !== 'development') {
        httpServer.start(distPath, 0).then(port => {
            writeLog('[HTTP] Server started on port', port);
            startApp();
        }).catch(err => {
            writeLog('[HTTP] Failed:', err);
            startApp();
        });
    } else {
        startApp();
    }

    // Initialize shared state AFTER window is created
    setState({
        mainWindow,
        authPollingLoops,
        scriptProcesses,
        logStreamProcesses,
        adbPath: 'adb',
    });

    registerAllHandlers();

    // Start track-devices
    if (adb.startTrackDevices) adb.startTrackDevices();
});

app.on('window-all-closed', () => {
    try { if (adb.stopTrackDevices) adb.stopTrackDevices(); } catch {}
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

module.exports = { getDistPath, createWindow, registerAllHandlers };
