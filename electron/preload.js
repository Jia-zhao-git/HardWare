const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    // Dialog
    openFile: (options) => ipcRenderer.invoke('dialog:open', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:save', options),
    // Event listeners for streaming
    on: (channel, callback) => {
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
    // Auth state subscribe
    authStateSubscribe: (callback) => {
        ipcRenderer.send('auth_state_subscribe');
        const listener = (event, state) => callback(state);
        ipcRenderer.on('auth_state_changed', listener);
        return () => ipcRenderer.removeListener('auth_state_changed', listener);
    },
    // Device change subscribe (track-devices 实时设备变化)
    deviceChangeSubscribe: (callback) => {
        ipcRenderer.send('device_change_subscribe');
        const listener = (event, devices) => callback(devices);
        ipcRenderer.on('device_changed', listener);
        return () => ipcRenderer.removeListener('device_changed', listener);
    },
    // Auth device info refresh (认证成功后刷新设备信息)
    onAuthDeviceInfoRefresh: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('auth_device_info_refresh', listener);
        return () => ipcRenderer.removeListener('auth_device_info_refresh', listener);
    },
    // Script output stream (run_script 实时输出)
    onScriptOutput: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('script_output', listener);
        return () => ipcRenderer.removeListener('script_output', listener);
    },
    onScriptDone: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('script_done', listener);
        return () => ipcRenderer.removeListener('script_done', listener);
    },
});
