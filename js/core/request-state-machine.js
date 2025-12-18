/**
 * 请求状态机
 * 统一管理请求的所有状态转换，防止状态泄漏
 */

import { eventBus } from './events.js';
import { elements } from './elements.js';

/**
 * 请求状态枚举
 */
export const RequestState = {
    IDLE: 'idle',                   // 空闲状态
    SENDING: 'sending',             // 正在发送用户消息
    STREAMING: 'streaming',         // 正在接收流式响应
    TOOL_CALLING: 'tool_calling',   // 正在执行工具调用
    CONTINUATION: 'continuation',   // 工具调用后的续写
    COMPLETED: 'completed',         // 请求完成（临时状态，会立即转回 IDLE）
    ERROR: 'error',                 // 请求错误（临时状态，会立即转回 IDLE）
    CANCELLED: 'cancelled'          // 请求取消（临时状态，会立即转回 IDLE）
};

/**
 * 状态转换规则
 * 定义哪些状态可以转换到哪些状态
 */
const VALID_TRANSITIONS = {
    [RequestState.IDLE]: [
        RequestState.SENDING
    ],
    [RequestState.SENDING]: [
        RequestState.STREAMING,
        RequestState.ERROR,
        RequestState.CANCELLED,
        RequestState.COMPLETED
    ],
    [RequestState.STREAMING]: [
        RequestState.TOOL_CALLING,
        RequestState.COMPLETED,
        RequestState.ERROR,
        RequestState.CANCELLED
    ],
    [RequestState.TOOL_CALLING]: [
        RequestState.CONTINUATION,
        RequestState.COMPLETED,
        RequestState.ERROR,
        RequestState.CANCELLED
    ],
    [RequestState.CONTINUATION]: [
        RequestState.STREAMING,
        RequestState.TOOL_CALLING,
        RequestState.COMPLETED,
        RequestState.ERROR,
        RequestState.CANCELLED
    ],
    [RequestState.COMPLETED]: [
        RequestState.IDLE
    ],
    [RequestState.ERROR]: [
        RequestState.IDLE
    ],
    [RequestState.CANCELLED]: [
        RequestState.IDLE
    ]
};

/**
 * 请求状态机类
 */
export class RequestStateMachine {
    constructor() {
        this.state = RequestState.IDLE;
        this.abortController = null;
        this.assistantMessageEl = null;
        this.sessionId = null;
        this.sendLockTimeout = null;
        this.stateHistory = []; // 用于调试
        this.maxHistorySize = 20;
    }

    /**
     * 获取当前状态
     */
    getState() {
        return this.state;
    }

    /**
     * 检查是否可以转换到新状态
     */
    canTransition(newState) {
        const validStates = VALID_TRANSITIONS[this.state] || [];
        return validStates.includes(newState);
    }

    /**
     * 状态转换
     */
    transition(newState, metadata = {}) {
        // 验证转换是否合法
        if (!this.canTransition(newState)) {
            console.error(`[StateMachine] ❌ 非法状态转换: ${this.state} -> ${newState}`);
            console.error('[StateMachine] 当前状态:', this.state);
            console.error('[StateMachine] 允许的转换:', VALID_TRANSITIONS[this.state]);
            // 不抛出错误，而是记录日志，防止阻塞正常流程
            return false;
        }

        const oldState = this.state;
        this.state = newState;

        // 记录状态历史
        this.stateHistory.push({
            from: oldState,
            to: newState,
            timestamp: Date.now(),
            metadata
        });
        if (this.stateHistory.length > this.maxHistorySize) {
            this.stateHistory.shift();
        }

        console.log(`[StateMachine] 状态转换: ${oldState} -> ${newState}`, metadata);

        // 执行状态进入钩子
        this._onEnterState(newState, metadata);

        // 发送状态变化事件
        eventBus.emit('request:state-changed', {
            from: oldState,
            to: newState,
            metadata
        });

        // 自动转换临时状态
        if ([RequestState.COMPLETED, RequestState.ERROR, RequestState.CANCELLED].includes(newState)) {
            // 短暂延迟后转回 IDLE（确保 UI 更新完成）
            setTimeout(() => {
                if (this.state === newState) {
                    this.transition(RequestState.IDLE);
                }
            }, 100);
        }

        return true;
    }

