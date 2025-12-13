/**
 * 全局状态管理
 *
 * 注意：当前版本使用直接状态对象，未启用 Proxy 响应式
 * 未来可选优化：取消注释 ReactiveState 类以启用响应式状态管理
 */

import { eventBus } from './events.js';

/* ===== 响应式状态管理（可选，未启用）=====
class ReactiveState {
    constructor(initialState) {
        this._eventBus = eventBus;
        this._state = this._makeReactive(initialState, []);
    }

    _makeReactive(obj, path) {
        if (typeof obj !== 'object' || obj === null) return obj;

        // 不代理 Map, Set, DOM 元素等特殊对象
        if (obj instanceof Map || obj instanceof Set || obj instanceof HTMLElement) {
            return obj;
        }

        return new Proxy(obj, {
            get: (target, prop) => {
                const value = target[prop];
                if (typeof value === 'object' && value !== null) {
                    return this._makeReactive(value, [...path, prop]);
                }
                return value;
            },
            set: (target, prop, value) => {
                const oldValue = target[prop];
                target[prop] = value;

                const fullPath = [...path, prop].join('.');
                this._eventBus.emit(`state:${fullPath}`, { newValue: value, oldValue, path: fullPath });
                this._eventBus.emit('state:*', { path: fullPath, newValue: value, oldValue });

                return true;
            }
        });
    }

    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this._state);
    }

    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => obj[key], this._state);
        target[lastKey] = value;
    }

    subscribe(path, callback) {
        return this._eventBus.on(`state:${path}`, callback);
    }

    subscribeAll(callback) {
        return this._eventBus.on('state:*', callback);
    }

    batch(fn) {
        const originalEmit = this._eventBus.emit;
        const changes = [];

        this._eventBus.emit = (event, data) => {
            if (event.startsWith('state:')) {
                changes.push({ event, data });
            }
        };

        fn();

        this._eventBus.emit = originalEmit;
        changes.forEach(({ event, data }) => {
            originalEmit.call(this._eventBus, event, data);
        });
    }

    getState() {
        return this._state;
    }
}
===== 响应式状态管理结束 ===== */

// 全局状态对象
export const state = {
    // 消息存储
    messages: [], // OpenAI 格式消息
    geminiContents: [], // Gemini 原生格式消息
    claudeContents: [], // Claude 原生格式消息

    // ✅ 消息 ID 映射（解决索引不一致问题）
    // messageId -> 数组索引，用于快速查找和防止删除错位
    messageIdMap: new Map(), // Map<messageId, number>

    // UI 状态
    isLoading: false,
    currentAssistantMessage: null,
    currentAbortController: null, // 🛑 用于取消当前请求
    requestTimeout: 300000, // 请求超时时间（毫秒），默认 5 分钟

    // 图片处理
    imageBuffers: new Map(), // 存储正在接收的图片分块数据
    imageIdCounter: 0,
    imageTimeoutMs: 60000,
    maxImageBufferSize: 100 * 1024 * 1024, // 100MB
    uploadedImages: [],
    imageSize: '2K', // '2K' | '4K'

    // 消息编辑
    lastUserMessage: null,
    messageHistory: [],
    maxHistorySize: 10,
    editingIndex: null,
    editingElement: null,

    // API 配置
    apiFormat: 'openai', // 'openai' | 'gemini' | 'claude'
    endpoints: {
        openai: '',
        gemini: '',
        claude: ''
    },
    apiKeys: {
        openai: '',
        gemini: '',
        claude: ''
    },
    customModels: {
        openai: '',
        gemini: '',
        claude: ''
    },
    customHeaders: [],

    // 提供商管理 (新增)
    providers: [],                    // 提供商列表
    currentProviderId: null,          // 当前使用的提供商 ID
    selectedModel: '',                // 当前选中的模型ID（从下拉列表）

    // 模型参数
    modelParams: {
        openai: {
            temperature: null,
            max_tokens: null,
            top_p: null,
            frequency_penalty: null,
            presence_penalty: null
        },
        gemini: {
            temperature: null,
            maxOutputTokens: null,
            topP: null,
            topK: null,
        },
        claude: {
            temperature: null,
            max_tokens: null,
            top_p: null,
            top_k: null
        }
    },

    // 功能开关
    streamEnabled: true,
    thinkingEnabled: false,
    thinkingStrength: 'high', // 'low' | 'medium' | 'high' | 'custom'
    thinkingBudget: 32768,
    thinkingNoneMode: false,  // ⭐ 新增：关闭时是否发送 none（Responses API 模式）
    webSearchEnabled: false,
    geminiApiKeyInHeader: false,
    prefillEnabled: true,

    // ⭐ 新增：输出详细度配置
    verbosityEnabled: false,  // 是否启用输出详细度控制
    outputVerbosity: 'medium',  // 'low' | 'medium' | 'high'

    // 配置管理
    savedConfigs: [],
    currentConfigName: '',
    pendingModelSelection: null,

    // 会话管理
    sessions: [],
    currentSessionId: null,
    isSwitchingSession: false, // 🔒 防止会话切换竞态条件
    backgroundTasks: new Map(),

    // 多回复生成
    replyCount: 1,
    currentReplies: [],
    selectedReplyIndex: 0,

    // 流统计
    streamStats: {
        requestStartTime: 0,
        firstTokenTime: 0,
        endTime: 0,
        tokenCount: 0,
        isFirstToken: true
    },

    // 预填充消息
    systemPrompt: '',
    prefillMessages: [],
    charName: 'Assistant',
    userName: 'User',
    savedPrefillPresets: [],
    currentPrefillPresetName: '',

    // Gemini System Parts
    geminiSystemParts: [],

    // 防抖控制
    isSending: false,
    sendLockTimeout: null,

    // 快捷消息
    quickMessages: [],
    quickMessagesCategories: ['常用', '问候', '告别']
};

// ✅ 重新导出 elements（便于其他模块导入）
export { elements } from './elements.js';

// 便捷函数
export const getState = () => state;

// 占位订阅函数（如果未来启用 Proxy，这里会实现真正的订阅）
export const subscribe = (path, callback) => {
    console.warn('State subscription is not enabled. Reactive state is not implemented yet.');
    return () => {}; // 返回空的取消订阅函数
};

export const batch = (fn) => {
    // 直接执行，无批处理
    fn();
};
