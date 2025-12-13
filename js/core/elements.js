/**
 * DOM 元素引用缓存
 * 使用 Proxy 模式确保元素在 DOM 准备好之后才被访问
 */

// 存储实际的元素引用
let _elements = null;
let _initialized = false;

/**
 * 初始化所有 DOM 元素引用
 * 必须在 DOMContentLoaded 之后调用
 */
function initializeElements() {
    if (_initialized) {
        console.warn('Elements already initialized');
        return _elements;
    }

    const elementMap = {
        // 核心消息区域
        messagesArea: 'messages',
        userInput: 'user-input',
        sendButton: 'send-button',
        cancelRequestButton: 'cancel-request-button',
        clearButton: 'clear-chat',
        themeToggle: 'theme-toggle',
        modelSelect: 'model-select',
        apiEndpoint: 'api-endpoint',
        apiKey: 'api-key',
        attachFile: 'attach-file',

        // 配置管理
        configSelect: 'config-select',
        saveConfig: 'save-config',
        deleteConfig: 'delete-config',

        // 导出导入
        exportConfig: 'export-config',
        exportSessions: 'export-sessions',
        exportAll: 'export-all',
        importData: 'import-data',
        importFileInput: 'import-file-input',

        // Gemini 图片配置
        geminiImageConfig: 'gemini-image-config',
        imageSizeSelect: 'image-size-select',
        geminiApiKeyInHeaderToggle: 'gemini-apikey-in-header',

        // Gemini System Parts
        geminiSystemPartsList: 'gemini-system-parts-list',
        geminiSystemPartInput: 'gemini-system-part-input',
        addGeminiSystemPart: 'add-gemini-system-part',

        // 会话管理
        sidebar: 'sidebar',
        sidebarToggle: 'sidebar-toggle',
        closeSidebar: 'close-sidebar',
        sessionList: 'session-list',
        newSessionBtn: 'new-session-btn',
        backgroundTasksIndicator: 'background-tasks-indicator',

        // 多回复配置
        replyCountSelect: 'reply-count-select',

        // ⭐ 新增：思维链和详细度控制
        thinkingNoneMode: 'thinking-none-mode',
        verbosityEnabled: 'verbosity-enabled',
        outputVerbosity: 'output-verbosity',

        // 设置面板
        settingsPanel: 'settings-panel',
        settingsToggle: 'settings-toggle',
        closeSettings: 'close-settings',

        // 输入框调整
        inputResizeHandle: 'input-resize-handle',

        // 输入框增强
        inputBarInner: 'input-bar-inner',
        charCounter: 'char-counter',

        // 滚动到底部按钮
        scrollToBottomBtn: 'scroll-to-bottom',

        // 提供商管理（左右分栏）
        providersToggle: 'providers-toggle',
        providersModal: 'providers-modal',
        closeProvidersModal: 'close-providers-modal',
        providersSearchInput: 'providers-search-input',
        providersList: 'providers-list',
        addProviderBtn: 'add-provider-btn',

        // 模型管理模态框（第三层）
        modelsManageModal: 'models-manage-modal',
        closeModelsManage: 'close-models-manage',
        modelsSearchInput: 'models-search-input',
        modelsLoading: 'models-loading',
        modelsChecklist: 'models-checklist',
        cancelModelsManage: 'cancel-models-manage',
        addSelectedModels: 'add-selected-models',
        selectedModelsCount: 'selected-models-count',

        // 快捷消息
        quickMessagesToggle: 'quick-messages-toggle',
        quickMessagesModal: 'quick-messages-modal',
        closeQuickMessagesModal: 'close-quick-messages-modal',
        quickMessagesList: 'quick-messages-list',
        addQuickMessageBtn: 'add-quick-message-btn',
        editQuickMessageModal: 'edit-quick-message-modal',
        closeEditQmModal: 'close-edit-qm-modal',
        qmNameInput: 'qm-name-input',
        qmContentInput: 'qm-content-input',
        qmCategoryInput: 'qm-category-input',
        saveQmBtn: 'save-qm-btn',
        cancelEditQmBtn: 'cancel-edit-qm-btn',

        // 会话搜索
        sessionSearchInput: 'session-search-input',
        sessionSearchClear: 'session-search-clear',
    };

    _elements = {};

    // 批量初始化元素
    for (const [key, id] of Object.entries(elementMap)) {
        _elements[key] = document.getElementById(id);
    }

    _initialized = true;

    // 验证关键元素
    validateCriticalElements();

    console.log('✅ DOM 元素初始化完成');
    return _elements;
}

/**
 * 验证关键元素是否存在
 */
function validateCriticalElements() {
    const criticalElements = [
        'messagesArea',
        'userInput',
        'sendButton',
        'sidebar',
        'settingsPanel'
    ];

    const missing = [];

    for (const key of criticalElements) {
        if (!_elements[key]) {
            missing.push(key);
        }
    }

    if (missing.length > 0) {
        console.error('❌ 关键元素缺失:', missing);
        throw new Error(`关键 DOM 元素未找到: ${missing.join(', ')}`);
    }
}

/**
 * 导出 Proxy 包装的 elements 对象
 * 确保元素在访问前已初始化
 */
export const elements = new Proxy({}, {
    get(target, prop) {
        // 如果未初始化，抛出错误
        if (!_initialized) {
            throw new Error(
                `DOM 元素尚未初始化！请确保在 DOMContentLoaded 后调用 initElements()。` +
                `尝试访问的元素: ${String(prop)}`
            );
        }

        // 返回元素引用
        return _elements[prop];
    },

    set(target, prop, value) {
        // 防止外部修改
        console.warn(`不允许修改 elements.${String(prop)}`);
        return false;
    },

    has(target, prop) {
        return _initialized && prop in _elements;
    },

    ownKeys(target) {
        if (!_initialized) return [];
        return Object.keys(_elements);
    },

    getOwnPropertyDescriptor(target, prop) {
        if (!_initialized) return undefined;
        if (prop in _elements) {
            return {
                enumerable: true,
                configurable: false,
                value: _elements[prop]
            };
        }
        return undefined;
    }
});

/**
 * 公开的初始化函数
 * 在 main.js 的 DOMContentLoaded 中调用
 */
export function initElements() {
    return initializeElements();
}

/**
 * 检查元素是否已初始化
 */
export function isElementsInitialized() {
    return _initialized;
}
