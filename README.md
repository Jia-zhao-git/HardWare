# 智能硬件 v1.0

基于 Electron + React + TypeScript 的 ADB 调试工具桌面应用。

**作者**: zhaojia08

## 功能特性

- **设备管理**: 查看已连接设备、设备详情（SKU、版本、分区、电量、CPU/内存占用）
- **性能监控**: 实时显示电池、CPU、内存、温度及各进程资源占用
- **Shell 终端**: 交互式 ADB Shell，支持命令历史
- **应用管理**: 安装 APK/AMR 小程序，查看已安装应用列表
- **日志查看**: 实时查看应用日志和系统日志，支持导出
- **测试套件**: 稳定性测试、功耗测试、进程管理
- **工具箱**: 截图、重启、刷机模式、WiFi 扫描、固件检查、日志重定向

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **桌面框架**: Electron 33
- **UI 组件**: Ant Design 6 + Lucide Icons
- **样式**: 自定义 CSS 主题（深色科技风）

## 开发

```bash
# 安装依赖
npm install

# 开发模式（同时启动 Vite 和 Electron）
npm run dev

# 仅启动 Vite 开发服务器
npm run dev:vite

# 仅启动 Electron（需先运行 dev:vite）
npm run dev:electron

# 构建生产版本
npm run build

# 打包便携版
npm run dist
```

## 系统要求

- Windows 10/11
- ADB 工具已安装并添加到 PATH
- Node.js 18+

## 项目结构

```
ADB-TOOLS-V1.0/
├── electron/           # Electron 主进程
│   ├── main.js         # 主进程入口
│   └── preload.js      # 预加载脚本
├── src/                # 渲染进程源码
│   ├── api/            # IPC 桥接
│   ├── pages/          # 页面组件
│   ├── styles/         # 样式文件
│   ├── App.tsx         # 应用主组件
│   └── main.tsx        # 渲染进程入口
├── dist/               # 构建输出（Vite）
├── package.json
└── vite.config.ts
```

## 许可证

MIT
