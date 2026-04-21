# GitHub 项目上传指南

## 📋 前置准备

已完成：
- ✅ Git 仓库初始化
- ✅ 首次提交完成
- ✅ 程序打包完成（release/智能硬件-1.0.0.exe）

---

## 🚀 上传到 GitHub 的步骤

### 步骤 1: 创建 GitHub 仓库

1. 访问 https://github.com/new
2. 填写仓库信息：
   - **Repository name**: `adb-tools-v1` 或 `智能硬件-ADB调试工具`
   - **Description**: `基于 Electron + React 的 ADB 设备管理工具，支持性能监控、Shell终端、文件管理等功能`
   - **Visibility**: Public（公开）或 Private（私有）
   - ❌ **不要** 勾选 "Initialize this repository with a README"
   - ❌ **不要** 添加 .gitignore
   - ❌ **不要** 选择 license

3. 点击 "Create repository"

---

### 步骤 2: 关联远程仓库

创建完仓库后，GitHub 会显示类似这样的命令：

```bash
git remote add origin https://github.com/YOUR_USERNAME/adb-tools-v1.git
git branch -M main
git push -u origin main
```

**请执行以下命令**（替换 YOUR_USERNAME 为你的GitHub用户名）：

```bash
# 添加远程仓库
git remote add origin https://github.com/YOUR_USERNAME/adb-tools-v1.git

# 重命名分支为 main
git branch -M main

# 推送到 GitHub
git push -u origin main
```

---

### 步骤 3: 创建 Release（可选但推荐）

#### 方法 A: 通过 GitHub Web 界面

1. 访问你的仓库页面
2. 点击右侧的 "Releases" → "Create a new release"
3. 填写发布信息：
   - **Tag version**: `v1.0.0`
   - **Release title**: `智能硬件 ADB 调试工具 v1.0.0`
   - **Description**: 
     ```markdown
     ## 🎉 首个正式版本
     
     ### ✨ 主要功能
     - 📱 ADB 设备管理
     - 📊 实时性能监控
     - 💻 Shell 终端
     - 📁 文件管理器
     - 📦 应用管理
     - 🎨 8个专业UI主题
     
     ### 🔧 技术栈
     - Electron 33
     - React 19
     - TypeScript
     - Vite
     
     ### 📥 下载
     下载 `智能硬件-1.0.0.exe` 即可使用，无需安装！
     ```
4. 点击 "Attach binaries by dropping them here or selecting them"
5. 上传文件：`release/智能硬件-1.0.0.exe`
6. 点击 "Publish release"

#### 方法 B: 使用 GitHub CLI（如果已安装）

```bash
# 登录 GitHub
gh auth login

# 创建 Release 并上传文件
gh release create v1.0.0 \
  --title "智能硬件 ADB 调试工具 v1.0.0" \
  --notes "## 🎉 首个正式版本

### ✨ 主要功能
- 📱 ADB 设备管理
- 📊 实时性能监控
- 💻 Shell 终端
- 📁 文件管理器
- 📦 应用管理
- 🎨 8个专业UI主题

### 🔧 技术栈
- Electron 33
- React 19
- TypeScript
- Vite

### 📥 下载
下载 \`智能硬件-1.0.0.exe\` 即可使用，无需安装！" \
  ./release/智能硬件-1.0.0.exe
```

---

## 📝 推荐的 README.md 更新

建议在你的 README.md 顶部添加：

```markdown
# 📱 智能硬件 ADB 调试工具

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Electron](https://img.shields.io/badge/Electron-33.4-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

**基于 Electron + React 的现代化 ADB 设备管理工具**

[下载最新版](../../releases/latest) · [报告问题](../../issues) · [功能请求](../../issues)

</div>

---

## ✨ 特性

- 📱 **设备管理** - 查看和管理连接的 ADB 设备
- 📊 **性能监控** - 实时监控 CPU、内存、电池等性能指标
- 💻 **Shell 终端** - 完整的 ADB Shell 支持，虚拟滚动日志查看
- 📁 **文件管理** - 浏览和管理设备文件系统
- 📦 **应用管理** - 安装、卸载、启动应用
- 🎨 **8个专业主题** - 暗夜科技、深空灰、紫罗兰、翡翠绿等
- ⚡ **高性能** - 虚拟滚动优化，流畅处理大量数据
- 🔧 **跨平台** - Windows 便携版，无需安装

## 📥 安装

### Windows

1. 从 [Releases](../../releases/latest) 下载 `智能硬件-1.0.0.exe`
2. 双击运行即可，无需安装！

### 开发模式

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/adb-tools-v1.git
cd adb-tools-v1

# 安装依赖
npm install

# 开发模式
npm run dev

# 打包
npm run dist
```

## 🎨 主题预览

| 主题 | 预览 |
|------|------|
| 🌙 暗夜科技 | 经典深色，专业开发 |
| 🚀 深空灰 | 极简主义，高级质感 |
| 💜 紫罗兰 | 优雅现代，创意美学 |
| 💚 翡翠绿 | 自然清新，护眼舒适 |
| 🧡 琥珀橙 | 温暖活力，激发灵感 |
| 💗 玫瑰粉 | 温柔浪漫，时尚优雅 |
| ☀️ 清新白 | 简约明亮，清爽体验 |
| ⚫ 纯黑OLED | 极致黑色，省电护眼 |

## 🛠️ 技术栈

- **框架**: Electron 33 + React 19
- **语言**: TypeScript 5.8
- **构建**: Vite 7
- **图表**: Recharts 2
- **图标**: Lucide React
- **打包**: electron-builder

## 📄 许可证

MIT License

## 👨‍💻 作者

zhaojia08

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**
```

---

## 🎯 快速命令总结

```bash
# 1. 添加远程仓库（替换 YOUR_USERNAME）
git remote add origin https://github.com/YOUR_USERNAME/adb-tools-v1.git

# 2. 重命名分支
git branch -M main

# 3. 推送代码
git push -u origin main

# 4. 创建标签（可选）
git tag v1.0.0
git push origin v1.0.0
```

---

## 📦 打包文件位置

- **单文件程序**: `release/智能硬件-1.0.0.exe` (约 73 MB)
- **未打包版本**: `release/win-unpacked/` (用于调试)

---

## ⚠️ 注意事项

1. **不要上传敏感信息**
   - 已配置 .gitignore 排除 node_modules、dist、release 等
   - 检查是否有 API keys、密码等

2. **大文件处理**
   - release 文件夹已被忽略
   - 如需在 GitHub 上发布，使用 Releases 功能

3. **后续更新**
   ```bash
   git add .
   git commit -m "描述你的更改"
   git push
   ```

---

**祝你上传顺利！🎉**
