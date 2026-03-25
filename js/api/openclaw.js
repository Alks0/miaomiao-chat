/**
 * OpenClaw WebSocket 客户端
 * 管理与 OpenClaw Gateway 的 WebSocket 连接和消息通信
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { buildModelParams, buildThinkingConfig } from './params.js';
import { getToolsForAPI } from '../tools/manager.js';
import { getCurrentModel } from './handler.js';

// 请求 ID 计数器
let requestIdCounter = 0;

/**
 * OpenClaw WebSocket 客户端（单例）
 */
class OpenClawClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.connecting = false;
        this.url = '';
        this.token = '';
        this.tickInterval = null;
        this.tickIntervalMs = 30000;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.shouldReconnect = true;
        this.instanceId = null;

        // 请求/响应匹配
        this.pendingRequests = new Map();

        // 当前活跃的 run
        this.activeRunId = null;
        this.activeRunResolve = null;
        this.activeRunReject = null;
    }

    /**
     * 清理活跃 run 引用
     */
    _clearActiveRun() {
        this.activeRunId = null;
        this.activeRunResolve = null;
        this.activeRunReject = null;
    }

    /**
     * 连接到 OpenClaw Gateway
     */
    async connect(url, token) {
        if (this.connected || this.connecting) {
            return { success: true };
        }

        this.connecting = true;
        this.url = url;
        this.token = token;
        this.shouldReconnect = true;
        this.instanceId = `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        try {
            await this._establishConnection();
            this.connecting = false;
            this.connected = true;
            this.reconnectAttempts = 0;

            eventBus.emit('openclaw:connected', { url });
            console.log('[OpenClaw] 已连接到 Gateway:', url);

            return { success: true };
        } catch (error) {
            this.connecting = false;
            this.connected = false;
            console.error('[OpenClaw] 连接失败:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 建立 WebSocket 连接并完成握手
     */
    async _establishConnection() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            let handshakeHandler = null;

            const timeout = setTimeout(() => {
                if (handshakeHandler) ws.removeEventListener('message', handshakeHandler);
                try { ws.close(); } catch { /* ignore */ }
                reject(new Error('WebSocket 连接超时 (10000ms)'));
            }, 10000);

            ws.onopen = () => {
                console.log('[OpenClaw] WebSocket 已打开，发送握手请求');

                const connectMsg = {
                    type: 'method',
                    method: 'connect',
                    id: String(++requestIdCounter),
                    params: {
                        role: 'operator',
                        token: this.token,
                        scopes: ['operator.read', 'operator.write']
                    }
                };

                handshakeHandler = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'hello-ok' || (msg.type === 'result' && msg.id === connectMsg.id)) {
                            ws.removeEventListener('message', handshakeHandler);
                            clearTimeout(timeout);

                            if (msg.payload?.tickIntervalMs) {
                                this.tickIntervalMs = msg.payload.tickIntervalMs;
                            }

                            this.ws = ws;
                            this._setupMessageHandler();
                            this._startHeartbeat();
                            resolve();
                        } else if (msg.type === 'error') {
                            ws.removeEventListener('message', handshakeHandler);
                            clearTimeout(timeout);
                            try { ws.close(); } catch { /* ignore */ }
                            reject(new Error(msg.payload?.message || '握手失败'));
                        }
                    } catch {
                        // JSON 解析失败，忽略
                    }
                };

                ws.addEventListener('message', handshakeHandler);
                ws.send(JSON.stringify(connectMsg));
            };

            ws.onerror = () => {
                if (handshakeHandler) ws.removeEventListener('message', handshakeHandler);
                clearTimeout(timeout);
                try { ws.close(); } catch { /* ignore */ }
                reject(new Error('WebSocket 连接错误'));
            };
        });
    }

    /**
     * 设置消息路由
     */
    _setupMessageHandler() {
        if (!this.ws) return;

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._routeMessage(msg);
            } catch (e) {
                console.error('[OpenClaw] 消息解析失败:', e);
            }
        };

        this.ws.onclose = (event) => {
            this.connected = false;
            this._stopHeartbeat();

            console.warn(`[OpenClaw] WebSocket 断开 (code: ${event.code})`);
            eventBus.emit('openclaw:disconnected', { code: event.code, reason: event.reason });

            // 如果有活跃的 run，reject 它
            if (this.activeRunReject) {
                this.activeRunReject(new Error('WebSocket 连接断开'));
                this._clearActiveRun();
            }

            // 自动重连
            if (!event.wasClean && this.shouldReconnect) {
                this._attemptReconnect();
            }
        };

        this.ws.onerror = () => {
            console.error('[OpenClaw] WebSocket 错误');
        };
    }

    /**
     * 消息路由
     */
    _routeMessage(msg) {
        const { type, event: eventName } = msg;

        if (type === 'result') {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(msg.id);
                pending.resolve(msg.payload);
            }
            return;
        }

        if (type === 'error') {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(msg.id);
                pending.reject(new Error(msg.payload?.message || 'Unknown error'));
            } else {
                eventBus.emit('openclaw:error', msg.payload);
            }
            return;
        }

        if (type === 'event') {
            switch (eventName) {
                case 'chat.delta':
                    eventBus.emit('openclaw:chat-delta', msg.payload);
                    break;
                case 'chat.done':
                    eventBus.emit('openclaw:chat-done', msg.payload);
                    break;
                case 'agent.event':
                    eventBus.emit('openclaw:agent-event', msg.payload);
                    break;
                case 'approval':
                    eventBus.emit('openclaw:approval-requested', msg.payload);
                    break;
                case 'cron':
                    eventBus.emit('openclaw:cron-event', msg.payload);
                    break;
                case 'tick':
                    break;
                default:
                    console.log('[OpenClaw] 未知事件:', eventName, msg.payload);
            }
        }
    }

    /**
     * 发送方法调用（请求-响应模式）
     */
    send(method, params = {}, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket 未连接'));
                return;
            }

            const id = String(++requestIdCounter);
            const msg = { type: 'method', method, id, params };

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`请求超时: ${method}`));
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, reject, timeout });
            this.ws.send(JSON.stringify(msg));
        });
    }

    _sendRaw(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /**
     * 发送聊天消息
     * @returns {Promise<void>} - 当 chat.done 收到时 resolve
     */
    sendMessage(message, sessionKey, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket 未连接'));
                return;
            }

            // 如果已有活跃 run，先 reject 旧的
            if (this.activeRunReject) {
                this.activeRunReject(new Error('被新请求取代'));
                this._clearActiveRun();
            }

            const model = getCurrentModel();
            const params = {
                sessionKey: sessionKey || state.currentSessionId,
                message,
                model: options.model || model,
                ...options
            };

            const modelParams = buildModelParams('openclaw');
            Object.assign(params, modelParams);

            const thinkingConfig = buildThinkingConfig('openclaw', model);
            if (thinkingConfig) {
                Object.assign(params, thinkingConfig);
            }

            if (!state.xmlToolCallingEnabled) {
                const tools = getToolsForAPI('openclaw');
                if (tools.length > 0) {
                    params.tools = tools;
                }
            }

            const id = String(++requestIdCounter);
            const msg = {
                type: 'method',
                method: options.useRun ? 'chat.run' : 'chat.send',
                id,
                params
            };

            this.activeRunId = id;
            this.activeRunResolve = resolve;
            this.activeRunReject = reject;

            this.ws.send(JSON.stringify(msg));
        });
    }

    /**
     * 中断当前任务
     */
    async abortRun(runId) {
        try {
            await this.send('chat.abort', { runId: runId || this.activeRunId });
        } catch (e) {
            console.error('[OpenClaw] 中断失败:', e);
        }

        if (this.activeRunResolve) {
            this.activeRunResolve({ aborted: true });
            this._clearActiveRun();
        }
    }

    async approveAction(approvalId, approved) {
        return this.send('approval.respond', { approvalId, approved });
    }

    async listSessions() {
        return this.send('sessions.list');
    }

    async resetSession(key) {
        return this.send('sessions.reset', { sessionKey: key });
    }

    async compactSession(key) {
        return this.send('sessions.compact', { sessionKey: key });
    }

    async getSessionStatus(key) {
        return this.send('sessions.status', { sessionKey: key });
    }

    completeRun(result) {
        if (this.activeRunResolve) {
            this.activeRunResolve(result);
            this._clearActiveRun();
        }
    }

    failRun(error) {
        if (this.activeRunReject) {
            this.activeRunReject(error);
            this._clearActiveRun();
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.tickInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this._sendRaw({ type: 'tick' });
            }
        }, this.tickIntervalMs);
    }

    _stopHeartbeat() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    _attemptReconnect() {
        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            console.warn('[OpenClaw] 超过最大重连次数，停止重连');
            eventBus.emit('openclaw:reconnect-failed', {
                error: `超过最大重连次数 (${this.maxReconnectAttempts})`
            });
            return;
        }

        const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
        console.log(`[OpenClaw] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            if (!this.shouldReconnect || this.connected) return;
            const result = await this.connect(this.url, this.token);
            if (!result.success) {
                console.error('[OpenClaw] 重连失败:', result.error);
            }
        }, delay);
    }

    disconnect() {
        this.shouldReconnect = false;
        this._stopHeartbeat();

        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('连接已关闭'));
        }
        this.pendingRequests.clear();

        if (this.ws) {
            try { this.ws.close(1000, 'Client disconnect'); } catch { /* ignore */ }
            this.ws = null;
        }

        this.connected = false;
        this.connecting = false;
        eventBus.emit('openclaw:disconnected', { code: 1000, reason: 'Client disconnect' });
    }

    getStatus() {
        if (this.connected) return 'connected';
        if (this.connecting) return 'connecting';
        if (this.reconnectAttempts > 0 && this.shouldReconnect) return 'reconnecting';
        return 'disconnected';
    }
}

