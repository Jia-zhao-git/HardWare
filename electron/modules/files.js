// Module: files - dialog & file operations

const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { getState } = require('./context');

// GBK/UTF-8 自动检测解码
function decodeBuffer(raw) {
    // UTF-8 BOM: EF BB BF
    if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
        return raw.toString('utf-8', 3);
    }
    // 先试 UTF-8
    const utf8 = raw.toString('utf-8');
    // 统计替换字符 � (U+FFFD) 比例，超过阈值按 GBK 解码
    let bad = 0;
    for (let i = 0; i < utf8.length; i++) {
        if (utf8.charCodeAt(i) === 0xFFFD ||
            (utf8.charCodeAt(i) >= 0xDC00 && utf8.charCodeAt(i) <= 0xDFFF)) {
            bad++;
        }
    }
    if (bad > Math.max(utf8.length * 0.01, 3)) {
        // GBK
        try {
            return new TextDecoder('gbk').decode(raw);
        } catch (e) {
            return utf8;
        }
    }
    return utf8;
}

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

// 按字节偏移读文件片段，GBK/UTF-8 自动检测
async function readFileRange(event, { path: filePath, start, end }) {
    try {
        const length = end - start;
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, length, start);
        fs.closeSync(fd);
        return { success: true, content: decodeBuffer(buffer) };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 扫描小说文件：返回文件大小 + 开头预览（供百分比跳转用）
async function scanNovelFile(event, { path: filePath }) {
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;

        // 读前 200KB 做预览
        const previewLen = Math.min(200 * 1024, fileSize);
        const raw = Buffer.alloc(previewLen);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, raw, 0, previewLen, 0);
        fs.closeSync(fd);

        const preview = decodeBuffer(raw);
        return { success: true, fileSize, preview };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    dialogOpen,
    dialogSave,
    writeFile,
    readFile,
    readFileRange,
    scanNovelFile,
};
