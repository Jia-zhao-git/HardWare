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

// 按字节范围读取文件片段，避免 20MB+ 大文件全部加载到内存
async function readFileRange(event, { path: filePath, start, end }) {
    try {
        const length = end - start;
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, length, start);
        fs.closeSync(fd);
        return { success: true, content: buffer.toString('utf-8') };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 扫描小说文件章节偏移。只返回 metadata（路径+偏移），不存正文。
// localStorage 上限 ~5MB，20MB 的 txt 正文存不进去，需改为按偏移按需读取。
async function scanNovelFile(event, { path: filePath }) {
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        // 整文件读入内存（Node.js 几百 MB 也没问题，这里不过 IPC，直接内存操作）
        const raw = fs.readFileSync(filePath);
        const content = raw.toString('utf-8');

        // 正则找章节标题
        const CHAPTER_RE = /(?:^|\n)\s*(?:第[零一二三四五六七八九十百千万\d]+[章节回卷]|Chapter\s+\d+|#[^\n]+|(?:序言|前言|后记|尾声|楔子|番外|引子|终章)[^\n]*)\s*(?:\n|$)/g;
        /** @type {{title:string, pos:number}[]} */
        const headers = [];
        let m;
        while ((m = CHAPTER_RE.exec(content)) !== null) {
            headers.push({ title: m[0].trim(), pos: m.index });
        }

        let chapters;
        if (headers.length === 0) {
            chapters = [{ title: '全文', byteStart: 0, byteEnd: content.length }];
        } else {
            chapters = [];
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                const nextPos = i + 1 < headers.length ? headers[i + 1].pos : content.length;
                // 正文从标题行结束（跳过标题+换行）开始
                const titleEnd = content.indexOf('\n', h.pos + h.title.length);
                const bodyStart = titleEnd >= 0 ? titleEnd + 1 : h.pos + h.title.length;
                chapters.push({
                    title: h.title,
                    byteStart: bodyStart,
                    byteEnd: nextPos,
                });
            }
        }

        // 返回元数据 + 第一章预览（限制 500KB 避免 IPC 传回 20MB）
        const previewLen = Math.min(chapters[0].byteEnd - chapters[0].byteStart, 500 * 1024);
        const preview = content.substring(chapters[0].byteStart, chapters[0].byteStart + previewLen);

        return { success: true, chapters, preview, fileSize };
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
