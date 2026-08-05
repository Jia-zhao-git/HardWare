# ADB Tools 脚本编辑页面修复 — 2026-07-14

## 修复 1：导入脚本后运行提示"脚本为空"

### 问题
`handleImportScript` 仅修改 `customName`，从未更新 `steps` 状态。

### 修复
- 新增 `parseImportedScript()` 解析器 — shell 命令映射回步骤
- 新增 `importedRawScript` 状态 — 无法解析时保留原始内容直接运行
- `handleRunScript`：`scriptContent = steps.length > 0 ? scriptPreview : importedRawScript`

## 修复 2：脚本无法在设备端后台运行

### 问题
原 `run_script_background` 用 `adb shell "nohup ... &"` 直接传参，adb shell 退出时 adbd 会杀掉整个进程组，nohup 无法生效。

### 原因分析（通过设备实测验证）
- 方式1：`adb shell "nohup sh script &"` → ❌ 脚本不运行
- 方式2：`adb shell`（交互式）→ stdin `nohup sh script &` → stdin `exit` → ✅ 脚本正常后台运行
- 原因：交互式 shell 退出时 nohup 进程变成孤儿被 init(PID=1) 接管，而非被 adbd 杀掉

### 修复
**`electron/modules/scripts.js`** — 完全重写 `run_script_background`，改为**交互式 shell 模式**（与 `start_stability_test` 一致）：
```javascript
spawn(adb, ['-s', serial, 'shell'])
→ stdin 'chmod 755 scriptPath'
→ stdin 'nohup sh scriptPath > logPath 2>&1 &'
→ stdin 'exit'
→ Promise resolve with success
```

设备实测验证：脚本循环5次全部完成后日志正确写入 `/data/test_bg.log`。

### 配套前端适配
**`src/pages/ScriptEditorPage.tsx`**：
- `script_done` 不再自动清理 `isRunning`（因为脚本在设备后台持续运行）
- 只有 `code < 0` 才标记为错误并清理 running 状态

## 测试结果
- TypeScript 编译零错误
- 设备实测：交互式 shell → nohup & → exit 模式，脚本成功在设备端后台运行到完成

## 改动文件
- `src/pages/ScriptEditorPage.tsx` — 导入解析 + 运行逻辑适配 + event 处理调整
- `electron/modules/scripts.js` — run_script_background 重写为交互式 shell 模式
