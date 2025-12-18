/**
 * MCP (Model Context Protocol) 客户端
 * 统一的 MCP 客户端，支持远程和本地连接
 *
 * 平台支持：
 * - Web: 仅远程 MCP（HTTP/WebSocket）
 * - Electron: 远程 + 本地 MCP（IPC → 主进程 → stdio）
 * - Android: 仅远程 MCP（HTTP/WebSocket）
 */

import { state } from '../../core/state.js';
import { eventBus } from '../../core/events.js';

/**
 * 检测当前运行平台
 * @returns {'electron'|'web'|'android'} 平台类型
 */
export function detectPlatform() {
    // 检测 Electron
    if (window.electron && window.electron.ipcRenderer) {
        return 'electron';
    }

    // 检测 Android/Capacitor
    if (window.Capacitor && window.Capacitor.getPlatform() === 'android') {
        return 'android';
    }

    // 默认为 Web
    return 'web';
}

/**
 * MCP 客户端类
 */
export class MCPClient {
    constructor() {
        this.platform = detectPlatform();
        this.connections = new Map(); // serverId -> connection
        this.tools = new Map(); // toolId -> tool definition

        // 重试配置
        this.retryConfig = {
            maxRetries: 3,          // 最大重试 3 次
            initialDelay: 1000,     // 初始延迟 1 秒
            maxDelay: 10000,        // 最大延迟 10 秒
            backoffFactor: 2,       // 指数退避因子（1s → 2s → 4s）
            connectionTimeout: 10000, // 连接超时 10 秒
            toolCallTimeout: 30000    // 工具调用超时 30 秒
        };

        console.log(`[MCP] 🌐 平台检测: ${this.platform}`);
    }

    /**
     * 连接到 MCP 服务器
     * @param {Object} config - MCP 服务器配置
     * @param {string} config.id - 服务器唯一 ID
     * @param {string} config.name - 服务器名称
     * @param {'local'|'remote'} config.type - 连接类型
     * @param {string} [config.url] - 远程服务器 URL（type=remote 时必需）
     * @param {string} [config.command] - 本地命令（type=local 时必需，仅 Electron）
     * @param {string[]} [config.args] - 命令参数
     * @param {Object} [config.env] - 环境变量
     * @param {string} [config.cwd] - 工作目录
     * @returns {Promise<Object>} 连接结果 { success, error }
     */
    async connect(config) {
        const { id, type } = config;

        // 验证平台支持
        if (type === 'local' && this.platform !== 'electron') {
            const error = `本地 MCP 仅在 Electron 版本中支持，当前平台: ${this.platform}`;
            console.error(`[MCP] ❌ ${error}`);

            return {
                success: false,
                error,
                errorType: 'platform_unsupported',
                retryable: false,
                platform: this.platform
            };
        }

        // 使用重试机制连接
        return await this._connectWithRetry(config);
    }

    /**
     * 断开 MCP 服务器连接
     * @param {string} serverId - 服务器 ID
     */
    async disconnect(serverId) {
        const connection = this.connections.get(serverId);
        if (!connection) {
            console.warn(`[MCP] ⚠️ 服务器未连接: ${serverId}`);
            return;
        }

        try {
            // 禁止自动重连（防止断开后又自动连接）
            if (connection.shouldReconnect !== undefined) {
                connection.shouldReconnect = false;
            }

            if (connection.type === 'local' && this.platform === 'electron') {
                // Electron: 通过 IPC 通知主进程停止 MCP 子进程
                await window.electron.ipcRenderer.invoke('mcp:disconnect', { serverId });
            } else {
                // 远程连接：关闭 WebSocket 或清理资源
                if (connection.ws) {
                    connection.ws.close();
                }
            }

            // 移除该服务器的所有工具
            for (const [toolId, tool] of this.tools.entries()) {
                if (tool.serverId === serverId) {
                    this.tools.delete(toolId);
                }
            }

            this.connections.delete(serverId);

            console.log(`[MCP] 🔌 已断开 MCP 服务器: ${serverId}`);

            eventBus.emit('mcp:disconnected', { serverId });

        } catch (error) {
            console.error(`[MCP] ❌ 断开连接失败:`, error);
        }
    }

    /**
     * 获取所有可用工具
     * @returns {Array<Object>} 工具列表
     */
    getAllTools() {
        return Array.from(this.tools.values());
    }