    /**
     * 状态进入钩子
     */
    _onEnterState(state, metadata) {
        switch (state) {
            case RequestState.IDLE:
                this._onIdle();
                break;
            case RequestState.SENDING:
                this._onSending(metadata);
                break;
            case RequestState.STREAMING:
                this._onStreaming(metadata);
                break;
            case RequestState.TOOL_CALLING:
                this._onToolCalling(metadata);
                break;
            case RequestState.CONTINUATION:
                this._onContinuation(metadata);
                break;
            case RequestState.COMPLETED:
                this._onCompleted();
                break;
            case RequestState.ERROR:
                this._onError(metadata);
                break;
            case RequestState.CANCELLED:
                this._onCancelled();
                break;
        }
    }

    /**
     * IDLE 状态钩子
     */
    _onIdle() {
        // 清理所有状态
        this.abortController = null;
        this.assistantMessageEl = null;
        this.sessionId = null;

        // 清理发送锁
        if (this.sendLockTimeout) {
            clearTimeout(this.sendLockTimeout);
            this.sendLockTimeout = null;
        }

        // 更新 UI
        this._updateUI({
            sendButtonDisabled: false,
            sendButtonVisible: true,
            cancelButtonVisible: false
        });

        console.log('[StateMachine] 已进入 IDLE 状态，所有资源已清理');
    }

    /**
     * SENDING 状态钩子
     */
    _onSending(metadata) {
        const { abortController, sessionId } = metadata;

        this.abortController = abortController;
        this.sessionId = sessionId;

        // 设置发送锁（240 秒超时）
        if (this.sendLockTimeout) {
            clearTimeout(this.sendLockTimeout);
        }
        this.sendLockTimeout = setTimeout(() => {
            console.warn('[StateMachine] 请求超时（240秒），强制释放');
            if (this.state !== RequestState.IDLE) {
                this.forceReset();
            }
        }, 240000);

        // 更新 UI
        this._updateUI({
            sendButtonDisabled: true,
            sendButtonVisible: false,
            cancelButtonVisible: true
        });
    }

    /**
     * STREAMING 状态钩子
     */
    _onStreaming(metadata) {
        const { assistantMessageEl } = metadata;

        if (assistantMessageEl) {
            this.assistantMessageEl = assistantMessageEl;
        }

        // 清除发送锁超时（已成功建立连接）
        if (this.sendLockTimeout) {
            clearTimeout(this.sendLockTimeout);
            this.sendLockTimeout = null;
        }

        // 保持 UI loading 状态
        this._updateUI({
            sendButtonDisabled: true,
            sendButtonVisible: false,
            cancelButtonVisible: true
        });
    }

    /**
     * TOOL_CALLING 状态钩子
     */
    _onToolCalling(_metadata) {
        // 保持 UI loading 状态
        this._updateUI({
            sendButtonDisabled: true,
            sendButtonVisible: false,
            cancelButtonVisible: true
        });
    }

    /**
     * CONTINUATION 状态钩子
     */
    _onContinuation(metadata) {
        const { assistantMessageEl } = metadata;

        if (assistantMessageEl) {
            this.assistantMessageEl = assistantMessageEl;
        }

        // 保持 UI loading 状态
        this._updateUI({
            sendButtonDisabled: true,
            sendButtonVisible: false,
            cancelButtonVisible: true
        });
    }

    /**
     * COMPLETED 状态钩子
     */
    _onCompleted() {
        console.log('[StateMachine] 请求完成');
    }

    /**
     * ERROR 状态钩子
     */
    _onError(metadata) {
        const { error } = metadata || {};
        console.error('[StateMachine] 请求错误:', error);
    }