export const openclawClient = new OpenClawClient();

/**
 * 发送 OpenClaw 请求（符合 factory.js 的 sender 签名）
 * OpenClaw 使用 WS 通信，handler.js 中 openclaw 分支会跳过 response.body，
 * 直接调用 handleOpenClawStream() 监听 eventBus 事件。
 * 此函数只负责：建连 + 发送 WS 消息 + 返回 sentinel 对象。
 */
export async function sendOpenClawRequest(endpoint, apiKey, model, signal = null) {
    // 确保已连接
    if (!openclawClient.connected) {
        const result = await openclawClient.connect(endpoint, apiKey);
        if (!result.success) {
            throw new Error(`OpenClaw 连接失败: ${result.error}`);
        }
    }

    // 从 state.messages 提取最后一条用户消息文本
    const msgs = state.messages;
    let messageText = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.isError) continue;
        if (m.role === 'user') {
            if (typeof m.content === 'string') {
                messageText = m.content;
            } else if (Array.isArray(m.content)) {
                messageText = m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
            }
            break;
        }
    }

    // 监听取消信号
    if (signal) {
        signal.addEventListener('abort', () => {
            openclawClient.abortRun();
        }, { once: true });
    }

    // 发送 WS 消息（side effect）
    openclawClient.sendMessage(messageText, state.currentSessionId, {
        model,
        useRun: true
    });

    // 返回 sentinel，handler.js 检测到 openclaw 时不使用 response.body
    return { ok: true, status: 200, body: null };
}
