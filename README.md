<div align="center">

<img src="assets/banner.jpg" alt="Miaomiao Chat" width="600">

</div>

<div align="center">

# Miaomiao Chat

**The most configurable AI chat client.**

64+ settings. Three-layer prefill. Three platforms. Zero backend.

[![Release](https://img.shields.io/github/v/release/Alks0/miaomiao-chat?style=flat-square)][release-link]
[![License](https://img.shields.io/github/license/Alks0/miaomiao-chat?style=flat-square)][license-link]
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-blue?style=flat-square)](#downloads)
[![Stars](https://img.shields.io/github/stars/Alks0/miaomiao-chat?style=flat-square)][repo-link]

**English** | [简体中文](#简体中文)

</div>

---

<!-- SCREENSHOT_PLACEHOLDER: Add 1-2 screenshots here (light + dark theme) -->

## What is this

A cross-platform AI chat client that gives you full control over every API parameter, message injection, and tool integration. Runs on desktop, Android, and browser — no server needed.

Most chat clients give you a text box and a temperature slider. This one gives you 64+ configurable options, a three-layer message prefill system, MCP tool support, Computer Use, and the ability to fine-tune every request down to custom HTTP headers.

---

## Features

### Full Control Over Your AI

Other clients give you temperature and max tokens. Miaomiao Chat gives you everything.

- **64+ configurable options** across 17 setting categories
- **6-level thinking intensity** — minimal / low / medium / high / extreme / custom budget (1024–131072 tokens)
- **Cross-format parameter sync** — change temperature in one format, it syncs to all three automatically
- **Output verbosity control** — low / medium / high
- **PDF compatibility mode** — send PDFs as images for APIs that don't support file objects
- **Custom HTTP headers** — add any headers for proxy auth or custom routing
- **XML tool calling fallback** — inject tool descriptions into system prompt when the backend doesn't support native tools
- **Thinking None mode** — explicitly send `reasoning.effort=none` for Responses API
- **Config profiles** — save, switch, and delete named configuration sets including all settings

### Prefill System

The feature no other general-purpose chat client has. Three layers of message injection, each with independent presets.

```
[System Prompt]                     ← Layer 1: system instructions
[Opening Message #1]                ← Layer 2: simulated conversation history
[Opening Message #2]                   (inserted before real messages)
...
[Real conversation history]
...
[User's latest input]
[Prefill Message #1]                ← Layer 3: steering instructions
[Prefill Message #2]                   (inserted after user input, before AI reply)
...
[AI generates response]
```

- **Layer 1 — System Prompt**: with template variables `{{char}}` `{{user}}` `{{date}}` `{{time}}`
- **Layer 2 — Opening Messages**: fake conversation history to establish interaction patterns
- **Layer 3 — Prefill Messages**: per-turn steering appended after user input
- **Preset management** for each layer independently
- **Gemini System Parts**: multi-segment system instructions specific to Gemini API

### Three Platforms, One Codebase

| | Windows | macOS | Linux | Android | Web |
|---|:---:|:---:|:---:|:---:|:---:|
| **Supported** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Install method** | NSIS / Portable | DMG / ZIP | AppImage / DEB | APK | Static deploy |
| **Auto-update** | ✅ | ✅ | ✅ | ✅ (APK hot update) | N/A |

Zero backend. Pure frontend ES6 modules. Deploy to Cloudflare Pages, Vercel, Nginx, or open `index.html` locally.

### Tools & MCP

- **6 built-in tools**: calculator, datetime, unit converter, text formatter, random generator, computer use
- **Full MCP client**: remote (HTTP/WebSocket) on all platforms + local (stdio via IPC) on Electron
- **MCP auto-connect**: saved servers reconnect on startup with state persistence
- **XML tool calling fallback**: for backends that don't support native `tools` parameter
- **Custom tools**: register your own, persisted to IndexedDB

### Computer Use <sup>Electron only</sup>

- Bash command execution with configurable working directory, timeout, and confirmation prompts
- Text file editor (view / create / str_replace / insert)
- Per-capability permissions: enable/disable bash, file editing independently
- Works with Claude native Computer Use (beta header) and OpenAI/Gemini via built-in tool

### Rich Attachments

- **Images**: JPEG, PNG, GIF, WebP — auto-compressed, 2K/4K/fast modes
- **PDF**: standard mode (file object) or compatibility mode (image_url)
- **Text files**: TXT, MD — decoded and injected as document tags
- **Video**: MP4, WebM, MOV, MKV — stored locally on Electron (256MB limit), Data URL on Web
- All formats auto-converted between OpenAI / Gemini / Claude APIs

### Everything Else

- **Multi-reply selector** — generate 1–5 replies per request, browse and pick the best one
- **Streaming stats** — real-time TTFT, token/s, total tokens
- **Session search** — full-text search across all conversations
- **Markdown export** — copy any session as Markdown to clipboard
- **Provider system** — multiple providers with independent endpoints, keys, and model lists
- **Multi-key rotation** — round-robin / random / least-used / smart strategies with auto error switching
- **Thinking chain support** — across all four API formats + `<think>` tag parsing for third-party models
- **Code editor** — analyze, edit, and preview code blocks with 20+ language support
- **Dark/Light theme** — with smooth transition animations
- **Data backup** — granular export/import (config only, sessions only, or everything)

---

## Downloads

<table>
<tr>
<td align="center"><b>Windows</b></td>
<td align="center"><b>macOS</b></td>
<td align="center"><b>Linux</b></td>
<td align="center"><b>Android</b></td>
</tr>
<tr>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">Setup .exe</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">Portable .exe</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.dmg</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.zip</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">AppImage</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.deb</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.apk</a>
</td>
</tr>
</table>

**Web**: Download source and deploy to any static host, or just open `index.html`.

---

## Quick Start

1. Download from [Releases][release-link] for your platform
2. Install and launch
3. Open Settings → configure your API endpoint and key
4. Start chatting

Supports OpenAI, Gemini, Claude, and OpenAI Responses API formats out of the box.

---

## Development

```bash
git clone https://github.com/Alks0/miaomiao-chat.git
cd miaomiao-chat
npm install

# Desktop
npm start

# Android
npm run cap:sync && npm run cap:open

# Build
npm run dist:win      # Windows
npm run dist:mac      # macOS
npm run dist:linux    # Linux
npm run cap:build     # Android APK
```

Release: push a git tag → GitHub Actions builds all platforms automatically.

---

<details>
<summary><b>Tech Stack</b></summary>

**Frontend**: ES6 Modules (90+ files), Marked.js, Highlight.js, KaTeX, DOMPurify

**Storage**: IndexedDB (primary) with localStorage fallback

**Desktop**: Electron ^28, electron-builder, electron-updater

**Mobile**: Capacitor ^8, Android Gradle

**CI/CD**: GitHub Actions, parallel builds for Win/Mac/Linux

**Security**: Context isolation, disabled Node integration, preload API bridge

</details>

---

## Contributing

Issues and PRs welcome. Development happens on `main`.

## License

[MIT](LICENSE)

---

<div align="center">

Made with ❤️ by [Alks0](https://github.com/Alks0)

</div>

---

# 简体中文

<div align="center">

<img src="assets/banner.jpg" alt="Miaomiao Chat" width="600">

</div>

<div align="center">

[English](#miaomiao-chat) | **简体中文**

**最可配置的 AI 聊天客户端。**

64+ 设置项。三层预填充。三端运行。零后端依赖。

[![Release](https://img.shields.io/github/v/release/Alks0/miaomiao-chat?style=flat-square)][release-link]
[![License](https://img.shields.io/github/license/Alks0/miaomiao-chat?style=flat-square)][license-link]
[![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-blue?style=flat-square)](#下载安装)
[![Stars](https://img.shields.io/github/stars/Alks0/miaomiao-chat?style=flat-square)][repo-link]

</div>

---

## 这是什么

一个跨平台 AI 聊天客户端，让你完全掌控每一个 API 参数、消息注入和工具集成。在桌面端、Android 和浏览器上运行，不需要任何服务端。

大多数聊天客户端只给你一个输入框和一个温度滑块。这个给你 64+ 可调选项、三层消息预填充系统、MCP 工具支持、Computer Use，还能精确调整每个请求——包括自定义 HTTP 请求头。

---

## 功能

### 完全掌控你的 AI

- **64+ 可调选项**，分布在 17 个设置分类中
- **6 级思维链强度** — 极简 / 低 / 中 / 高 / 极高 / 自定义预算（1024–131072 tokens）
- **跨格式参数自动同步** — 在一种格式中改了温度，三种格式自动同步
- **输出详细度控制** — 低 / 中 / 高
- **PDF 兼容模式** — 将 PDF 作为图片发送，适配不支持文件对象的 API
- **自定义 HTTP 请求头** — 添加任意请求头，用于代理认证或自定义路由
- **XML 工具调用兜底** — 当后端不支持原生 `tools` 参数时，自动将工具描述注入 system prompt
- **思维链 None 模式** — Responses API 可明确发送 `reasoning.effort=none`
- **配置档案** — 保存、切换、删除命名配置组合，包含所有设置

### 预填充系统

```
[System Prompt]                     ← 第一层：系统指令
[开场对话 #1]                       ← 第二层：模拟对话历史
[开场对话 #2]                          （插入在真实消息之前）
...
[真实对话历史]
...
[用户最新输入]
[预填充消息 #1]                     ← 第三层：引导指令
[预填充消息 #2]                        （插入在用户输入之后、AI 回复之前）
...
[AI 开始生成回复]
```

- **第一层 — System Prompt**：支持模板变量 `{{char}}` `{{user}}` `{{date}}` `{{time}}`
- **第二层 — 开场对话**：伪造对话历史，建立交互模式
- **第三层 — 预填充消息**：每轮追加引导指令
- **每层独立的预设管理**
- **Gemini System Parts**：Gemini API 专属的多段系统指令

### 三端运行，一套代码

| | Windows | macOS | Linux | Android | Web |
|---|:---:|:---:|:---:|:---:|:---:|
| **支持** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **安装方式** | NSIS / 便携版 | DMG / ZIP | AppImage / DEB | APK | 静态部署 |
| **自动更新** | ✅ | ✅ | ✅ | ✅（APK 热更新） | N/A |

零后端依赖。纯前端 ES6 模块。部署到 Cloudflare Pages、Vercel、Nginx，或者直接打开 `index.html`。

### 工具与 MCP

- **6 个内置工具**：计算器、日期时间、单位换算、文本格式化、随机数生成、Computer Use
- **完整 MCP 客户端**：所有平台支持远程（HTTP/WebSocket），Electron 额外支持本地（stdio via IPC）
- **MCP 自动连接**：保存的服务器启动时自动重连，工具状态持久化
- **XML 工具调用兜底**：后端不支持原生 `tools` 参数时的兼容方案
- **自定义工具**：注册你自己的工具，持久化保存到 IndexedDB

### Computer Use <sup>仅 Electron</sup>

- Bash 命令执行，可配置工作目录、超时时间和执行前确认
- 文本文件编辑器（查看 / 创建 / 替换 / 插入）
- 细粒度权限：独立启用/禁用 Bash 和文件编辑
- 兼容 Claude 原生 Computer Use（beta header）和 OpenAI/Gemini（通过内置工具）

### 丰富的附件支持

- **图片**：JPEG, PNG, GIF, WebP — 自动压缩，2K/4K/快速模式
- **PDF**：标准模式（文件对象）或兼容模式（image_url）
- **文本文件**：TXT, MD — 解码后注入为文档标签
- **视频**：MP4, WebM, MOV, MKV — Electron 本地存储（256MB 限制），Web 端用 Data URL
- 所有格式在 OpenAI / Gemini / Claude API 之间自动转换

### 其他功能

- **多回复选择器** — 一次生成 1–5 条回复，浏览并选择最佳
- **流式统计** — 实时首 token 延迟、token/s、总 token 数
- **会话搜索** — 全文搜索所有对话
- **Markdown 导出** — 将会话复制为 Markdown
- **提供商系统** — 多提供商独立配置端点、密钥和模型列表
- **多密钥轮换** — 轮询 / 随机 / 最少使用 / 智能策略，自动错误切换
- **思维链支持** — 覆盖四种 API 格式 + `<think>` 标签解析
- **代码编辑器** — 分析、编辑和预览代码块，支持 20+ 语言
- **深色/浅色主题** — 平滑切换动画
- **数据备份** — 细粒度导出/导入（仅配置、仅会话、或全部）

---

## 下载安装

<table>
<tr>
<td align="center"><b>Windows</b></td>
<td align="center"><b>macOS</b></td>
<td align="center"><b>Linux</b></td>
<td align="center"><b>Android</b></td>
</tr>
<tr>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">安装版 .exe</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">便携版 .exe</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.dmg</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.zip</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">AppImage</a><br>
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.deb</a>
</td>
<td align="center">
<a href="https://github.com/Alks0/miaomiao-chat/releases/latest">.apk</a>
</td>
</tr>
</table>

**Web 版**：下载源码部署到任意静态服务器，或直接打开 `index.html`。

---

## 快速开始

1. 从 [Releases][release-link] 下载对应平台安装包
2. 安装并启动
3. 打开设置 → 配置 API 端点和密钥
4. 开始对话

开箱即用支持 OpenAI、Gemini、Claude 和 OpenAI Responses API 格式。

---

## 开发

```bash
git clone https://github.com/Alks0/miaomiao-chat.git
cd miaomiao-chat
npm install

# 桌面端
npm start

# Android
npm run cap:sync && npm run cap:open

# 构建
npm run dist:win      # Windows
npm run dist:mac      # macOS
npm run dist:linux    # Linux
npm run cap:build     # Android APK
```

发版：推送 git tag → GitHub Actions 自动构建全平台安装包。

---

<details>
<summary><b>技术栈</b></summary>

**前端**：ES6 Modules（90+ 文件）、Marked.js、Highlight.js、KaTeX、DOMPurify

**存储**：IndexedDB（主要）+ localStorage 降级方案

**桌面端**：Electron ^28、electron-builder、electron-updater

**移动端**：Capacitor ^8、Android Gradle

**CI/CD**：GitHub Actions，Win/Mac/Linux 并行构建

**安全**：上下文隔离、禁用 Node 集成、preload API 桥接

</details>

---

## 贡献

欢迎提交 Issue 和 Pull Request。开发在 `main` 分支进行。

## 许可证

[MIT](LICENSE)

---

<div align="center">

Made with ❤️ by [Alks0](https://github.com/Alks0)

</div>

<!-- Link references -->
[release-link]: https://github.com/Alks0/miaomiao-chat/releases
[license-link]: https://github.com/Alks0/miaomiao-chat/blob/main/LICENSE
[repo-link]: https://github.com/Alks0/miaomiao-chat
