/**
 * ADB-TOOLS 管理员工具 - 固定密钥版
 * 用于：加密设备密码
 *
 * 用法（PowerShell）：
 *   node admin-tool.js encrypt <密码1> [密码2]...  # 加密密码
 *
 * 说明：
 *   密钥由固定日期字符串派生（见 auth.js getSharedKey）
 *   所有设备用同一套密钥，无需分发 keys.ini
 */

const crypto = require('crypto');

// 与 auth.js 保持一致的密钥派生逻辑
function getSharedKey() {
    return crypto.createHash('sha256')
        .update('2026-06-25')
        .update('ADB_TOOLS_FIXED_KEY_V1')
        .digest();
}

function encrypt(plaintext, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext, key) {
    try {
        const buf = Buffer.from(ciphertext, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const encrypted = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
    } catch {
        return null;
    }
}

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === 'help') {
    console.log(`
ADB-TOOLS 管理员工具
用法：
  node admin-tool.js encrypt <密码1> [密码2]...  加密密码

示例：
  node admin-tool.js encrypt abc123 def456

将输出的加密字符串复制到 auth.js 的 AUTH_KEYS_ENC 数组中。
`);
    process.exit(0);
}

if (cmd === 'encrypt') {
    const passwords = args.slice(1);
    if (passwords.length === 0) {
        console.error('[admin] 错误：请提供至少一个密码');
        process.exit(1);
    }

    const key = getSharedKey();
    console.log(`[admin] 使用固定密钥加密 ${passwords.length} 个密码：\n`);

    passwords.forEach((pwd, i) => {
        const enc = encrypt(pwd, key);
        console.log(`    "${enc}",`);
    });

    console.log(`\n[admin] 验证解密：`);
    passwords.forEach((pwd, i) => {
        const enc = encrypt(pwd, key);
        const dec = decrypt(enc, key);
        const ok = dec === pwd ? '✅' : '❌';
        console.log(`  ${ok} 密码${i + 1}: ${dec === pwd ? pwd : '解密失败'}`);
    });

    console.log(`\n[admin] 将上方加密字符串更新到 electron/modules/auth.js 的 AUTH_KEYS_ENC 数组。`);
} else {
    console.error(`[admin] 未知命令：${cmd}`);
    process.exit(1);
}
