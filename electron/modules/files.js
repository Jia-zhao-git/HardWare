// Module: files - dialog & file operations

const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { getState } = require('./context');

// 修剪末尾不完整的多字节字符（UTF-8 / GBK）
function trimIncompleteChar(buf) {
    if (!buf || buf.length === 0) return buf;
    // 先判断是否 UTF-8（BOM 或低错误率）
    const isUtf8Bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    const sample = buf.toString('utf-8');
    let bad = 0;
    for (let i = 0; i < sample.length; i++) {
        const c = sample.charCodeAt(i);
        if (c === 0xFFFD || (c >= 0xDC00 && c <= 0xDFFF)) bad++;
    }
    if (isUtf8Bom || bad <= Math.max(sample.length * 0.01, 3)) {
        // UTF-8: 从末尾找到完整字符边界
        let i = buf.length - 1;
        while (i > 0 && (buf[i] & 0xC0) === 0x80) i--; // 跳过延续字节
        const lead = buf[i];
        const seqLen = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        if (i + seqLen > buf.length) return buf.subarray(0, i);
        return buf;
    } else {
        // GBK: 双字节，末尾奇数字节可能是半个汉字
        // 简单判断：最后一个字节是否是 GBK 高字节（0x81-0xFE）
        const last = buf[buf.length - 1];
        if (last >= 0x81 && last <= 0xFE) return buf.subarray(0, buf.length - 1);
        return buf;
    }
}

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
        const bytesRead = fs.readSync(fd, buffer, 0, length, start);
        fs.closeSync(fd);
        const raw = bytesRead < length ? buffer.subarray(0, bytesRead) : buffer;
        // 修剪末尾不完整的多字节字符（UTF-8 / GBK）
        const trimmed = trimIncompleteChar(raw);
        return { success: true, content: decodeBuffer(trimmed) };
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
        return { success: true, fileSize, previewBytes: previewLen, preview };
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