    /**
     * CANCELLED 状态钩子
     */
    _onCancelled() {
        console.log('[StateMachine] 请求已取消');

        // 性能优化：缓存 querySelectorAll 结果，避免在 forEach 中重复调用
        const allLoadingElements = document.querySelectorAll('.thinking-dots, .continuation-loading, .retry-loading');
        if (allLoadingElements.length > 0) {
            allLoadingElements.forEach(el => {
                console.log('[StateMachine] 移除 loading 元素:', el.className);
                el.remove();
            });
        }
    }

    /**
     * 更新 UI 状态
     */
    _updateUI({ sendButtonDisabled, sendButtonVisible, cancelButtonVisible }) {
        if (elements.sendButton) {
            elements.sendButton.disabled = sendButtonDisabled;
            elements.sendButton.style.display = sendButtonVisible ? 'inline-flex' : 'none';
        }
        if (elements.cancelRequestButton) {
            elements.cancelRequestButton.style.display = cancelButtonVisible ? 'inline-flex' : 'none';
        }
    }

    /**
     * 强制重置到 IDLE 状态（用于异常恢复）
     */
    forceReset() {
        console.warn('[StateMachine] 强制重置到 IDLE 状态');

        // 取消当前请求（忽略所有错误）
        if (this.abortController) {
            try {
                // 检查 signal 是否已经 aborted，避免重复 abort
                if (!this.abortController.signal.aborted) {
                    this.abortController.abort();
                }
            } catch (e) {
                // 忽略 abort 错误，这是正常的取消流程
            }
        }

        // 性能优化：缓存 querySelectorAll 结果
        const allLoadingElements = document.querySelectorAll('.thinking-dots, .continuation-loading, .retry-loading');
        if (allLoadingElements.length > 0) {
            allLoadingElements.forEach(el => el.remove());
        }

        // 强制设置为 IDLE 状态（跳过状态验证）
        const oldState = this.state;
        this.state = RequestState.IDLE;
        this._onIdle();

        // 记录历史
        this.stateHistory.push({
            from: oldState,
            to: RequestState.IDLE,
            timestamp: Date.now(),
            metadata: { forced: true }
        });
        if (this.stateHistory.length > this.maxHistorySize) {
            this.stateHistory.shift();
        }

        // 发送事件
        eventBus.emit('request:state-changed', {
            from: oldState,
            to: RequestState.IDLE,
            metadata: { forced: true }
        });

        // 发送通知
        eventBus.emit('ui:notification', {
            message: '已强制重置请求状态',
            type: 'success'
        });
    }

    /**
     * 取消当前请求
     */
    cancel() {
        console.log('[StateMachine] 取消请求');

        // 检查当前状态是否允许取消
        if (this.state === RequestState.IDLE) {
            console.warn('[StateMachine] 当前为 IDLE 状态，无需取消');
            return false;
        }

        // 取消请求
        if (this.abortController) {
            this.abortController.abort();
        }

        // 转换到 CANCELLED 状态
        this.transition(RequestState.CANCELLED);

        return true;
    }

    /**
     * 检查是否正忙（不是 IDLE 状态）
     */
    isBusy() {
        return this.state !== RequestState.IDLE;
    }

    /**
     * 获取状态历史（用于调试）
     */
    getStateHistory() {
        return [...this.stateHistory];
    }

    /**
     * 打印状态历史（用于调试）
     */
    printHistory() {
        console.log('[StateMachine] 状态历史:');
        this.stateHistory.forEach((record, index) => {
            const time = new Date(record.timestamp).toLocaleTimeString();
            console.log(`  ${index + 1}. [${time}] ${record.from} -> ${record.to}`, record.metadata);
        });
    }
}

// 创建全局单例
export const requestStateMachine = new RequestStateMachine();

// 暴露到 window 用于调试
if (typeof window !== 'undefined') {
    window.__requestStateMachine = requestStateMachine;
}
