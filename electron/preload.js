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
});
