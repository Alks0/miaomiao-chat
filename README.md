# Miaomiao Chat

一个支持多 API 格式的 AI 聊天前端应用，采用模块化 ES6 架构，支持桌面端、移动端和 Web 部署。

## 平台支持

- 🖥️ **Electron 桌面版**: Windows / macOS / Linux
- 📱 **Android APK**: 原生 Android 应用
- 🌐 **Web 版本**: 任意现代浏览器

## 核心特性

### 聊天功能
- 🔌 **三格式支持**: OpenAI / Gemini / Claude API 无缝切换
- 🌊 **流式输出**: 实时渲染 + 性能统计（TTFT/TPS）
- 🧠 **思维链**: 支持 Extended Thinking（三格式）
  - OpenAI: `reasoning.effort` (low/medium/high/none)
  - Gemini: `thinkingConfig.level` (0-4) / `budget` (1K-128K tokens)
  - Claude: `thinking.budget_tokens` (自定义预算)
- 🏷️ **ThinkTag 解析**: 自动提取 `<think>...</think>` 思维链（DeepSeek 等模型）
- 💬 **会话管理**: IndexedDB 持久化 + 后台生成 + 会话搜索
- 🔑 **多密钥管理**: 提供商支持多 API 密钥 + 4 种轮询策略
  - round-robin（轮询）/ random（随机）/ least-used（最少使用）/ smart（智能）
  - 自动错误切换（401/403/429 自动轮询下一个密钥）
  - 密钥统计（使用次数、错误次数、最后使用时间）
- ⚙️ **配置管理**: 多预设 + 导出/导入 + 自定义 Headers
- 📝 **预填充系统**:
  - System Prompt + 预设对话 + 变量替换（{{char}}/{{user}}/{{date}}/{{time}}）
  - 开场对话（新会话开场白）
  - Gemini System Parts（多段系统指令）
- 💾 **快捷消息**: 分类管理 + 快速插入 + 变量支持
- 🔁 **多回复模式**: 并行生成多个回复 + Tab 切换选择
- 🛠️ **工具系统**: MCP 协议支持（本地 + 远程）+ 内置工具（计算器、日期时间等）

### 文件与附件
- 📎 **文件附件**: 支持上传 PDF/TXT/MD 文件
  - 图片: JPEG, PNG, GIF, WebP（自动压缩到 512px）
  - PDF: 直接 base64 传输（最大 20MB）
  - 文本: TXT, MD（解码后插入内容）
  - 三格式自动转换（OpenAI/Gemini/Claude）
- 📋 **粘贴图片**: Ctrl+V 直接粘贴图片到输入框
- 💬 **引用消息**: Markdown 引用格式

### UI/UX
- 💻 **代码编辑器**: 完整的代码编辑和预览系统
  - 分析标签: 代码统计、函数/类提取、依赖分析
  - 代码标签: 实时编辑 + 语法高亮 + 左右分栏预览
  - 预览标签: iframe 预览 + 控制台输出 + 全屏预览
  - 支持 20+ 编程语言
- 🎨 **代码高亮**: Markdown 渲染 + 200+ 语言智能检测 + KaTeX 数学公式
- 📂 **代码块增强**:
  - 智能折叠（超过 20 行自动折叠）
  - 智能标题生成（从注释/函数/类/文件路径提取）
  - 操作按钮（预览、编辑、复制、下载）
- 🧠 **思维链渲染**: 多阶段折叠 + 实时展开动画
- 📊 **表格导出**: CSV 导出（Excel 兼容） + 行数统计
- 🖼️ **图片查看器**: 全屏预览 + 缩放 + 下载
- 📱 **响应式设计**: 桌面/平板/手机自适应（768px 断点）
- 🎯 **移动端优化**: 所有操作按钮默认显示 + 触摸手势优化
- 💬 **自定义对话框**: Pixel Art 风格，替代原生 prompt/confirm
- 🎨 **双主题支持**: 亮色/暗色主题 + 平滑切换动画
- 🔧 **Eruda 调试工具**: Android 端集成移动调试面板（控制台/网络/存储）

### 桌面/移动端特性
- 🔄 **自动更新**: Electron 和 APK 支持热更新（基于 GitHub Releases）
- 📦 **离线使用**: 完整本地资源，无需网络依赖
- 💾 **数据持久化**: IndexedDB/localStorage 双重备份 + 持久化存储请求
- 🔒 **跟踪保护处理**: 自动检测 IndexedDB 可用性 + localStorage 降级

## 下载安装

### Release 下载
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

### Web 部署
1. 下载源代码或 Release 中的 Web 资源
2. 部署到任意 Web 服务器（Nginx/Apache/Vercel 等）
3. 访问 `index.html` 即可使用

## 快速开始

### 桌面版
1. 下载对应平台的安装包
2. 安装/解压后运行
3. 首次启动会自动检查更新
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