    /**
     * 获取指定服务器的工具
     * @param {string} serverId - 服务器 ID
     * @returns {Array<Object>} 工具列表
     */
    getToolsByServer(serverId) {
        return Array.from(this.tools.values()).filter(tool => tool.serverId === serverId);
    }

    /**
     * 调用 MCP 工具
     * @param {string} toolId - 工具 ID（格式: serverId/toolName）
     * @param {Object} args - 工具参数
     * @returns {Promise<Object>} 工具执行结果
     */
    async callTool(toolId, args, options = {}) {
        const tool = this.tools.get(toolId);
        if (!tool) {
            throw new Error(`工具不存在: ${toolId}`);
        }

        const { serverId, name } = tool;
        const connection = this.connections.get(serverId);

        if (!connection) {
            throw new Error(`MCP 服务器未连接: ${serverId}`);
        }

        console.log(`[MCP] 🔧 调用工具: ${toolId}`, args);

        // 检查是否已取消
        if (options.signal?.aborted) {
            throw new Error('工具执行已取消');
        }

        try {
            let result;

            if (connection.type === 'local' && this.platform === 'electron') {
                // Electron: 通过 IPC 调用
                result = await window.electron.ipcRenderer.invoke('mcp:call-tool', {
                    serverId,
                    toolName: name,
                    arguments: args
                });
            } else {
                // 远程调用（传递 signal）
                result = await this._callRemoteTool(connection, name, args, options);
            }

            // 再次检查是否在执行过程中被取消
            if (options.signal?.aborted) {
                throw new Error('工具执行已取消');
            }

            console.log(`[MCP] 工具执行成功: ${toolId}`);

            return {
                success: true,
                result: result.content || result
            };

        } catch (error) {
            console.error(`[MCP] ❌ 工具执行失败: ${toolId}`, error);
            throw error;
        }
    }

    /**
     * 获取连接状态
     * @returns {Object} 连接状态统计
     */
    getStatus() {
        const servers = [];
        for (const [serverId, connection] of this.connections.entries()) {
            servers.push({
                id: serverId,
                type: connection.type,
                protocol: connection.protocol || 'ipc',
                toolCount: this.getToolsByServer(serverId).length
            });
        }

        return {
            platform: this.platform,
            connected: this.connections.size,
            servers,
            totalTools: this.tools.size
        };
    }

    // ========== 私有方法 ==========

