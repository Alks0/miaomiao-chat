# 更新日志 (Changelog)

## [1.1.0] - 2024-12-15

### 新增功能

#### 工具系统 (Tool System)
- 新增完整的工具管理框架，支持工具注册、执行、权限控制
- 新增 5 个内置工具:
  - `calculator` - 数学计算器（支持 Math 函数库）
  - `datetime` - 日期时间工具
  - `unit_converter` - 单位转换器
  - `text_formatter` - 文本格式化工具
  - `random_generator` - 随机数生成器
- 新增工具执行引擎，支持超时控制、错误处理、批量执行
- 新增工具调用历史记录和撤销/重做功能
- 新增工具速率限制，防止滥用

#### MCP 协议支持 (Model Context Protocol)
- 新增 MCP 客户端，支持连接外部 MCP 服务器
- 支持多平台: Electron (stdio)、Web/Android (WebSocket/HTTP)
- 支持工具自动发现与注册
- 支持指数退避重试和自动断线重连
- Electron 端新增 MCP 进程管理器，支持子进程自动重启

#### 流式处理增强
- 新增思维链 `<think>` 标签解析，支持 DeepSeek 等模型
- 新增流式工具调用处理，支持增量参数拼接

#### UI/UX 改进
- 新增 MCP 服务器配置界面
- 新增工具调用显示组件
- 新增工具管理界面
- 新增工具快速选择器
- 新增统一图标管理系统

### 变更

#### 项目重命名
- 应用名称: Webchat → Miaomiao Chat
- 包名: `com.webchat.app` → `com.miaomiao.chat`
- 仓库: `odysseiaDev/webchat` → `Alks0/miaomiao-chat`

#### 更新机制
- 移除 Cloudflare Worker 代理依赖
- 改用 GitHub 公开 API 直接访问
- Electron 自动更新直接使用 GitHub Releases

#### API 格式转换
- 新增跨格式工具调用 ID 重映射 (OpenAI/Claude/Gemini)
- 新增 LRU 缓存策略防止内存泄漏

### 修复
- 修复多平台兼容性问题
- 修复 Android 网络安全配置

### 技术改进
- 采用插件式工具系统设计
- 事件驱动通信，解耦模块依赖
- 工具状态持久化 (IndexedDB/localStorage)

---

## [1.0.0] - 2024-12-13

### 初始版本
- 基础聊天功能
- 多模型支持 (OpenAI/Claude/Gemini)
- Electron 桌面端
- Android 移动端 (Capacitor)
- 会话管理
- 消息导出/导入