## 架构设计

9 层模块化设计（65+ 模块）：

```
├── Core 层 (4)         - 核心基础设施
│   ├── state.js        - 全局状态（90+ 属性，可选 Proxy 响应式）
│   ├── state-mutations.js - 状态变更辅助（不可变更新模式）
│   ├── elements.js     - DOM 元素引用缓存（Proxy 延迟初始化）
│   └── events.js       - EventBus（发布/订阅，内存泄漏检测）
│
├── Utils 层 (10)       - 工具函数库
│   ├── helpers.js      - 工具函数（ID 生成、HTML 转义、base64 图片）
│   ├── variables.js    - 变量替换系统（{{char}}/{{user}}/{{date}}/{{time}}）
│   ├── markdown.js     - Markdown 解析（Marked.js + DOMPurify + KaTeX + LRU 缓存）
│   ├── images.js       - 图片压缩、格式转换（Canvas API）
│   ├── prefill.js      - 预填充消息构建（三格式转换）
│   ├── errors.js       - 人性化错误渲染
│   ├── dialogs.js      - 自定义对话框（替代 prompt/confirm）
│   └── 其他工具模块...
│
├── State 层 (6)        - 状态持久化
│   ├── storage.js      - IndexedDB 管理（4 个对象存储 + 降级处理）
│   ├── sessions.js     - 会话 CRUD（后台生成支持）
│   ├── config.js       - 配置持久化（90+ 配置项）
│   ├── export-import.js - 数据导出/导入（JSON 格式）
│   ├── quick-messages.js - 快捷消息 CRUD
│   └── migration.js    - 数据迁移（localStorage → IndexedDB）
│
├── Providers 层 (2)    - 多提供商管理
│   ├── manager.js      - 提供商 CRUD + 多密钥管理
│   │                     • 密钥轮询（4 种策略）
│   │                     • 自动错误切换（401/403/429）
│   │                     • 模型缓存（5 分钟）
│   └── ui.js           - 提供商 UI（左右分栏 + 密钥管理界面）
│
├── Messages 层 (6)     - 消息生命周期
│   ├── renderer.js     - 消息渲染（Markdown + 代码高亮 + 思维链折叠）
│   ├── editor.js       - 消息编辑（内联编辑模式）
│   ├── sync.js         - 消息同步到状态（三格式并行保存）
│   ├── converters.js   - 消息格式转换（OpenAI ↔ Gemini ↔ Claude）
│   │                     • 文件附件转换（图片/PDF/文本）
│   ├── restore.js      - 会话恢复
│   └── reply-selector.js - 多回复选择器
│
├── API 层 (8)          - API 请求构建
│   ├── handler.js      - API 请求协调器（流式/非流式分发 + 密钥轮询）
│   ├── openai.js       - OpenAI Chat Completions / Responses API
│   ├── gemini.js       - Gemini API（分页模型、System Parts）
│   ├── claude.js       - Claude Messages API
│   ├── factory.js      - API 工厂模式
│   ├── params.js       - 模型参数构建
│   └── response-parser.js - 响应解析
│
├── Stream 层 (6)       - 流式响应处理
│   ├── parser-openai.js - OpenAI SSE 解析
│   ├── parser-gemini.js - Gemini SSE 解析（图片分块组装）
│   ├── parser-claude.js - Claude SSE 解析
│   ├── think-tag-parser.js - ThinkTag 解析器（DeepSeek 思维链）
│   ├── multi-stream.js  - 并行多流处理
│   ├── helpers.js       - 流式渲染辅助
│   └── stats.js         - 性能统计（TTFT/TPS）
│
├── Tools 层 (13)       - 工具系统
│   ├── mcp/client.js   - MCP 协议客户端
│   │                     • 平台检测（Electron/Android/Web）
│   │                     • 本地 MCP（IPC → stdio）
│   │                     • 远程 MCP（HTTP/WebSocket）
│   ├── manager.js      - 工具管理器（注册/执行/权限）
│   ├── executor.js     - 工具执行器
│   ├── xml-formatter.js - XML 工具调用格式化
│   └── builtin/        - 内置工具（计算器、日期时间等）
│
├── UI 层 (18+)         - 用户界面交互
│   ├── input.js        - 输入框处理
│   │                     • 文件附件支持（最多 10 个，20MB/文件）
│   │                     • 引用消息（Markdown 格式）
│   │                     • 粘贴图片（Ctrl+V）
│   ├── code-editor-modal.js - 代码编辑器
│   │                     • 分析标签（代码统计、函数/类提取）
│   │                     • 代码标签（实时编辑 + 预览）
│   │                     • 预览标签（全屏预览 + 控制台）
│   ├── prefill.js      - 预填充系统 UI
│   │                     • 预填充消息配置
│   │                     • 开场对话设置
│   │                     • Gemini System Parts
│   ├── sidebar.js      - 会话列表侧边栏（拖拽调整）
│   ├── settings.js     - 设置面板
│   ├── models.js       - 模型管理（下拉列表 + API 拉取）
│   └── 其他 UI 模块...
│
└── Update 层 (2)       - 自动更新系统
    ├── update-modal.js - Electron 更新弹窗
    └── apk-updater.js  - Android APK 热更新
```

