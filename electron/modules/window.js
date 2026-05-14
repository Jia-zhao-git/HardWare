// Module: window - Window control operations

const { getState } = require('./context');

async function window_minimize(event, data) {
    const mainWindow = getState().mainWindow;
    if (mainWindow) mainWindow.minimize();
    return { success: true };
}

async function window_maximize(event, data) {
    const mainWindow = getState().mainWindow;
    if (mainWindow) {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
    return { success: true };
}

async function window_close(event, data) {
    const mainWindow = getState().mainWindow;
    if (mainWindow) mainWindow.close();
    return { success: true };
}

module.exports = {
    window_minimize,
    window_maximize,
    window_close,
};
