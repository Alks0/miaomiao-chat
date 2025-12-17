# Miaomiao Chat

<div align="center">

**English** | [简体中文](#简体中文)

A feature-rich AI chat frontend application with modular ES6 architecture, supporting desktop, mobile, and web deployment.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.1.6-green.svg)](https://github.com/Alks0/miaomiao-chat/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-orange.svg)](#platform-support)

</div>

---

## Table of Contents

- [Platform Support](#platform-support)
- [Core Features](#core-features)
- [Quick Start](#quick-start)
- [Downloads](#downloads)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Development](#development)
- [License](#license)

---

## Platform Support

- 🖥️ **Electron Desktop**: Windows / macOS / Linux
- 📱 **Android APK**: Native Android application
- 🌐 **Web Version**: Any modern browser

---

## Core Features

### 🤖 AI Chat

**Multi-Provider Support**:
- **Three Native Formats**: Seamless switching between OpenAI / Gemini / Claude APIs
- **Multi-Key Management** (v1.1.1): Configure multiple API keys per provider
  - 4 rotation strategies: round-robin / random / least-used / smart
  - Auto error switching (401/403/429 auto-rotate to next key)
  - Key statistics (usage count, error count, last used time)
- **Streaming Output**: Real-time rendering + performance stats (TTFT/TPS)
- **Extended Thinking**: Support for all three formats
  - OpenAI: `reasoning.effort` (low/medium/high/none)
  - Gemini: `thinkingConfig.level` (0-4) / `budget` (1K-128K tokens)
  - Claude: `thinking.budget_tokens` (custom budget)

**Advanced Parsing**:
- **ThinkTag Parser** (v1.1.1): Auto-extract `<think>...</think>` thinking chains (DeepSeek, etc.)
- **XML Tool Calls**: ReDoS protection, entity escaping, concurrency safety

**Session Management**:
- IndexedDB persistence + background generation
- Full-text search across messages
- Auto-generated titles
- Export/import sessions

**Prefill System** (v1.1.2):
- System Prompt + preset conversations + variable replacement (`{{char}}`, `{{user}}`, `{{date}}`, `{{time}}`)
- Welcome messages for new sessions
- Gemini System Parts (multi-segment system instructions)

**Tools & MCP**:
- MCP protocol support (local + remote)
- Built-in tools (calculator, datetime, etc.)
- Platform auto-detection (Electron/Android/Web)

### 📎 Files & Attachments

**File Upload** (v1.1.2):
- **Images**: JPEG, PNG, GIF, WebP (auto-compressed to 512px)
- **PDF**: Direct base64 transfer (max 20MB)
- **Text**: TXT, MD (decoded and inserted into content)
- Auto-conversion for three formats (OpenAI/Gemini/Claude)

**Clipboard**:
- Paste images with Ctrl+V
- Quote messages in Markdown format

### 💻 UI/UX

**Code Editor** (v1.1.2):
- **Analysis Tab**: Code stats, function/class extraction, dependency analysis
- **Code Tab**: Real-time editing + syntax highlighting + split preview
- **Preview Tab**: iframe preview + console output + fullscreen mode
- Supports 20+ programming languages

**Markdown Rendering**:
- Marked.js parser (GFM + tables)
- Highlight.js (200+ languages)
- KaTeX math formulas (LaTeX support)
- DOMPurify HTML sanitization (XSS protection)

**Code Block Enhancements**:
- Smart folding (auto-fold when >20 lines)
- Smart title generation (from comments/functions/classes/file paths)
- Action buttons (preview, edit, copy, download)

**Responsive Design**:
- Desktop/tablet/phone adaptive (768px breakpoint)
- Touch gesture optimization
- Mobile debugging tools (Eruda on Android)

**Themes**:
- Light/dark mode with smooth transitions
- Pixel Art style custom dialogs

### 🔄 Auto-Update

- **Electron**: Auto-update based on GitHub Releases
- **Android APK**: Hot update with permission handling

---

## Quick Start

### Desktop

1. Download the installer for your platform from [Releases](https://github.com/Alks0/miaomiao-chat/releases)
2. Install/extract and run
3. Auto-update check on first launch
4. Configure API endpoint and key in Settings

### Android

1. Download `app-{version}.apk`
2. Allow "Install from unknown sources"
3. Install and launch
4. Green button (bottom-right) opens Eruda debugging tools
5. Configure API in Settings

### Web

1. Visit the deployed URL
2. Configure API endpoint and key in Settings
3. Start chatting

---

## Downloads

Visit [GitHub Releases](https://github.com/Alks0/miaomiao-chat/releases) to download the latest version:

**Windows**:
- `Miaomiao-Chat-Setup-{version}.exe` - Installer (Recommended)
- `Miaomiao-Chat-{version}-Portable.exe` - Portable

**macOS**:
- `Miaomiao-Chat-{version}.dmg` - DMG package
- `Miaomiao-Chat-{version}-mac.zip` - ZIP archive

**Linux**:
- `Miaomiao-Chat-{version}.AppImage` - AppImage (Recommended)
- `Miaomiao-Chat-{version}.deb` - Debian/Ubuntu package

**Android**:
- `app-{version}.apk` - Android APK (test-signed, all devices supported)

**Web Deployment**:
1. Download source code or web assets from Releases
2. Deploy to any web server (Nginx/Apache/Vercel, etc.)
3. Access `index.html`

---

## Architecture

9-layer modular design (65+ modules):

```
├── Core (4)                    - Core infrastructure
│   ├── state.js                - Global state (90+ properties, optional Proxy reactive)
│   ├── state-mutations.js      - State mutation helpers (immutable update pattern)
│   ├── elements.js             - DOM element cache (Proxy lazy initialization)
│   └── events.js               - EventBus (pub/sub, memory leak detection)
│
├── Utils (10)                  - Utility functions
│   ├── helpers.js              - Utilities (ID gen, HTML escape, base64 images)
│   ├── variables.js            - Variable replacement ({{char}}/{{user}}/{{date}}/{{time}})
│   ├── markdown.js             - Markdown parser (Marked.js + DOMPurify + KaTeX + LRU cache)
│   ├── images.js               - Image compression, format conversion
│   └── ...
│
├── State (6)                   - State persistence
│   ├── storage.js              - IndexedDB manager (4 object stores + fallback)
│   ├── sessions.js             - Session CRUD (background generation support)
│   ├── config.js               - Config persistence (90+ settings)
│   └── ...
│
├── Providers (2)               - Multi-provider management
│   ├── manager.js              - Provider CRUD + multi-key management
│   │                             • Key rotation (4 strategies)
│   │                             • Auto error switching (401/403/429)
│   │                             • Model cache (30 min)
│   └── ui.js                   - Provider UI (split pane + key management)
│
├── Messages (6)                - Message lifecycle
│   ├── renderer.js             - Message rendering (Markdown + code highlighting)
│   ├── editor.js               - Message editing (inline edit mode)
│   ├── converters.js           - Format conversion (OpenAI ↔ Gemini ↔ Claude)
│   └── ...
│
├── API (8)                     - API request builder
│   ├── handler.js              - Request coordinator (streaming/non-streaming dispatch)
│   ├── openai.js               - OpenAI Chat Completions / Responses API
│   ├── gemini.js               - Gemini API (paginated models, System Parts)
│   ├── claude.js               - Claude Messages API
│   └── ...
│
├── Stream (6)                  - Streaming response handling
│   ├── parser-openai.js        - OpenAI SSE parser
│   ├── parser-gemini.js        - Gemini SSE parser (image chunk assembly)
│   ├── parser-claude.js        - Claude SSE parser
│   ├── think-tag-parser.js     - ThinkTag parser (DeepSeek thinking chains)
│   └── ...
│
├── Tools (13)                  - Tool system
│   ├── mcp/client.js           - MCP protocol client (local + remote)
│   ├── mcp/config-converter.js - MCP config import/export (8 quick templates)
│   ├── manager.js              - Tool manager
│   ├── xml-formatter.js        - XML tool call formatter
│   └── builtin/                - Built-in tools
│
├── UI (18+)                    - User interface
│   ├── input.js                - Input handling (file attachments, quoted messages)
│   ├── code-editor-modal.js    - Code editor (analyze/edit/preview)
│   ├── prefill.js              - Prefill system UI
│   └── ...
│
└── Update (2)                  - Auto-update system
    ├── update-modal.js         - Electron update dialog
    └── apk-updater.js          - Android APK hot update
```

### Design Highlights

- **Event-Driven**: EventBus for decoupled communication between modules
- **Reactive State**: Optional Proxy mode for state change listeners
- **LRU Cache**: Markdown parsing cache (last 50 items) for performance
- **Fallback Strategy**: Auto-switch to localStorage when IndexedDB unavailable
- **Concurrency Protection**: Migration lock to prevent data race conditions

---

## Technology Stack

### Frontend Core

- **ES6 Modules**: Native browser support, 93+ modular files
- **Marked.js** ~13.0: Markdown parser (GFM + tables)
- **Highlight.js** ~11.9: Code syntax highlighting (200+ languages)
- **KaTeX** ~0.16: Math formula rendering
- **DOMPurify** ~3.0: HTML sanitization (XSS protection)

### Storage

- **IndexedDB** (primary): 4 object stores
  - `sessions`: Session data (three formats in parallel)
  - `config`: Configuration (current + saved_configs)
  - `preferences`: UI state (sidebar, panel widths, etc.)
  - `quickMessages`: Quick messages
- **localStorage** (fallback): Auto-switch in tracking protection mode
- **Persistence**: `navigator.storage.persist()` to prevent auto-cleanup

### Desktop

- **Electron** ^28.0.0: Desktop application framework
- **electron-builder** ^24.9.1: Packaging tool (Windows/macOS/Linux)
- **electron-updater** ^6.1.7: Auto-update (GitHub Releases)
- **electron-log** ^5.0.1: Logging
- **Security**:
  - `contextIsolation: true` (context isolation)
  - `nodeIntegration: false` (disable Node integration)
  - `preload.js` for secure API exposure

### Mobile

- **Capacitor** ^8.0.0: Cross-platform framework
- **Android Gradle** 8.13.0: Build tool
- **Java 21** + **Kotlin** 2.2.20: Compilation environment
- **Eruda** 3.0.1: Mobile debugging tools (console/network/storage)
- **Capacitor Plugins**:
  - `@capacitor/filesystem`: File system (APK download)
  - `@capacitor/app`: App lifecycle
  - `@capacitor/assets`: Asset generation

### CI/CD

- **GitHub Actions**: Auto-build (triggered by tag push)
- **GitHub Releases**: Distribution channel
- **Build Matrix**: Windows/macOS/Linux parallel builds

---

## Development

### Local Development

```bash
# Clone repository
git clone https://github.com/Alks0/miaomiao-chat.git
cd miaomiao-chat

# Install dependencies
npm install

# Start Electron desktop app
npm start

# Android development
npm run cap:sync    # Sync assets to Android project
npm run cap:open    # Open Android Studio

# Build
npm run dist        # Build all platforms
npm run dist:win    # Windows only
npm run dist:mac    # macOS only
npm run dist:linux  # Linux only
npm run cap:build   # Build Android APK
```

### Release Process

```bash
# Using release script
node scripts/release.js 1.1.6         # Build all (APK + Desktop)
node scripts/release.js 1.1.6 --apk   # APK only
node scripts/release.js 1.1.6 --desktop # Desktop only

# Or trigger GitHub Actions with Git tag
git tag -a v1.1.6 -m "Release version 1.1.6"
git push origin v1.1.6
```

---

## License

MIT

---

## Contributing

Issues and Pull Requests are welcome!

**Development Branch**: `main`
**Stable Releases**: Published via [Releases](https://github.com/Alks0/miaomiao-chat/releases)

---

<div align="center">

Made with ❤️ by [Alks0](https://github.com/Alks0)

</div>

---

# 简体中文

<div align="center">

[English](#miaomiao-chat) | **简体中文**

一个功能丰富的 AI 聊天前端应用，采用模块化 ES6 架构，支持桌面端、移动端和 Web 部署。

[![许可证](https://img.shields.io/badge/许可证-MIT-blue.svg)](LICENSE)
[![版本](https://img.shields.io/badge/版本-1.1.6-green.svg)](https://github.com/Alks0/miaomiao-chat/releases)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-orange.svg)](#平台支持)

</div>

---

## 目录

- [平台支持](#平台支持)
- [核心功能](#核心功能)
- [快速开始](#快速开始-1)
- [下载安装](#下载安装)
- [架构设计](#架构设计-1)
- [技术栈](#技术栈-1)
- [开发](#开发-1)
- [许可证](#许可证-1)

---

## 平台支持

- 🖥️ **Electron 桌面版**: Windows / macOS / Linux
- 📱 **Android APK**: 原生 Android 应用
- 🌐 **Web 版本**: 任意现代浏览器

---

## 核心功能

### 🤖 AI 聊天

**多提供商支持**:
- **三格式原生支持**: OpenAI / Gemini / Claude API 无缝切换
- **多密钥管理** (v1.1.1): 单个提供商支持多个 API 密钥
  - 4 种轮询策略: round-robin（轮询）/ random（随机）/ least-used（最少使用）/ smart（智能）
  - 自动错误切换（401/403/429 自动轮询下一个密钥）
  - 密钥统计（使用次数、错误次数、最后使用时间）
- **流式输出**: 实时渲染 + 性能统计（TTFT/TPS）
- **思维链支持**: Extended Thinking（三格式）
  - OpenAI: `reasoning.effort` (low/medium/high/none)
  - Gemini: `thinkingConfig.level` (0-4) / `budget` (1K-128K tokens)
  - Claude: `thinking.budget_tokens`（自定义预算）

**高级解析**:
- **ThinkTag 解析器** (v1.1.1): 自动提取 `<think>...</think>` 思维链（DeepSeek 等模型）
- **XML 工具调用**: ReDoS 防护、实体转义、并发安全

**会话管理**:
- IndexedDB 持久化 + 后台生成
- 全文搜索消息内容
- 自动标题生成
- 会话导出/导入

**预填充系统** (v1.1.2):
- System Prompt + 预设对话 + 变量替换（`{{char}}`、`{{user}}`、`{{date}}`、`{{time}}`）
- 新会话开场对话
- Gemini System Parts（多段系统指令）

**工具与 MCP**:
- MCP 协议支持（本地 + 远程）
- 内置工具（计算器、日期时间等）
- 平台自动检测（Electron/Android/Web）

### 📎 文件与附件

**文件上传** (v1.1.2):
- **图片**: JPEG, PNG, GIF, WebP（自动压缩到 512px）
- **PDF**: 直接 base64 传输（最大 20MB）
- **文本**: TXT, MD（解码后插入内容）
- 三格式自动转换（OpenAI/Gemini/Claude）

**剪贴板**:
- Ctrl+V 粘贴图片
- Markdown 引用格式

### 💻 UI/UX

**代码编辑器** (v1.1.2):
- **分析标签**: 代码统计、函数/类提取、依赖分析
- **代码标签**: 实时编辑 + 语法高亮 + 左右分栏预览
- **预览标签**: iframe 预览 + 控制台输出 + 全屏预览
- 支持 20+ 编程语言

**Markdown 渲染**:
- Marked.js 解析器（GFM + 表格）
- Highlight.js（200+ 语言）
- KaTeX 数学公式（LaTeX 支持）
- DOMPurify HTML 净化（XSS 防护）

**代码块增强**:
- 智能折叠（超过 20 行自动折叠）
- 智能标题生成（从注释/函数/类/文件路径提取）
- 操作按钮（预览、编辑、复制、下载）

**响应式设计**:
- 桌面/平板/手机自适应（768px 断点）
- 触摸手势优化
- 移动端调试工具（Android 端 Eruda）

**主题**:
- 亮色/暗色主题 + 平滑切换动画
- Pixel Art 风格自定义对话框

### 🔄 自动更新

- **Electron**: 基于 GitHub Releases 的自动更新
- **Android APK**: 热更新 + 权限处理

---

## 快速开始

### 桌面版

1. 从 [Releases](https://github.com/Alks0/miaomiao-chat/releases) 下载对应平台的安装包
2. 安装/解压后运行
3. 首次启动自动检查更新
4. 在设置中配置 API 端点和密钥

### Android 版

1. 下载 `app-{version}.apk`
2. 允许"安装未知来源应用"
3. 安装并打开
4. 右下角绿色按钮可打开 Eruda 调试工具
5. 在设置中配置 API

### Web 版

1. 访问部署的网址
2. 在设置中配置 API 端点和密钥
3. 开始对话

---

## 下载安装

访问 [GitHub Releases](https://github.com/Alks0/miaomiao-chat/releases) 下载最新版本：

**Windows**:
- `Miaomiao-Chat-Setup-{version}.exe` - 安装版（推荐）
- `Miaomiao-Chat-{version}-Portable.exe` - 便携版

**macOS**:
- `Miaomiao-Chat-{version}.dmg` - DMG 安装包
- `Miaomiao-Chat-{version}-mac.zip` - 压缩包

**Linux**:
- `Miaomiao-Chat-{version}.AppImage` - AppImage（推荐）
- `Miaomiao-Chat-{version}.deb` - Debian/Ubuntu 包

**Android**:
- `app-{version}.apk` - Android 安装包（测试签名，支持所有设备）

**Web 部署**:
1. 下载源代码或 Release 中的 Web 资源
2. 部署到任意 Web 服务器（Nginx/Apache/Vercel 等）
3. 访问 `index.html` 即可使用

---

## 架构设计

9 层模块化设计（65+ 模块）：

```
├── Core 层 (4)                 - 核心基础设施
│   ├── state.js                - 全局状态（90+ 属性，可选 Proxy 响应式）
│   ├── state-mutations.js      - 状态变更辅助（不可变更新模式）
│   ├── elements.js             - DOM 元素引用缓存（Proxy 延迟初始化）
│   └── events.js               - EventBus（发布/订阅，内存泄漏检测）
│
├── Utils 层 (10)               - 工具函数库
│   ├── helpers.js              - 工具函数（ID 生成、HTML 转义、base64 图片）
│   ├── variables.js            - 变量替换系统（{{char}}/{{user}}/{{date}}/{{time}}）
│   ├── markdown.js             - Markdown 解析（Marked.js + DOMPurify + KaTeX + LRU 缓存）
│   ├── images.js               - 图片压缩、格式转换
│   └── ...
│
├── State 层 (6)                - 状态持久化
│   ├── storage.js              - IndexedDB 管理（4 个对象存储 + 降级处理）
│   ├── sessions.js             - 会话 CRUD（后台生成支持）
│   ├── config.js               - 配置持久化（90+ 配置项）
│   └── ...
│
├── Providers 层 (2)            - 多提供商管理
│   ├── manager.js              - 提供商 CRUD + 多密钥管理
│   │                             • 密钥轮询（4 种策略）
│   │                             • 自动错误切换（401/403/429）
│   │                             • 模型缓存（30 分钟）
│   └── ui.js                   - 提供商 UI（左右分栏 + 密钥管理界面）
│
├── Messages 层 (6)             - 消息生命周期
│   ├── renderer.js             - 消息渲染（Markdown + 代码高亮）
│   ├── editor.js               - 消息编辑（内联编辑模式）
│   ├── converters.js           - 消息格式转换（OpenAI ↔ Gemini ↔ Claude）
│   └── ...
│
├── API 层 (8)                  - API 请求构建
│   ├── handler.js              - API 请求协调器（流式/非流式分发）
│   ├── openai.js               - OpenAI Chat Completions / Responses API
│   ├── gemini.js               - Gemini API（分页模型、System Parts）
│   ├── claude.js               - Claude Messages API
│   └── ...
│
├── Stream 层 (6)               - 流式响应处理
│   ├── parser-openai.js        - OpenAI SSE 解析
│   ├── parser-gemini.js        - Gemini SSE 解析（图片分块组装）
│   ├── parser-claude.js        - Claude SSE 解析
│   ├── think-tag-parser.js     - ThinkTag 解析器（DeepSeek 思维链）
│   └── ...
│
├── Tools 层 (13)               - 工具系统
│   ├── mcp/client.js           - MCP 协议客户端（本地 + 远程）
│   ├── mcp/config-converter.js - MCP 配置导入/导出（8 种快速模板）
│   ├── manager.js              - 工具管理器
│   ├── xml-formatter.js        - XML 工具调用格式化
│   └── builtin/                - 内置工具
│
├── UI 层 (18+)                 - 用户界面交互
│   ├── input.js                - 输入框处理（文件附件、引用消息）
│   ├── code-editor-modal.js    - 代码编辑器（分析/编辑/预览）
│   ├── prefill.js              - 预填充系统 UI
│   └── ...
│
└── Update 层 (2)               - 自动更新系统
    ├── update-modal.js         - Electron 更新弹窗
    └── apk-updater.js          - Android APK 热更新
```

### 设计特点

- **事件驱动**: EventBus 实现模块间解耦通信
- **响应式状态**: 可选 Proxy 模式，支持状态变更监听
- **LRU 缓存**: Markdown 解析缓存最近 50 项，提升性能
- **降级策略**: IndexedDB 不可用时自动切换 localStorage
- **并发保护**: 数据迁移使用锁机制防止并发冲突

---

## 技术栈

### 前端核心

- **ES6 Modules**: 原生浏览器支持，93+ 模块化文件
- **Marked.js** ~13.0: Markdown 解析（支持 GFM + 表格）
- **Highlight.js** ~11.9: 代码语法高亮（200+ 语言）
- **KaTeX** ~0.16: 数学公式渲染
- **DOMPurify** ~3.0: HTML 净化（XSS 防护）

### 存储系统

- **IndexedDB**（主要存储）: 4 个对象存储
  - `sessions`: 会话数据（三格式并行保存）
  - `config`: 配置（current + saved_configs）
  - `preferences`: UI 状态（侧边栏、面板宽度等）
  - `quickMessages`: 快捷消息
- **localStorage**（降级方案）: 跟踪保护模式下自动切换
- **持久化策略**: `navigator.storage.persist()` 防止自动清理

### 桌面端

- **Electron** ^28.0.0: 桌面应用框架
- **electron-builder** ^24.9.1: 打包工具（支持 Windows/macOS/Linux）
- **electron-updater** ^6.1.7: 自动更新（基于 GitHub Releases）
- **electron-log** ^5.0.1: 日志管理
- **安全配置**:
  - `contextIsolation: true`（上下文隔离）
  - `nodeIntegration: false`（禁用 Node 集成）
  - `preload.js` 安全 API 暴露

### 移动端

- **Capacitor** ^8.0.0: 跨平台框架
- **Android Gradle** 8.13.0: 构建工具
- **Java 21** + **Kotlin** 2.2.20: 编译环境
- **Eruda** 3.0.1: 移动端调试工具（控制台/网络/存储）
- **Capacitor 插件**:
  - `@capacitor/filesystem`: 文件系统（APK 下载）
  - `@capacitor/app`: 应用生命周期
  - `@capacitor/assets`: 资源生成

### CI/CD

- **GitHub Actions**: 自动构建（推送标签触发）
- **GitHub Releases**: 分发渠道
- **构建矩阵**: Windows/macOS/Linux 并行构建

---

## 开发

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/Alks0/miaomiao-chat.git
cd miaomiao-chat

# 安装依赖
npm install

# 启动 Electron 桌面版
npm start

# Android 开发
npm run cap:sync    # 同步资源到 Android 项目
npm run cap:open    # 打开 Android Studio

# 构建
npm run dist        # 构建所有平台
npm run dist:win    # 仅 Windows
npm run dist:mac    # 仅 macOS
npm run dist:linux  # 仅 Linux
npm run cap:build   # 构建 Android APK
```

### 发布流程

```bash
# 使用发布脚本
node scripts/release.js 1.1.6         # 构建全部（APK + Desktop）
node scripts/release.js 1.1.6 --apk   # 只构建 APK
node scripts/release.js 1.1.6 --desktop # 只构建桌面端

# 或使用 Git 标签触发 GitHub Actions
git tag -a v1.1.6 -m "Release version 1.1.6"
git push origin v1.1.6
```

---

## 许可证

MIT

---

## 贡献

欢迎提交 Issue 和 Pull Request！

**开发分支**: `main`
**稳定版本**: 通过 [Releases](https://github.com/Alks0/miaomiao-chat/releases) 发布

---

<div align="center">

Made with ❤️ by [Alks0](https://github.com/Alks0)

</div>