### 设计特点
- **事件驱动**: EventBus 实现模块间解耦通信
- **响应式状态**: 可选 Proxy 模式，支持状态变更监听
- **LRU 缓存**: Markdown 解析缓存最近 50 项，提升性能
- **降级策略**: IndexedDB 不可用时自动切换 localStorage
- **并发保护**: 数据迁移使用锁机制防止并发冲突

## 技术栈

### 前端核心
- **ES6 Modules**: 原生浏览器支持，65+ 模块化文件
- **Marked.js** ~13.0: Markdown 解析（支持 GFM + 表格）
- **Highlight.js** ~11.9: 代码语法高亮（200+ 语言）
- **KaTeX** ~0.16: 数学公式渲染（LaTeX 支持）
- **DOMPurify** ~3.0: HTML 净化（XSS 防护）

### 存储系统
- **IndexedDB** (主要存储): 4 个对象存储
  - `sessions`: 会话数据（三格式并行保存）
  - `config`: 配置（current + saved_configs）
  - `preferences`: UI 状态（侧边栏、面板宽度等）
  - `quickMessages`: 快捷消息
- **localStorage** (降级方案): 跟踪保护模式下自动切换
- **持久化策略**: `navigator.storage.persist()` 防止自动清理

### 桌面端
- **Electron** ^28.0.0: 桌面应用框架
- **electron-builder** ^24.9.1: 打包工具（支持 Windows/macOS/Linux）
- **electron-updater** ^6.1.7: 自动更新（基于 GitHub Releases）
- **electron-log** ^5.0.1: 日志管理
- **安全配置**:
  - `contextIsolation: true` （上下文隔离）
  - `nodeIntegration: false` （禁用 Node 集成）
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
- **GitHub Releases**: 分发渠道（Electron 安装包 + APK）
- **构建矩阵**: Windows/macOS/Linux 并行构建

## 特色功能详解

### 多密钥管理（v1.1.1）
- 单个提供商支持多个 API 密钥
- 4 种轮询策略：round-robin（轮询）/ random（随机）/ least-used（最少使用）/ smart（智能）
- 自动错误切换：遇到 API 错误（401/403/429）自动轮询下一个密钥
- 密钥统计：使用次数、错误次数、最后使用时间
- 兼容旧配置自动迁移

### ThinkTag 解析器（v1.1.1）
- 提取 `<think>...</think>` 标签中的思考内容
- 流式模式支持增量解析（边收边解析）
- 智能缓冲处理不完整标签
- 适用于 DeepSeek 等模型的思维链输出

### 代码编辑器（v1.1.2）
- **分析标签**: 静态代码分析（函数/类/依赖提取）
- **代码标签**: 实时编辑 + 预览（HTML/CSS/JS）
- **预览标签**: 全屏预览 + 控制台输出
- 支持 20+ 编程语言
- 性能优化（最多分析 2000 行）

### 文件附件支持（v1.1.2）
- **图片**: JPEG, PNG, GIF, WebP（自动压缩到 512px）
- **PDF**: 直接 base64 传输（最大 20MB）
- **文本**: TXT, MD（解码后插入内容）
- 三格式自动转换：
  - OpenAI: `image_url` / `file` / 文本插入
  - Gemini: `inlineData` 统一格式
  - Claude: `image` / `document` / 文本插入

### 预填充系统（v1.1.2）
- **预填充消息**: System Prompt + 预设对话 + 变量替换
- **开场对话**: 新会话开场白
- **Gemini System Parts**: 多段系统指令（Gemini 专属）
- **变量支持**: `{{char}}`, `{{user}}`, `{{date}}`, `{{time}}`

### MCP 协议支持（v1.1.0）
- 统一 MCP 客户端（支持本地 + 远程）
- 平台检测（Electron/Android/Web）
- 协议支持（HTTP/WebSocket/IPC）
- 自动重试和重连机制

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
node scripts/release.js 1.1.2         # 构建全部（APK + Desktop）
node scripts/release.js 1.1.2 --apk   # 只构建 APK
node scripts/release.js 1.1.2 --desktop # 只构建桌面端

# 或使用 Git 标签触发 GitHub Actions
git tag -a v1.1.2 -m "Release version 1.1.2"
git push origin v1.1.2
```

## License

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

**开发分支**: `main`
**稳定版本**: 通过 Release 发布