    /**
     * 使用重试机制连接（指数退避）
     * @private
     */
    async _connectWithRetry(config) {
        const { id, name, type } = config;
        const { maxRetries, initialDelay, backoffFactor, maxDelay } = this.retryConfig;

        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 发送重试进度事件
                if (attempt > 1) {
                    eventBus.emit('mcp:retry-attempt', {
                        serverId: id,
                        serverName: name,
                        attempt,
                        maxRetries
                    });
                    console.log(`[MCP] 🔄 重试连接 (${attempt}/${maxRetries}): ${name}`);
                }

                // 实际连接（带超时）
                let connection;
                if (type === 'local') {
                    connection = await this._connectWithTimeout(
                        () => this._connectLocalElectron(config),
                        this.retryConfig.connectionTimeout
                    );
                } else {
                    connection = await this._connectWithTimeout(
                        () => this._connectRemote(config),
                        this.retryConfig.connectionTimeout
                    );
                }

                this.connections.set(id, connection);

                // 发现工具
                await this._discoverTools(id, connection);

                console.log(`[MCP] 已连接到 MCP 服务器: ${name} (${type})`);
                eventBus.emit('mcp:connected', { serverId: id, config });

                return { success: true };

            } catch (error) {
                lastError = error;

                // 错误分类
                const errorInfo = this._classifyError(error);

                console.error(`[MCP] ❌ 连接失败 (尝试 ${attempt}/${maxRetries}):`, error.message);

                // 不可重试错误，立即返回
                if (!errorInfo.retryable) {
                    return {
                        success: false,
                        error: error.message,
                        errorType: errorInfo.type,
                        retryable: false
                    };
                }

                // 还有重试机会，等待后重试
                if (attempt < maxRetries) {
                    const delay = Math.min(
                        initialDelay * Math.pow(backoffFactor, attempt - 1),
                        maxDelay
                    );
                    console.log(`[MCP] ⏱️ 等待 ${delay}ms 后重试...`);
                    await this._delay(delay);
                }
            }
        }

        // 所有重试都失败
        return {
            success: false,
            error: lastError.message,
            errorType: this._classifyError(lastError).type,
            retriesExhausted: true,
            retryable: false
        };
    }

    /**
     * 带超时的连接执行
     * @private
     */
    async _connectWithTimeout(connectFn, timeout) {
        return Promise.race([
            connectFn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`连接超时 (${timeout}ms)`)), timeout)
            )
        ]);
    }

    /**
     * 错误分类
     * @private
     */
    _classifyError(error) {
        const message = error.message.toLowerCase();

        // 平台不支持 - 不可重试
        if (message.includes('platform') || message.includes('平台')) {
            return { type: 'platform_unsupported', retryable: false };
        }

        // 配置错误 - 不可重试
        if (message.includes('url') || message.includes('参数') || message.includes('invalid')) {
            return { type: 'invalid_config', retryable: false };
        }

        // 认证失败 - 不可重试
        if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('401') || message.includes('403')) {
            return { type: 'auth_failed', retryable: false };
        }

        // 超时 - 可重试
        if (message.includes('timeout') || message.includes('超时')) {
            return { type: 'timeout', retryable: true };
        }

        // 网络错误 - 可重试
        if (message.includes('network') || message.includes('fetch') || message.includes('websocket')) {
            return { type: 'network_error', retryable: true };
        }

        // 服务器错误 - 可重试
        if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
            return { type: 'server_error', retryable: true };
        }

        // 默认：可重试
        return { type: 'unknown_error', retryable: true };
    }

    /**
     * 延迟辅助函数
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Electron: 通过 IPC 连接到本地 MCP
     * @private
     */
    async _connectLocalElectron(config) {
        const { id, command, args, env, cwd } = config;

        const result = await window.electron.ipcRenderer.invoke('mcp:connect', {
            serverId: id,
            command,
            args,
            env,
            cwd
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        return {
            type: 'local',
            serverId: id
        };
    }

    /**
     * 连接到远程 MCP 服务器
     * @private
     */
    async _connectRemote(config) {
        const { id, url, apiKey, headers = {}, transportType } = config;

        if (!url) {
            throw new Error('远程 MCP 需要提供 url 参数');
        }

        // 判断传输类型
        let isWebSocket = false;
        let protocol = 'http'; // 默认协议

        if (transportType) {
            // 显式指定了传输类型
            if (transportType === 'websocket') {
                isWebSocket = true;
                protocol = 'websocket';
            } else if (transportType === 'streamable-http') {
                isWebSocket = false;
                protocol = 'streamable-http';
            } else if (transportType === 'sse') {
                isWebSocket = false;
                protocol = 'sse';
            } else if (transportType === 'http') {
                isWebSocket = false;
                protocol = 'http';
            } else {
                console.warn(`[MCP] ⚠️ 未知的传输类型: ${transportType}，将根据 URL 自动检测`);
                isWebSocket = url.startsWith('ws://') || url.startsWith('wss://');
                protocol = isWebSocket ? 'websocket' : 'http';
            }
        } else {
            // 根据 URL 自动检测
            isWebSocket = url.startsWith('ws://') || url.startsWith('wss://');
            protocol = isWebSocket ? 'websocket' : 'http';
        }

        if (isWebSocket) {
            // WebSocket 连接
            const ws = new WebSocket(url);

            // 等待 WebSocket 连接并发送初始化请求
            await new Promise((resolve, reject) => {
                let initHandler = null; // 保存处理器引用，便于清理

                const timeout = setTimeout(() => {
                    // 超时时移除监听器
                    if (initHandler) {
                        ws.removeEventListener('message', initHandler);
                    }
                    reject(new Error(`WebSocket 连接超时 (${this.retryConfig.connectionTimeout}ms)`));
                }, this.retryConfig.connectionTimeout);

                ws.onopen = async () => {
                    console.log(`[MCP] 🔗 WebSocket 已连接，发送初始化请求`);

                    // 发送 initialize 请求
                    const initRequest = {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2024-11-05',
                            capabilities: {},
                            clientInfo: {
                                name: 'miaomiao-chat',
                                version: '1.1.7'
                            }
                        }
                    };

                    // 等待 initialize 响应
                    initHandler = (event) => {
                        const response = JSON.parse(event.data);
                        if (response.id === 1) {
                            console.log(`[MCP] WebSocket 初始化成功:`, response);
                            ws.removeEventListener('message', initHandler);
                            clearTimeout(timeout);

                            // 发送 initialized 通知
                            ws.send(JSON.stringify({
                                jsonrpc: '2.0',
                                method: 'initialized'
                            }));

                            resolve();
                        }
                    };

                    ws.addEventListener('message', initHandler);
                    ws.send(JSON.stringify(initRequest));
                };

                ws.onerror = (error) => {
                    // 错误时移除监听器
                    if (initHandler) {
                        ws.removeEventListener('message', initHandler);
                    }
                    clearTimeout(timeout);
                    reject(error);
                };
            });

            // 设置自动重连（异常断开时）
            ws.onclose = (event) => {
                // 非正常关闭 && 连接仍存在（用户未手动删除）
                if (!event.wasClean && this.connections.has(id)) {
                    console.warn(`[MCP] ⚠️ WebSocket 异常断开: ${config.name} (code: ${event.code})`);

                    eventBus.emit('mcp:connection-lost', {
                        serverId: id,
                        serverName: config.name,
                        reason: event.reason || '连接断开'
                    });

                    // 延迟 5 秒后自动重连
                    setTimeout(async () => {
                        const connection = this.connections.get(id);

                        // 检查连接是否还存在 && 允许重连 && 服务器配置还存在
                        if (connection && connection.shouldReconnect && this.connections.has(id)) {
                            const server = state.mcpServers.find(s => s.id === id);

                            if (server) {
                                console.log(`[MCP] 🔄 尝试自动重连: ${config.name}`);

                                const result = await this.connect(server);
                                if (result.success) {
                                    console.log(`[MCP] 自动重连成功: ${config.name}`);
                                } else {
                                    console.error(`[MCP] ❌ 自动重连失败: ${config.name}`);
                                    eventBus.emit('mcp:reconnect-failed', {
                                        serverId: id,
                                        serverName: config.name,
                                        error: result.error
                                    });
                                }
                            } else {
                                console.log(`[MCP] ⚠️ 服务器配置已删除，取消重连: ${id}`);
                            }
                        } else {
                            console.log(`[MCP] ⚠️ 连接已手动断开或删除，取消重连: ${id}`);
                        }
                    }, 5000);
                }
            };

            return {
                type: 'remote',
                protocol: 'websocket',
                url,
                ws,
                apiKey,
                headers,
                shouldReconnect: true // 标志位：是否允许自动重连
            };
        } else {
            // HTTP 连接
            // 构建请求头
            const requestHeaders = {
                'Accept': 'application/json, text/event-stream',
                ...headers
            };

            if (apiKey) {
                requestHeaders['Authorization'] = `Bearer ${apiKey}`;
            }

            // 执行 MCP 初始化握手
            console.log(`[MCP] 🔗 建立 HTTP 连接并初始化: ${url}`);

            try {
                // 1. 发送 initialize 请求
                const initResponse = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        ...requestHeaders
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2024-11-05',
                            capabilities: {},
                            clientInfo: {
                                name: 'miaomiao-chat',
                                version: '1.1.7'
                            }
                        }
                    })
                });

                if (!initResponse.ok) {
                    throw new Error(`初始化失败: ${initResponse.status}`);
                }

                // 检查响应类型（JSON 或 SSE）
                const contentType = initResponse.headers.get('content-type') || '';
                let initData;

                if (contentType.includes('text/event-stream')) {
                    // SSE 响应：解析事件流
                    console.log('[MCP] 收到 SSE 格式响应');
                    const text = await initResponse.text();
                    initData = this._parseSSE(text);
                } else {
                    // JSON 响应
                    initData = await initResponse.json();
                }

                console.log(`[MCP] 初始化成功:`, initData);

                // 2. 发送 initialized 通知（无需等待响应）
                fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        ...requestHeaders
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'initialized'
                    })
                }).catch(err => console.warn('[MCP] initialized 通知失败:', err));

            } catch (error) {
                console.error(`[MCP] ❌ 初始化失败:`, error);
                throw error;
            }

            return {
                type: 'remote',
                protocol: protocol, // 使用实际检测到的协议（http/sse/streamable-http）
                url,
                apiKey,
                headers: requestHeaders
            };
        }
    }

    /**
     * 发现 MCP 工具
     * @private
     */
    async _discoverTools(serverId, connection) {
        console.log(`[MCP] 🔍 发现工具: ${serverId}`);

        try {
            let toolsList;

            if (connection.type === 'local' && this.platform === 'electron') {
                // Electron: 通过 IPC 获取工具列表
                const result = await window.electron.ipcRenderer.invoke('mcp:list-tools', {
                    serverId
                });
                toolsList = result.tools || [];
            } else {
                // 远程: HTTP/WebSocket 获取工具列表
                toolsList = await this._listRemoteTools(connection);
            }

            // 注册工具
            for (const tool of toolsList) {
                const toolId = `${serverId}/${tool.name}`;

                this.tools.set(toolId, {
                    id: toolId,
                    serverId,
                    name: tool.name,
                    description: tool.description || '',
                    inputSchema: tool.inputSchema || {},
                    // MCP 格式的工具定义
                    mcpDefinition: tool
                });
            }

            console.log(`[MCP] 发现 ${toolsList.length} 个工具: ${serverId}`);

            eventBus.emit('mcp:tools-discovered', {
                serverId,
                tools: toolsList
            });

        } catch (error) {
            console.error(`[MCP] ❌ 工具发现失败: ${serverId}`, error);
            throw error;
        }
    }

    /**
     * 远程获取工具列表
     * @private
     */
    async _listRemoteTools(connection) {
        const { protocol, url, ws, headers } = connection;

        if (protocol === 'websocket') {
            // WebSocket: 发送 list_tools 请求
            return new Promise((resolve, reject) => {
                const requestId = Date.now().toString();

                // 使用配置的超时时间
                const timeout = setTimeout(() => {
                    // 超时后清理 handler，避免内存泄漏
                    ws.removeEventListener('message', handler);
                    reject(new Error(`WebSocket 列表工具超时 (${this.retryConfig.connectionTimeout}ms)`));
                }, this.retryConfig.connectionTimeout);

                const handler = (event) => {
                    const response = JSON.parse(event.data);
                    if (response.id === requestId) {
                        clearTimeout(timeout);
                        ws.removeEventListener('message', handler);
                        resolve(response.result.tools || []);
                    }
                };

                ws.addEventListener('message', handler);

                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId,
                    method: 'tools/list'
                }));
            });
        } else {
            // HTTP: 发送 POST 请求（标准 JSON-RPC 2.0 格式）
            // 注意：POST 到基础 URL，而不是 /tools/list
            const requestBody = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/list',
                params: {}
            };

            console.log(`[MCP] 📤 发送请求到 ${url}:`, requestBody);

            // 添加 HTTP 请求超时控制
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                abortController.abort();
            }, this.retryConfig.connectionTimeout);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        ...headers
                    },
                    body: JSON.stringify(requestBody),
                    signal: abortController.signal
                });

                clearTimeout(timeoutId);

                console.log(`[MCP] 📥 收到响应: ${response.status} ${response.statusText}`);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[MCP] ❌ HTTP 错误响应:`, errorText);
                    throw new Error(`HTTP 请求失败: ${response.status} ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type');
                console.log(`[MCP] Content-Type: ${contentType}`);

                // 根据 Content-Type 解析响应
                let data;
                if (contentType && contentType.includes('text/event-stream')) {
                    console.log('[MCP] 解析 SSE 格式响应');
                    const text = await response.text();
                    data = this._parseSSE(text);
                } else {
                    data = await response.json();
                }

                console.log(`[MCP] 📦 响应数据:`, data);

                // 处理 JSON-RPC 错误
                if (data.error) {
                    throw new Error(`MCP 错误 [${data.error.code}]: ${data.error.message || JSON.stringify(data.error)}`);
                }

                return data.result?.tools || [];
            } catch (error) {
                clearTimeout(timeoutId);
                // 将 AbortError 转换为有意义的超时错误
                if (error.name === 'AbortError') {
                    throw new Error(`HTTP 列表工具超时 (${this.retryConfig.connectionTimeout}ms)`);
                }
                throw error;
            }
        }
    }

    /**
     * 远程调用工具
     * @private
     */
    async _callRemoteTool(connection, toolName, args, options = {}) {
        const { protocol, url, ws, headers } = connection;

        if (protocol === 'websocket') {
            // WebSocket: 发送 call_tool 请求
            return new Promise((resolve, reject) => {
                const requestId = Date.now().toString();

                // 使用配置的超时时间
                const timeout = setTimeout(() => {
                    // 超时后清理 handler，避免内存泄漏
                    ws.removeEventListener('message', handler);
                    reject(new Error(`WebSocket 工具调用超时 (${this.retryConfig.toolCallTimeout}ms)`));
                }, this.retryConfig.toolCallTimeout);

                const handler = (event) => {
                    const response = JSON.parse(event.data);
                    if (response.id === requestId) {
                        clearTimeout(timeout);
                        ws.removeEventListener('message', handler);

                        if (response.error) {
                            reject(new Error(response.error.message));
                        } else {
                            resolve(response.result);
                        }
                    }
                };

                // 监听外部取消信号
                if (options.signal) {
                    options.signal.addEventListener('abort', () => {
                        clearTimeout(timeout);
                        ws.removeEventListener('message', handler);
                        reject(new Error('工具执行已取消'));
                    });
                }

                ws.addEventListener('message', handler);

                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId,
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: args
                    }
                }));
            });
        } else {
            // HTTP: 发送 POST 请求（标准 JSON-RPC 2.0 格式）
            // 注意：POST 到基础 URL，而不是 /tools/call

            // 使用外部 signal 或创建内部超时控制
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                abortController.abort();
            }, this.retryConfig.toolCallTimeout);

            // 如果有外部 signal，同时监听
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                    abortController.abort();
                });
            }

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        ...headers
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: 'tools/call',
                        params: {
                            name: toolName,
                            arguments: args
                        }
                    }),
                    signal: abortController.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP 请求失败: ${response.status}`);
                }

                // 根据 Content-Type 解析响应
                const contentType = response.headers.get('content-type');
                let data;

                if (contentType && contentType.includes('text/event-stream')) {
                    console.log('[MCP] 解析 SSE 格式响应 (tools/call)');
                    const text = await response.text();
                    data = this._parseSSE(text);
                } else {
                    data = await response.json();
                }

                // 处理 JSON-RPC 错误
                if (data.error) {
                    throw new Error(`MCP 错误: ${data.error.message || JSON.stringify(data.error)}`);
                }

                return data.result;
            } catch (error) {
                clearTimeout(timeoutId);
                // 将 AbortError 转换为有意义的超时错误
                if (error.name === 'AbortError') {
                    throw new Error(`HTTP 工具调用超时 (${this.retryConfig.toolCallTimeout}ms)`);
                }
                throw error;
            }
        }
    }

    /**
     * 解析 Server-Sent Events (SSE) 格式的响应
     * @private
     * @param {string} text - SSE 文本内容
     * @returns {Object} 解析后的 JSON-RPC 响应
     */
    _parseSSE(text) {
        try {
            // SSE 格式：
            // event: message
            // data: {"jsonrpc":"2.0",...}
            //
            // 或者多行 data:
            // data: line1
            // data: line2

            const lines = text.trim().split('\n');
            const dataLines = [];

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    // 提取 data: 后面的内容
                    const dataContent = line.substring(6);
                    dataLines.push(dataContent);
                } else if (line.startsWith('data:')) {
                    // 没有空格的情况
                    const dataContent = line.substring(5);
                    dataLines.push(dataContent);
                }
            }

            // 多行 data 用换行符连接（符合 SSE 规范）
            const jsonData = dataLines.join('\n');

            if (!jsonData) {
                throw new Error('SSE 响应中没有找到 data 字段');
            }

            // 解析 JSON
            const parsed = JSON.parse(jsonData);
            console.log('[MCP] SSE 解析结果:', parsed);
            return parsed;

        } catch (error) {
            console.error('[MCP] SSE 解析失败:', error);
            console.error('[MCP] 原始文本:', text);
            throw new Error(`SSE 解析失败: ${error.message}`);
        }
    }
}

// ========== 向后兼容的导出函数 ==========

// 全局 MCP 客户端实例
export const mcpClient = new MCPClient();

/**
 * 调用 MCP 工具（向后兼容）
 * @param {string} serverId - MCP 服务器 ID
 * @param {string} toolName - 工具名称
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 执行结果
 */
export async function callMCPTool(serverId, toolName, args, options = {}) {
    const toolId = `${serverId}/${toolName}`;
    return await mcpClient.callTool(toolId, args, options);
}

console.log('[MCP] 📡 MCP 客户端已加载');
console.log(`[MCP] 🌐 当前平台: ${mcpClient.platform}`);
