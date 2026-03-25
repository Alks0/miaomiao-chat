/**
 * 全局状态管理
 *
 * 注意：当前版本使用直接状态对象，未启用 Proxy 响应式
 * 未来可选优化：取消注释 ReactiveState 类以启用响应式状态管理
 */

// import { eventBus } from './events.js'; // Unused in current non-reactive state implementation

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

    // 消息 ID 映射（解决索引不一致问题）
    // messageId -> 数组索引，用于快速查找和防止删除错位
    messageIdMap: new Map(), // Map<messageId, number>

    // 会话脏标记（消息变更追踪，避免无变更时冗余保存）
    sessionDirty: false,

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
    fastImageCompression: false, // 高速压缩模式（512px 超级压缩）
    pdfImageModeEnabled: false, // PDF 兼容模式（将 PDF 作为图片传输）

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
    thinkingNoneMode: false,  // 关闭时是否发送 none（Responses API 模式）
    claudeAdaptiveThinking: false, // Claude 4.6 adaptive thinking 模式
    claudeEffortLevel: 'high', // Claude adaptive effort: 'low' | 'medium' | 'high'
    webSearchEnabled: false,
    geminiApiKeyInHeader: false,
    prefillEnabled: true,

    // ⭐ 新增：输出详细度配置
    verbosityEnabled: false,  // 是否启用输出详细度控制
    outputVerbosity: 'medium',  // 'low' | 'medium' | 'high'

    // ⭐ Code Execution 开关
    codeExecutionEnabled: false,  // 代码执行功能（支持 Gemini、OpenAI、Claude）

    // ⭐ Computer Use 开关和配置（仅 Electron 环境）
    computerUseEnabled: false,  // 计算机控制功能（仅 Claude + Electron）
    computerUsePermissions: {
        mouse: true,        // 允许鼠标控制
        keyboard: true,     // 允许键盘控制
        screenshot: true,   // 允许屏幕截图
        bash: true,         // 允许执行 Bash 命令
        textEditor: true    // 允许编辑文件
    },
    bashConfig: {
        workingDirectory: '',  // 默认工作目录（空表示应用根目录）
        timeout: 30,           // 超时时间（秒）
        requireConfirmation: false  // 是否需要用户确认
    },

    // 工具调用兜底
    xmlToolCallingEnabled: false,  // XML 工具调用兜底（兼容不支持原生 tools 的后端）

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

    // 工具调用历史
    toolCallHistory: [],           // 工具调用历史记录
    maxToolHistorySize: 100,       // 最大历史记录数
    toolHistoryEnabled: true,      // 是否启用历史记录

    // 工具调用权限
    toolPermissions: {
        enabled: false,            // 是否启用权限系统
        mode: 'whitelist',         // 'whitelist' | 'blacklist'
        whitelist: [],             // 白名单（仅允许列表中的工具）
        blacklist: [],             // 黑名单（禁止列表中的工具）
        requireConfirmation: false // 是否需要用户确认
    },

    // 流统计
    streamStats: {
        requestStartTime: 0,
        firstTokenTime: 0,
        endTime: 0,
        tokenCount: 0,
        isFirstToken: true
    },

    // 预填充消息（在用户最新输入之后插入）
    systemPrompt: '',
    prefillMessages: [],
    charName: 'Assistant',
    userName: 'User',
    savedPrefillPresets: [],
    currentPrefillPresetName: '',

    // System 预填充消息（在 System Prompt 之后、对话历史之前插入）
    systemPrefillMessages: [],
    savedSystemPrefillPresets: [],
    currentSystemPrefillPresetName: '',

    // Gemini System Parts
    geminiSystemPartsEnabled: false,
    geminiSystemParts: [],
    savedGeminiPartsPresets: [],
    currentGeminiPartsPresetName: '',

    // 防抖控制
    isSending: false,
    sendLockTimeout: null,

    // 快捷消息
    quickMessages: [],
    quickMessagesCategories: ['常用', '问候', '告别'],

    // MCP 配置（Model Context Protocol）
    mcpServers: [],      // MCP 服务器列表
    tools: []            // 工具列表（内置 + MCP + 自定义）
};

// 重新导出 elements（便于其他模块导入）
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
