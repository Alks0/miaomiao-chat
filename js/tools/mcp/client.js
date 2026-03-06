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
            toolCallTimeout: 180000   // 工具调用超时 180 秒
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
        const { type } = config;

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
    async disconnect(serverId, options = {}) {
        const { silent = false } = options;

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

                // SSE: abort the stream and reject pending requests (if any)
                if (connection.sseAbortController) {
                    connection.sseAbortController.abort();
                }

                if (connection.sseReader) {
                    try {
                        await connection.sseReader.cancel();
                    } catch {
                        // ignore
                    }
                }

                if (connection.pendingRequests && typeof connection.pendingRequests.clear === 'function') {
                    for (const pending of connection.pendingRequests.values()) {
                        if (pending?.timeoutId) clearTimeout(pending.timeoutId);
                        if (pending?.reject) pending.reject(new Error('Disconnected'));
                    }
                    connection.pendingRequests.clear();
                }
            }

            this._clearToolsForServer(serverId);

            this.connections.delete(serverId);

            console.log(`[MCP] 🔌 已断开 MCP 服务器: ${serverId}`);

            if (!silent) {
                eventBus.emit('mcp:disconnected', { serverId });
            }

        } catch (error) {
            console.error(`[MCP] ❌ 断开连接失败:`, error);
        }
    }

    /**
     * 是否存在连接对象（包括已断开/重连中的连接）
     * @param {string} serverId - 服务器 ID
     * @returns {boolean}
     */
    hasConnection(serverId) {
        return this.connections.has(serverId);
    }

    /**
     * 当前是否处于可用连接状态
     * @param {string} serverId - 服务器 ID
     * @returns {boolean}
     */
    isConnected(serverId) {
        const connection = this.connections.get(serverId);
        if (!connection) return false;
        return connection.connected !== false;
    }

    /**
     * 清理指定服务器的工具缓存
     * @private
     */
    _clearToolsForServer(serverId) {
        for (const [toolId, tool] of this.tools.entries()) {
            if (tool.serverId === serverId) {
                this.tools.delete(toolId);
            }
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
     * @param {string} toolId - 工具 ID（格式: serverId__toolName 或 serverId/toolName）
     * @param {Object} args - 工具参数
     * @returns {Promise<Object>} 工具执行结果
     */
    async callTool(toolId, args, options = {}) {
        // 统一处理工具ID格式：支持斜杠和双下划线
        let normalizedToolId = toolId;
        let serverId, toolName;

        if (toolId.includes('/')) {
            // 斜杠格式：serverId/toolName
            const parts = toolId.split('/');
            serverId = parts[0];
            toolName = parts[1];
            normalizedToolId = `${serverId}__${toolName}`;
        } else if (toolId.includes('__')) {
            // 双下划线格式：serverId__toolName
            const parts = toolId.split('__');
            serverId = parts[0];
            toolName = parts[1];
            normalizedToolId = toolId;
        } else {
            throw new Error(`无效的工具ID格式: ${toolId}`);
        }

        const tool = this.tools.get(normalizedToolId);
        if (!tool) {
            // 尝试查找工具（可能注册时使用了不同格式）
            const altToolId = `${serverId}__${toolName}`;
            const altTool = this.tools.get(altToolId);
            if (altTool) {
                serverId = altTool.serverId;
                toolName = altTool.name;
            } else {
                throw new Error(`工具不存在: ${toolId}`);
            }
        } else {
            serverId = tool.serverId;
            toolName = tool.name;
        }

        const connection = this.connections.get(serverId);

        if (!connection) {
            throw new Error(`MCP 服务器未连接: ${serverId}`);
        }

        if (connection.connected === false) {
            throw new Error(`MCP 服务器连接已断开: ${serverId}`);
        }

        console.log(`[MCP] 🔧 调用工具: ${normalizedToolId}`, args);

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
                    toolName: toolName,
                    arguments: args
                });
            } else {
                // 远程调用（传递 signal）
                result = await this._callRemoteTool(connection, toolName, args, options);
            }

            // 再次检查是否在执行过程中被取消
            if (options.signal?.aborted) {
                throw new Error('工具执行已取消');
            }

            console.log(`[MCP] 工具执行成功: ${normalizedToolId}`);

            return {
                success: true,
                result,
                output: result?.content || result
            };

        } catch (error) {
            console.error(`[MCP] ❌ 工具执行失败: ${normalizedToolId}`, error);
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

                connection.connected = true;
                this.connections.set(id, connection);

                // 发现工具
                await this._discoverTools(id, connection);

                console.log(`[MCP] 已连接到 MCP 服务器: ${name} (${type})`);
                eventBus.emit('mcp:connected', { serverId: id, config });

                return { success: true };

            } catch (error) {
                lastError = error;

                // Clean up any partially established connection (avoid "ghost connected" state)
                try {
                    await this.disconnect(id);
                } catch {
                    // ignore
                }

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
        const { id, url, apiKey, headers = {}, customHeaders = {}, transportType } = config;

        if (!url) {
            throw new Error('远程 MCP 需要提供 url 参数');
        }

        // Merge headers from different config sources (imported configs may use customHeaders)
        const mergedHeaders = {
            ...customHeaders,
            ...headers
        };

        // Only inject Authorization when caller didn't already provide it
        if (apiKey && !Object.keys(mergedHeaders).some(key => key.toLowerCase() === 'authorization')) {
            mergedHeaders['Authorization'] = `Bearer ${apiKey}`;
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

                if (isWebSocket) {
                    protocol = 'websocket';
                } else {
                    try {
                        const urlObj = new URL(url, window.location.href);
                        protocol = urlObj.pathname.toLowerCase().endsWith('/sse') ? 'sse' : 'http';
                    } catch {
                        protocol = 'http';
                    }
                }
            }
        } else {
            // 根据 URL 自动检测
            isWebSocket = url.startsWith('ws://') || url.startsWith('wss://');

            if (isWebSocket) {
                protocol = 'websocket';
            } else {
                // Heuristic: common SSE endpoint suffix is `/sse`
                try {
                    const urlObj = new URL(url, window.location.href);
                    protocol = urlObj.pathname.toLowerCase().endsWith('/sse') ? 'sse' : 'http';
                } catch {
                    protocol = 'http';
                }
            }
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
                    try {
                        ws.close();
                    } catch {
                        // ignore
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
                                name: 'webchat',
                                version: '1.1.4'
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
                    try {
                        ws.close();
                    } catch {
                        // ignore
                    }
                    reject(error);
                };
            });

            const instanceId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

            // 设置自动重连（异常断开时）
            ws.onclose = (event) => {
                // 非正常关闭 && 连接仍存在（用户未手动删除）
                if (!event.wasClean && this.connections.has(id)) {
                    const current = this.connections.get(id);
                    if (!current || current.instanceId !== instanceId) return;

                    current.connected = false;
                    this._clearToolsForServer(id);
                    eventBus.emit('mcp:disconnected', { serverId: id, reason: 'connection-lost' });

                    console.warn(`[MCP] ⚠️ WebSocket 异常断开: ${config.name} (code: ${event.code})`);

                    eventBus.emit('mcp:connection-lost', {
                        serverId: id,
                        serverName: config.name,
                        reason: event.reason || '连接断开'
                    });

                    // 延迟 5 秒后自动重连
                    setTimeout(async () => {
                        const connection = this.connections.get(id);
                        if (!connection || connection.instanceId !== instanceId) return;
                        if (connection.connected) return;

                        // 检查连接是否还存在 && 允许重连 && 服务器配置还存在
                        if (connection.shouldReconnect && this.connections.has(id)) {
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
                headers: mergedHeaders,
                instanceId,
                shouldReconnect: true // 标志位：是否允许自动重连
            };
        } else if (protocol === 'sse') {
            return await this._connectRemoteSSE(config, mergedHeaders);
        } else {
            // HTTP 连接
            // 构建请求头
            const requestHeaders = {
                'Accept': 'application/json, text/event-stream',
                ...mergedHeaders
            };

            // 执行 MCP 初始化握手
            console.log(`[MCP] 🔗 建立 HTTP 连接并初始化: ${url}`);

            try {
                // 1. 发送 initialize 请求
                const abortController = new AbortController();
                const timeoutId = setTimeout(() => abortController.abort(), this.retryConfig.connectionTimeout);

                let initResponse;
                try {
                    initResponse = await fetch(url, {
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
                                    name: 'webchat',
                                    version: '1.1.4'
                                }
                            }
                        }),
                        signal: abortController.signal
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

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
                if (error.name === 'AbortError') {
                    throw new Error(`HTTP 初始化超时 (${this.retryConfig.connectionTimeout}ms)`);
                }
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
     * SSE transport: connect via GET event-stream, send JSON-RPC via POST to provided endpoint.
     * @private
     */
    async _connectRemoteSSE(config, requestHeaders = {}) {
        const { id, url } = config;
        const instanceId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        const sseAbortController = new AbortController();
        const connectTimeoutId = setTimeout(() => {
            sseAbortController.abort();
        }, this.retryConfig.connectionTimeout);

        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'text/event-stream',
                    ...requestHeaders
                },
                signal: sseAbortController.signal
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`SSE 连接超时 (${this.retryConfig.connectionTimeout}ms)`);
            }
            throw error;
        } finally {
            clearTimeout(connectTimeoutId);
        }

        if (!response.ok) {
            let bodyText = '';
            try {
                bodyText = await response.text();
            } catch {
                // ignore
            }
            throw new Error(`SSE 连接失败: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ''}`);
        }

        if (!response.body) {
            throw new Error('SSE 响应不支持流式读取（response.body 为空）');
        }

        const sseReader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const pendingRequests = new Map(); // id -> { resolve, reject, timeoutId }
        let endpointResolved = false;
        let endpointResolve;
        let endpointReject;

        const endpointPromise = new Promise((resolve, reject) => {
            endpointResolve = resolve;
            endpointReject = reject;
        });

        const parseEvent = (rawEvent) => {
            const lines = rawEvent.split(/\r?\n/);
            let eventName = 'message';
            const dataLines = [];

            for (const line of lines) {
                if (!line) continue;
                if (line.startsWith(':')) continue; // comment / keep-alive

                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim() || 'message';
                    continue;
                }

                if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trimStart());
                }
            }

            return {
                eventName,
                data: dataLines.join('\n')
            };
        };

        const handleJsonRpcMessage = (json) => {
            if (!json) return;

            if (json.id && pendingRequests.has(json.id)) {
                const pending = pendingRequests.get(json.id);
                clearTimeout(pending.timeoutId);
                pendingRequests.delete(json.id);

                if (json.error) {
                    pending.reject(new Error(json.error.message || JSON.stringify(json.error)));
                } else {
                    pending.resolve(json.result);
                }
                return;
            }

            // Notification
            eventBus.emit('mcp:notification', { serverId: id, message: json });
        };

        const handleSseEvent = (eventName, data) => {
            if (!data) return;

            if (eventName === 'endpoint') {
                let endpoint = data.trim();

                // Some servers may wrap endpoint in JSON
                if (endpoint.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(endpoint);
                        if (parsed && typeof parsed === 'object' && parsed.endpoint) {
                            endpoint = String(parsed.endpoint);
                        }
                    } catch {
                        // ignore
                    }
                }

                let messageUrl;
                try {
                    messageUrl = new URL(endpoint, url).toString();
                } catch {
                    messageUrl = endpoint;
                }

                endpointResolved = true;
                endpointResolve(messageUrl);
                return;
            }

            // Default: JSON-RPC message in data
            try {
                const json = JSON.parse(data);
                handleJsonRpcMessage(json);
            } catch {
                // ignore non-JSON payloads
            }
        };

        const readLoop = (async () => {
            try {
                while (true) {
                    const { value, done } = await sseReader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    let separatorMatch;
                    while ((separatorMatch = buffer.match(/\r?\n\r?\n/))) {
                        const separatorIndex = separatorMatch.index ?? -1;
                        if (separatorIndex < 0) break;

                        const separatorLength = separatorMatch[0].length;
                        const rawEvent = buffer.slice(0, separatorIndex);
                        buffer = buffer.slice(separatorIndex + separatorLength);

                        const { eventName, data } = parseEvent(rawEvent);
                        handleSseEvent(eventName, data);
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.warn('[MCP] SSE 读取异常:', error);
                }
            } finally {
                // Fail endpoint waiters if stream closed before endpoint event
                if (!endpointResolved) {
                    endpointReject(new Error('SSE 连接已关闭（未收到 endpoint 事件）'));
                }

                // Reject all pending requests
                for (const pending of pendingRequests.values()) {
                    clearTimeout(pending.timeoutId);
                    pending.reject(new Error('SSE 连接已关闭'));
                }
                pendingRequests.clear();

                // Auto reconnect on unexpected close
                const current = this.connections.get(id);
                if (!sseAbortController.signal.aborted && current && current.protocol === 'sse' && current.shouldReconnect && current.instanceId === instanceId) {
                    current.connected = false;
                    this._clearToolsForServer(id);
                    eventBus.emit('mcp:disconnected', { serverId: id, reason: 'connection-lost' });

                    console.warn(`[MCP] ⚠️ SSE 异常断开: ${config.name || id}`);
                    eventBus.emit('mcp:connection-lost', {
                        serverId: id,
                        serverName: config.name || id,
                        protocol: 'sse'
                    });

                    setTimeout(async () => {
                        const stillThere = this.connections.get(id);
                        if (!stillThere || stillThere.instanceId !== instanceId) return;
                        if (!stillThere.shouldReconnect) return;
                        if (stillThere.connected) return;

                        const server = state.mcpServers.find(s => s.id === id);
                        if (!server) return;

                        const result = await this.connect(server);
                        if (!result.success) {
                            eventBus.emit('mcp:reconnect-failed', {
                                serverId: id,
                                serverName: config.name || id,
                                error: result.error
                            });
                        }
                    }, 5000);
                }
            }
        })();

        // Wait for the endpoint event which provides the POST message URL
        let endpointUrl;
        try {
            endpointUrl = await Promise.race([
                endpointPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`SSE endpoint 超时 (${this.retryConfig.connectionTimeout}ms)`)), this.retryConfig.connectionTimeout)
                )
            ]);
        } catch (error) {
            // Avoid leaking an open SSE stream when endpoint negotiation fails
            sseAbortController.abort();
            try {
                await sseReader.cancel();
            } catch {
                // ignore
            }
            throw error;
        }

        const connection = {
            type: 'remote',
            protocol: 'sse',
            sseUrl: url,
            url: endpointUrl,
            headers: requestHeaders,
            pendingRequests,
            requestIdCounter: 0,
            sseAbortController,
            sseReader,
            sseLoop: readLoop,
            instanceId,
            shouldReconnect: true
        };

        try {
            // Handshake: initialize -> initialized
            await this._sendSSERequest(connection, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'webchat',
                    version: '1.1.4'
                }
            });

            this._sendSSENotification(connection, 'initialized');
        } catch (error) {
            // Cleanup on handshake failure (connection isn't registered yet, so disconnect() won't run)
            sseAbortController.abort();
            try {
                await sseReader.cancel();
            } catch {
                // ignore
            }

            for (const pending of pendingRequests.values()) {
                clearTimeout(pending.timeoutId);
                pending.reject(error);
            }
            pendingRequests.clear();

            throw error;
        }

        return connection;
    }

    /**
     * SSE: send a JSON-RPC notification (no id, no response expected).
     * @private
     */
    _sendSSENotification(connection, method, params) {
        const body = { jsonrpc: '2.0', method };
        if (params !== undefined) body.params = params;

        fetch(connection.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...connection.headers
            },
            body: JSON.stringify(body)
        }).catch(err => console.warn('[MCP] SSE 通知发送失败:', err));
    }

    /**
     * SSE: send a JSON-RPC request and await response from the SSE stream.
     * @private
     */
    async _sendSSERequest(connection, method, params = {}, options = {}) {
        const requestId = `sse_${Date.now()}_${++connection.requestIdCounter}`;
        const timeoutMs = method === 'tools/call' ? this.retryConfig.toolCallTimeout : this.retryConfig.connectionTimeout;

        if (options.signal?.aborted) {
            throw new Error('请求已取消');
        }

        const abortController = new AbortController();
        let onAbort = null;

        try {
            const resultPromise = new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    connection.pendingRequests.delete(requestId);
                    reject(new Error(`SSE 请求超时 (${timeoutMs}ms): ${method}`));
                    abortController.abort();
                }, timeoutMs);

                connection.pendingRequests.set(requestId, {
                    resolve,
                    reject,
                    timeoutId
                });

                onAbort = () => {
                    const pending = connection.pendingRequests.get(requestId);
                    if (!pending) {
                        abortController.abort();
                        return;
                    }

                    clearTimeout(pending.timeoutId);
                    connection.pendingRequests.delete(requestId);
                    pending.reject(new Error('请求已取消'));
                    abortController.abort();
                };

                if (options.signal) {
                    options.signal.addEventListener('abort', onAbort, { once: true });
                    if (options.signal.aborted) {
                        onAbort();
                    }
                }

                fetch(connection.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        ...connection.headers
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: requestId,
                        method,
                        params
                    }),
                    signal: abortController.signal
                }).then(async (response) => {
                    if (!response.ok) {
                        const text = await response.text().catch(() => '');
                        throw new Error(`HTTP 请求失败: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
                    }
                }).catch((error) => {
                    // If the response already arrived via SSE, pending will be removed
                    const pending = connection.pendingRequests.get(requestId);
                    if (!pending) return;

                    clearTimeout(pending.timeoutId);
                    connection.pendingRequests.delete(requestId);

                    if (error.name === 'AbortError') {
                        reject(new Error(`SSE 请求已取消/超时: ${method}`));
                    } else {
                        reject(error);
                    }
                });
            });

            return await resultPromise;
        } finally {
            if (options.signal && onAbort) {
                options.signal.removeEventListener('abort', onAbort);
            }
        }
    }

    /**
     * 从不同 MCP 响应结构中提取 tools 列表
     * @private
     */
    _extractToolsFromPayload(payload) {
        const asArray = (value) => {
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object') {
                const toolEntries = Object.entries(value).filter(([, tool]) =>
                    tool && typeof tool === 'object' && !Array.isArray(tool)
                );
                if (toolEntries.length === 0) return [];
                return toolEntries.map(([name, tool]) => ({
                    name,
                    ...(tool || {})
                }));
            }
            return [];
        };

        const candidates = [
            payload,
            payload?.tools,
            payload?.result,
            payload?.result?.tools,
            payload?.data,
            payload?.data?.tools
        ];

        for (const candidate of candidates) {
            const tools = asArray(candidate);
            if (tools.length > 0) return tools;
        }

        return [];
    }

    /**
     * 归一化工具定义（兼容 inputSchema/input_schema 等命名）
     * @private
     */
    _normalizeToolDefinition(tool) {
        if (!tool || typeof tool !== 'object') return null;
        const normalizedName = tool.name || tool.id || '';
        if (!normalizedName || typeof normalizedName !== 'string') return null;

        return {
            ...tool,
            name: normalizedName,
            inputSchema: tool.inputSchema || tool.input_schema || tool.parameters || { type: 'object', properties: {} }
        };
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
                if (!result?.success) {
                    throw new Error(result?.error || 'MCP tools/list failed');
                }
                toolsList = this._extractToolsFromPayload(result);
            } else {
                // 远程: HTTP/WebSocket 获取工具列表
                toolsList = await this._listRemoteTools(connection);
            }

            // 注册工具（使用统一的双下划线格式）
            for (const tool of toolsList) {
                const normalizedTool = this._normalizeToolDefinition(tool);
                if (!normalizedTool) continue;
                const toolId = `${serverId}__${normalizedTool.name}`;

                this.tools.set(toolId, {
                    id: toolId,
                    serverId,
                    name: normalizedTool.name,
                    description: normalizedTool.description || '',
                    inputSchema: normalizedTool.inputSchema,
                    // MCP 格式的工具定义
                    mcpDefinition: normalizedTool
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

        if (protocol === 'sse') {
            const result = await this._sendSSERequest(connection, 'tools/list', {});
            return this._extractToolsFromPayload(result);
        }

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
                        resolve(this._extractToolsFromPayload(response.result));
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

                return this._extractToolsFromPayload(data.result);
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

        if (protocol === 'sse') {
            return await this._sendSSERequest(connection, 'tools/call', {
                name: toolName,
                arguments: args
            }, options);
        }

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
            // 支持多事件/多行 data（返回最后一个可解析的 JSON）

            const rawEvents = text.trim().split(/\r?\n\r?\n+/);
            let lastParsed = null;

            for (const rawEvent of rawEvents) {
                const lines = rawEvent.split(/\r?\n/);
                const dataLines = [];

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        dataLines.push(line.substring(6));
                    } else if (line.startsWith('data:')) {
                        dataLines.push(line.substring(5).trimStart());
                    }
                }

                const jsonData = dataLines.join('\n').trim();
                if (!jsonData) continue;

                try {
                    lastParsed = JSON.parse(jsonData);
                } catch {
                    // ignore malformed event data and keep scanning
                }
            }

            if (!lastParsed) {
                throw new Error('SSE 响应中没有找到有效的 JSON data');
            }

            console.log('[MCP] SSE 解析结果:', lastParsed);
            return lastParsed;

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
    // 使用双下划线格式
    const toolId = `${serverId}__${toolName}`;
    return await mcpClient.callTool(toolId, args, options);
}

console.log('[MCP] 📡 MCP 客户端已加载');
console.log(`[MCP] 🌐 当前平台: ${mcpClient.platform}`);
