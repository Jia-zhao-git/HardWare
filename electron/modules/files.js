// Module: files - dialog & file operations

const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { getState } = require('./context');

async function dialogOpen(event, options) {
    const mainWindow = getState().mainWindow;
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0];
}

async function dialogSave(event, options) {
    const mainWindow = getState().mainWindow;
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
}

async function writeFile(event, { path: filePath, content }) {
    const mainWindow = getState().mainWindow;
    try {
        fs.writeFileSync(filePath, content);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function readFile(event, { path: filePath }) {
    const mainWindow = getState().mainWindow;
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    dialogOpen,
    dialogSave,
    writeFile,
    readFile,
};
