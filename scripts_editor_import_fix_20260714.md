# ADB Tools 脚本编辑页面 - 导入脚本运行提示"脚本为空"修复

## 问题
脚本编辑页面（ScriptEditorPage.tsx），通过"导入"按钮导入 `.sh` 脚本文件后，点击"运行"提示"脚本为空"。

## 根因
`handleImportScript` 函数只修改了 `customName` 状态，**从未将导入的脚本内容解析为 `steps`**。点击运行时 `handleRunScript` 检查 `steps.length === 0` 直接返回并提示"脚本为空"。

```tsx
// 原代码 - 只更新了 customName，从未更新 steps
const handleImportScript = async () => {
  ...
  const content = await readTextFile(path)
  setCustomName(`导入_${path.split('/').pop()?.split('.').shift() || '脚本'}`)
  showNotif('success', `已导入脚本文件`)
  // TODO: 更智能的解析逻辑可以将 shell 脚本转换为步骤
}
```

## 修复方案
三层修复：

1. **新增 `importedRawScript` 状态** — 当脚本无法解析为步骤时，保留原始脚本内容。

2. **新增 `parseImportedScript` 解析器** — 尝试将 shell 脚本中的命令映射回步骤类型：
   - `send_event touch press X Y` → 点击 (click)
   - `send_event touch press X1 Y1 + sleep + slip X2 Y2` → 滑动 (slip)
   - `send_event camera press` → 扫描 (stylus)
   - `miniapp_cli start X` → 打开APP (openApp)
   - `sleep X` → 等待 (wait)

3. **运行逻辑适配** — `handleRunScript` 优先使用步骤生成的脚本，其次使用导入的原始脚本：
   ```tsx
   const scriptContent = steps.length > 0 ? scriptPreview : importedRawScript
   ```

4. **UI 适配** — 导入原始脚本时显示"导入脚本 (N 行)"标签；脚本预览区域同步显示导入内容。

## 改动文件
- `src/pages/ScriptEditorPage.tsx` — 约 90 行新增/修改
