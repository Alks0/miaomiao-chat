/**
 * 配置管理
 * 处理应用配置的持久化和加载
 */

import { state, elements } from '../core/state.js';
import { eventBus } from '../core/events.js';
// 新增：IndexedDB 存储 API
import { saveConfig as saveConfigToDB, loadConfig as loadConfigFromDB, saveSavedConfigs as saveSavedConfigsToDB, loadSavedConfigs as loadSavedConfigsFromDB } from './storage.js';

// ⭐ 配置版本管理
const CONFIG_VERSION = 2;  // v1 = 旧格式（provider.models为字符串数组），v2 = 新格式（对象数组）

// 防抖保存配置定时器
let saveConfigTimeout = null;

/**
 * 立即保存当前配置（用于页面关闭时）
 * 优化：同时保存到 localStorage（同步）确保数据不丢失
 */
export async function saveCurrentConfigImmediate() {
    const config = buildConfigObject();

    // 关键：先同步保存到 localStorage，确保页面关闭前数据已保存
    try {
        localStorage.setItem('geminiChatConfig', JSON.stringify(config));
    } catch (e) {
        console.error('[saveCurrentConfigImmediate] localStorage 保存失败:', e);
    }

    // 然后异步保存到 IndexedDB
    try {
        if (state.storageMode !== 'localStorage') {
            await saveConfigToDB(config);
            console.log('[saveCurrentConfigImmediate] 配置已保存到 IndexedDB');
        }
    } catch (error) {
        console.error('[saveCurrentConfigImmediate] IndexedDB 保存失败:', error);
        // localStorage 已在上面保存，无需再次保存
    }
}

/**
 * 防抖保存配置（避免频繁写入）
 * 优化：立即保存到 localStorage（同步），延迟保存到 IndexedDB（异步）
 */
export function saveCurrentConfig() {
    const config = buildConfigObject();

    // 立即同步保存到 localStorage（确保数据不丢失）
    try {
        localStorage.setItem('geminiChatConfig', JSON.stringify(config));
    } catch (e) {
        console.warn('[saveCurrentConfig] localStorage 保存失败:', e);
    }

    // 清除之前的定时器
    if (saveConfigTimeout) {
        clearTimeout(saveConfigTimeout);
    }

    // 延迟 500ms 保存到 IndexedDB（减少写入频率）
    saveConfigTimeout = setTimeout(async () => {
        try {
            if (state.storageMode !== 'localStorage') {
                await saveConfigToDB(config);
                console.log('配置已保存到 IndexedDB');
            }
        } catch (error) {
            console.error('IndexedDB 保存失败:', error);
        }
    }, 500);
}

/**
 * 构建配置对象
 * @returns {Object} 配置对象
 */
function buildConfigObject() {
    return {
        // ⭐ 配置版本号（用于自动升级）
        configVersion: CONFIG_VERSION,

        // 更新时间戳（用于比较 IndexedDB 和 localStorage 的新旧）
        updatedAt: Date.now(),

        // 旧配置 (保持兼容，添加防御性检查)
        apiEndpoint: elements?.apiEndpoint?.value || '',
        apiKey: elements?.apiKey?.value || '',
        // ⚠️ 注意：selectedModel 是运行时状态，保存到 localStorage 用于刷新恢复
        // 但在配置导出时会被 export-import.js 的 filterRuntimeState() 过滤掉
        selectedModel: state.selectedModel ?? elements?.modelSelect?.value ?? '',
        apiFormat: state?.apiFormat ?? 'openai',
        imageSize: state?.imageSize ?? '2K',  // 使用 ?? 保留空字符串
        pdfImageModeEnabled: state?.pdfImageModeEnabled ?? false, // PDF 兼容模式
        replyCount: state?.replyCount ?? 1,

        // 功能开关
        streamEnabled: state.streamEnabled,
        thinkingEnabled: state.thinkingEnabled,
        thinkingStrength: state.thinkingStrength,
        thinkingBudget: state.thinkingBudget,
        thinkingNoneMode: state.thinkingNoneMode || false,
        claudeAdaptiveThinking: state.claudeAdaptiveThinking || false,
        claudeEffortLevel: state.claudeEffortLevel || 'high',
        webSearchEnabled: state.webSearchEnabled,
        geminiApiKeyInHeader: state.geminiApiKeyInHeader,

        // ⭐ 新增：输出详细度配置
        verbosityEnabled: state.verbosityEnabled || false,
        outputVerbosity: state.outputVerbosity || 'medium',

        // XML 工具调用兜底
        xmlToolCallingEnabled: state.xmlToolCallingEnabled || false,

        // 三格式独立端点（深拷贝）
        endpoints: { ...state.endpoints },
        apiKeys: { ...state.apiKeys },
        customModels: { ...state.customModels },

        // 模型参数（深拷贝）
        modelParams: JSON.parse(JSON.stringify(state.modelParams)),

        // 自定义请求头（深拷贝）
        customHeaders: [...state.customHeaders],

        // 预填充消息（深拷贝）
        prefillEnabled: state.prefillEnabled,
        systemPrompt: state.systemPrompt,
        prefillMessages: JSON.parse(JSON.stringify(state.prefillMessages)),
        charName: state.charName,
        userName: state.userName,
        savedPrefillPresets: JSON.parse(JSON.stringify(state.savedPrefillPresets)),
        currentPrefillPresetName: state.currentPrefillPresetName,

        // System 预填充消息（开场对话）
        systemPrefillMessages: JSON.parse(JSON.stringify(state.systemPrefillMessages)),
        savedSystemPrefillPresets: JSON.parse(JSON.stringify(state.savedSystemPrefillPresets)),
        currentSystemPrefillPresetName: state.currentSystemPrefillPresetName,

        // Gemini System Parts（深拷贝）
        geminiSystemPartsEnabled: state.geminiSystemPartsEnabled,
        geminiSystemParts: JSON.parse(JSON.stringify(state.geminiSystemParts)),
        savedGeminiPartsPresets: JSON.parse(JSON.stringify(state.savedGeminiPartsPresets)),
        currentGeminiPartsPresetName: state.currentGeminiPartsPresetName,

        // 提供商管理（深拷贝）
        providers: JSON.parse(JSON.stringify(state.providers || [])),
        currentProviderId: state.currentProviderId || null,

        // 快捷消息（深拷贝）
        quickMessages: JSON.parse(JSON.stringify(state.quickMessages || [])),
        quickMessagesCategories: [...(state.quickMessagesCategories || ['常用'])],
    };
}

/**
 * 获取默认能力配置（基于 API 格式）
 * @param {string} apiFormat - API 格式 (openai/gemini/claude)
 * @returns {Object} 默认能力配置
 */
export function getDefaultCapabilities(apiFormat) {
    const defaults = {
        openai: { imageInput: true, imageOutput: false },   // OpenAI 支持 Vision，但不生成图片
        gemini: { imageInput: true, imageOutput: true },    // Gemini 完全支持多模态
        claude: { imageInput: true, imageOutput: false }    // Claude 支持 Vision，但不生成图片
    };
    return defaults[apiFormat] || { imageInput: false, imageOutput: false };
}

/**
 * 升级单个 provider 的 models（字符串数组 → 对象数组）
 * @param {Object} provider - 提供商对象
 * @returns {Object} 升级后的提供商对象
 */
function upgradeProviderModels(provider) {
    if (!provider.models || provider.models.length === 0) {
        // 如果没有 models，尝试从 customModel 迁移（旧系统）
        if (provider.customModel) {
            provider.models = [{
                id: provider.customModel,
                name: provider.customModel,
                capabilities: getDefaultCapabilities(provider.apiFormat)
            }];
            console.log(`  从 customModel 迁移: ${provider.customModel}`);
        } else {
            provider.models = [];
        }
        return provider;
    }

    // 检查第一个元素的类型
    if (typeof provider.models[0] === 'object' && provider.models[0].id) {
        console.log(`  Provider "${provider.name}" 已是新格式，跳过`);
        return provider;  // 已经是对象数组
    }

    // 自动升级：字符串数组 → 对象数组
    console.log(`  ⬆️ 升级 Provider "${provider.name}" 的 models (${provider.models.length} 个模型)`);

    provider.models = provider.models.map(modelId => ({
        id: modelId,
        name: modelId,  // 默认使用 ID 作为名称
        capabilities: getDefaultCapabilities(provider.apiFormat)
    }));

    return provider;
}

/**
 * v1 → v2 升级逻辑
 * @param {Object} config - v1 配置对象
 * @returns {Object} v2 配置对象
 */
function upgradeFromV1ToV2(config) {
    console.log('执行 v1 → v2 升级: provider.models 字符串数组 → 对象数组');

    // 升级所有提供商的 models 字段
    if (config.providers && Array.isArray(config.providers)) {
        config.providers = config.providers.map(provider => {
            return upgradeProviderModels(provider);
        });
    }

    // 添加新的 state 字段（带默认值）
    return config;
}

/**
 * 配置升级主控制器（支持增量升级 v1 → v2 → v3...）
 * @param {Object} config - 原始配置对象
 * @param {number} fromVersion - 起始版本
 * @param {number} toVersion - 目标版本
 * @returns {Object} 升级后的配置对象
 */
function upgradeConfig(config, fromVersion, toVersion) {
    let currentConfig = JSON.parse(JSON.stringify(config));  // 深拷贝

    // 增量升级：v1 → v2 → v3 ...
    for (let v = fromVersion; v < toVersion; v++) {
        console.log(`升级步骤: v${v} → v${v + 1}`);

        switch (v) {
            case 1:
                // v1 → v2: 升级 provider.models 为对象数组
                currentConfig = upgradeFromV1ToV2(currentConfig);
                break;
            // 未来可添加更多版本升级逻辑
            // case 2:
            //     currentConfig = upgradeFromV2ToV3(currentConfig);
            //     break;
        }
    }

    // 标记为最新版本
    currentConfig.configVersion = toVersion;

    return currentConfig;
}

/**
 * 加载配置
 * @returns {Promise<Object|null>} 加载的配置对象，如果没有配置则返回 null
 */
export async function loadConfig() {
    let savedConfig = null;
    let idbConfig = null;
    let lsConfig = null;

    try {
        // 同时读取 IndexedDB 和 localStorage
        if (state.storageMode !== 'localStorage') {
            idbConfig = await loadConfigFromDB();
            console.log('[loadConfig] IndexedDB:', idbConfig ? `有数据 (updatedAt: ${idbConfig.updatedAt})` : '无数据');
        }

        // 读取 localStorage
        try {
            const localStorageData = localStorage.getItem('geminiChatConfig');
            if (localStorageData) {
                lsConfig = JSON.parse(localStorageData);
                console.log('[loadConfig] localStorage:', lsConfig ? `有数据 (updatedAt: ${lsConfig.updatedAt})` : '无数据');
            }
        } catch (e) {
            console.warn('[loadConfig] localStorage 解析失败:', e);
        }

        // 比较两个来源，使用更新的那个
        if (idbConfig && lsConfig) {
            const idbTime = idbConfig.updatedAt || 0;
            const lsTime = lsConfig.updatedAt || 0;
            if (lsTime > idbTime) {
                console.log('[loadConfig] ⚠️ localStorage 更新，使用 localStorage 数据');
                savedConfig = lsConfig;
                // 同步到 IndexedDB
                saveConfigToDB(lsConfig).catch(e => console.warn('[loadConfig] 同步到 IndexedDB 失败:', e));
            } else {
                savedConfig = idbConfig;
            }
        } else {
            savedConfig = idbConfig || lsConfig;
        }

        if (!savedConfig) {
            console.log('[loadConfig] 没有保存的配置，使用默认值');
            return null;
        }

        console.log('[loadConfig] 解析配置成功, apiFormat:', savedConfig.apiFormat);

        // 应用配置到 state
        applyConfigToState(savedConfig);

        // 验证 currentProviderId 是否有效
        if (state.currentProviderId) {
            const provider = state.providers.find(p => p.id === state.currentProviderId);
            if (!provider || !provider.enabled) {
                console.warn(`[loadConfig] currentProviderId 无效，已清除: ${state.currentProviderId}`);
                state.currentProviderId = null;
            } else {
                console.log(`[loadConfig] currentProviderId 有效: ${provider.name} (${provider.id})`);

                // 同步 provider 的 geminiApiKeyInHeader 到 state（用于 API 请求）
                if (provider.apiFormat === 'gemini' && provider.geminiApiKeyInHeader !== undefined) {
                    state.geminiApiKeyInHeader = provider.geminiApiKeyInHeader;
                    console.log(`🔄 同步 geminiApiKeyInHeader: ${state.geminiApiKeyInHeader}`);
                }
            }
        }

        console.log('配置已加载:', savedConfig);

        // 同步 UI 状态
        syncUIWithState();

        // 发出事件通知配置已加载
        eventBus.emit('config:loaded', { config: savedConfig });

        return savedConfig;
    } catch (e) {
        console.error('[loadConfig] 加载配置失败:', e);
        return null;
    }
}

/**
 * 应用配置到 state
 * @param {Object} config - 配置对象
 */
function applyConfigToState(config) {
    // ⭐ 配置版本检测和自动升级
    const configVersion = config.configVersion || 1;  // 默认为 v1（旧格式）

    console.log(`📋 配置版本: v${configVersion}，当前版本: v${CONFIG_VERSION}`);

    // 需要升级
    if (configVersion < CONFIG_VERSION) {
        console.log(`⬆️ 开始配置升级: v${configVersion} → v${CONFIG_VERSION}`);

        // 备份旧配置（防止升级失败）
        try {
            localStorage.setItem('config_backup_v' + configVersion, JSON.stringify(config));
            console.log('旧配置已备份到 config_backup_v' + configVersion);
        } catch (e) {
            console.error('❌ 配置备份失败:', e);
        }

        // 执行升级
        try {
            config = upgradeConfig(config, configVersion, CONFIG_VERSION);
            console.log('配置升级成功');
        } catch (error) {
            console.error('❌ 配置升级失败:', error);
            // 尝试从备份恢复
            const backup = localStorage.getItem('config_backup_v' + configVersion);
            if (backup) {
                config = JSON.parse(backup);
                console.log('⚠️ 已回滚到备份配置');
            }
        }
    } else if (configVersion === CONFIG_VERSION) {
        console.log('配置版本已是最新，无需升级');
    } else {
        console.warn(`⚠️ 配置版本 v${configVersion} 高于当前支持的版本 v${CONFIG_VERSION}，可能存在兼容性问题`);
    }

    // 旧配置兼容 (保持向后兼容)
    if (config.apiEndpoint && elements.apiEndpoint) {
        elements.apiEndpoint.value = config.apiEndpoint;
    }
    if (config.apiKey && elements.apiKey) {
        elements.apiKey.value = config.apiKey;
    }
    if (config.selectedModel) {
        state.pendingModelSelection = config.selectedModel;
    }
    if (config.imageSize !== undefined) {
        state.imageSize = config.imageSize;
        if (elements.imageSizeSelect) {
            elements.imageSizeSelect.value = config.imageSize;
        }
    }
    if (config.pdfImageModeEnabled !== undefined) {
        state.pdfImageModeEnabled = config.pdfImageModeEnabled;
    }
    if (config.replyCount !== undefined) {
        state.replyCount = config.replyCount;
        if (elements.replyCountSelect) {
            elements.replyCountSelect.value = config.replyCount;
        }
    }

    // 新增功能开关 (带默认值兜底)
    state.streamEnabled = config.streamEnabled ?? true;
    state.thinkingEnabled = config.thinkingEnabled ?? false;
    state.thinkingStrength = config.thinkingStrength ?? 'high';
    state.thinkingBudget = config.thinkingBudget ?? 32768;
    state.thinkingNoneMode = config.thinkingNoneMode ?? false;
    state.claudeAdaptiveThinking = config.claudeAdaptiveThinking ?? false;
    state.claudeEffortLevel = config.claudeEffortLevel ?? 'high';
    state.webSearchEnabled = config.webSearchEnabled ?? false;
    state.geminiApiKeyInHeader = config.geminiApiKeyInHeader ?? false;

    // ⭐ 新增：输出详细度配置（向后兼容）
    state.verbosityEnabled = config.verbosityEnabled ?? false;
    state.outputVerbosity = config.outputVerbosity ?? 'medium';

    // XML 工具调用兜底
    state.xmlToolCallingEnabled = config.xmlToolCallingEnabled ?? false;

    // 三格式独立端点 (带默认值兜底)
    state.endpoints = config.endpoints ?? { openai: '', gemini: '', claude: '' };
    state.apiKeys = config.apiKeys ?? { openai: '', gemini: '', claude: '' };
    state.customModels = config.customModels ?? { openai: '', gemini: '', claude: '' };

    // 模型参数 (深度合并)
    if (config.modelParams) {
        ['openai', 'gemini', 'claude'].forEach(format => {
            if (config.modelParams[format]) {
                state.modelParams[format] = { ...state.modelParams[format], ...config.modelParams[format] };
            }
        });
    }

    // 自定义请求头
    state.customHeaders = config.customHeaders ?? [];

    // 预填充消息
    state.prefillEnabled = config.prefillEnabled ?? true;
    state.systemPrompt = config.systemPrompt ?? '';
    state.prefillMessages = config.prefillMessages ?? [];
    state.charName = config.charName ?? 'Assistant';
    state.userName = config.userName ?? 'User';
    state.savedPrefillPresets = config.savedPrefillPresets ?? [];
    state.currentPrefillPresetName = config.currentPrefillPresetName ?? '';

    // System 预填充消息（开场对话）
    state.systemPrefillMessages = config.systemPrefillMessages ?? [];
    state.savedSystemPrefillPresets = config.savedSystemPrefillPresets ?? [];
    state.currentSystemPrefillPresetName = config.currentSystemPrefillPresetName ?? '';

    // Gemini System Parts
    state.geminiSystemPartsEnabled = config.geminiSystemPartsEnabled ?? false;
    state.geminiSystemParts = config.geminiSystemParts ?? [];
    state.savedGeminiPartsPresets = config.savedGeminiPartsPresets ?? [];
    state.currentGeminiPartsPresetName = config.currentGeminiPartsPresetName ?? '';

    // 提供商管理
    state.providers = config.providers ?? [];
    state.currentProviderId = config.currentProviderId ?? null;

    // 快捷消息
    state.quickMessages = config.quickMessages ?? [];
    state.quickMessagesCategories = config.quickMessagesCategories ?? ['常用', '问候', '告别'];

    // 恢复 selectedModel（用于刷新页面后的恢复）
    // ⚠️ 注意：导入配置时，selectedModel 会被 export-import.js 过滤掉，所以这里不会覆盖当前模型选择
    if (config.selectedModel !== undefined) {
        state.selectedModel = config.selectedModel;
    }

    // 自动迁移旧格式providers（没有 models 字段）
    state.providers.forEach(provider => {
        if (!provider.models) {
            provider.models = [];
            // 如果有 customModel，迁移到 models[]
            if (provider.customModel) {
                provider.models.push(provider.customModel);
            }
        }

        // 自动迁移：添加多密钥管理字段（v1.1.12+）
        if (!provider.apiKeys) {
            provider.apiKeys = [];
            // 如果有旧的 apiKey，迁移到 apiKeys[]
            if (provider.apiKey) {
                const keyId = 'key-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                provider.apiKeys.push({
                    id: keyId,
                    key: provider.apiKey,
                    name: '密钥 1',
                    enabled: true,
                    usageCount: 0,
                    lastUsed: null,
                    errorCount: 0
                });
                provider.currentKeyId = keyId;
            }
        }
        if (!provider.keyRotation) {
            provider.keyRotation = {
                enabled: false,
                strategy: 'round-robin',
                rotateOnError: true,
                currentIndex: 0
            };
        }
    });

    // API 格式直接设置（不通过事件，避免时序问题）
    if (['openai', 'gemini', 'claude'].includes(config.apiFormat)) {
        state.apiFormat = config.apiFormat;

        // 直接更新UI
        const formatBtns = {
            openai: document.getElementById('format-openai'),
            gemini: document.getElementById('format-gemini'),
            claude: document.getElementById('format-claude')
        };

        Object.entries(formatBtns).forEach(([fmt, btn]) => {
            btn?.classList.toggle('active', fmt === config.apiFormat);
        });

        // 更新配置面板显示：只显示当前格式对应的配置面板
        document.querySelectorAll('.api-config').forEach(panel => {
            panel.style.display = 'none';
        });
        const configPanel = document.getElementById(`${config.apiFormat}-config`);
        if (configPanel) {
            configPanel.style.display = 'block';
        }

        console.log(`API格式已恢复为: ${config.apiFormat}`);
    }
}

/**
 * 加载已保存的配置列表
 */
export async function loadSavedConfigs() {
    try {
        // 优先从 IndexedDB 加载
        if (state.storageMode !== 'localStorage') {
            const configs = await loadSavedConfigsFromDB();
            if (configs) {
                state.savedConfigs = configs;
                console.log('[loadSavedConfigs] 从 IndexedDB 加载配置列表:', configs.length);
                return;
            }
        }

        // 降级：从 localStorage 加载
        const saved = localStorage.getItem('geminiChatConfigs');
        if (saved) {
            state.savedConfigs = JSON.parse(saved);
            console.log('[loadSavedConfigs] 从 localStorage 加载配置列表（降级模式）');
        } else {
            state.savedConfigs = [];
        }
    } catch (e) {
        console.error('[loadSavedConfigs] 加载失败:', e);
        state.savedConfigs = [];
    }
}

/**
 * 保存配置列表
 */
export async function saveSavedConfigs() {
    try {
        // 优先保存到 IndexedDB
        if (state.storageMode !== 'localStorage') {
            await saveSavedConfigsToDB(state.savedConfigs);
            console.log('[saveSavedConfigs] 配置列表已保存到 IndexedDB');
        } else {
            // 降级：保存到 localStorage
            localStorage.setItem('geminiChatConfigs', JSON.stringify(state.savedConfigs));
            console.log('[saveSavedConfigs] 配置列表已保存到 localStorage（降级模式）');
        }
    } catch (error) {
        console.error('[saveSavedConfigs] IndexedDB 保存失败，降级到 localStorage:', error);
        // 降级处理
        localStorage.setItem('geminiChatConfigs', JSON.stringify(state.savedConfigs));
    }
}

/**
 * 导出配置为 JSON
 * @returns {Object} 配置对象
 */
export function exportConfigData() {
    return buildConfigObject();
}

/**
 * 导入配置
 * @param {Object} configData - 配置数据
 */
export function importConfigData(configData) {
    applyConfigToState(configData);
    saveCurrentConfig();
}

/**
 * 生成导出文件名
 * @param {string} type - 导出类型
 * @returns {string} 文件名
 */
export function generateExportFilename(type) {
    const date = new Date().toISOString().slice(0, 10);
    return `webchat-${type}-${date}.json`;
}

/**
 * 下载 JSON 文件
 * @param {Object} data - 要导出的数据
 * @param {string} filename - 文件名
 */
export function downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 同步模型参数到UI输入框
 */
function syncModelParamsToUI() {
    // OpenAI 参数
    const openaiParams = {
        'openai-temperature': 'temperature',
        'openai-max-tokens': 'max_tokens',
        'openai-top-p': 'top_p',
        'openai-frequency-penalty': 'frequency_penalty',
        'openai-presence-penalty': 'presence_penalty'
    };

    // Gemini 参数
    const geminiParams = {
        'gemini-temperature': 'temperature',
        'gemini-max-output-tokens': 'maxOutputTokens',
        'gemini-top-p': 'topP',
        'gemini-top-k': 'topK'
    };

    // Claude 参数
    const claudeParams = {
        'claude-temperature': 'temperature',
        'claude-max-tokens': 'max_tokens',
        'claude-top-p': 'top_p',
        'claude-top-k': 'top_k'
    };

    syncParamsToInputs('openai', openaiParams);
    syncParamsToInputs('gemini', geminiParams);
    syncParamsToInputs('claude', claudeParams);
}

function syncParamsToInputs(format, paramsMap) {
    Object.entries(paramsMap).forEach(([inputId, paramKey]) => {
        const input = document.getElementById(inputId);
        if (input) {
            const value = state.modelParams[format][paramKey];
            input.value = (value !== null && value !== undefined) ? value : '';
        }
    });
}

/**
 * 将 state 同步到 UI 元素
 */
export function syncUIWithState() {
    // 流式开关
    const streamEnabled = document.getElementById('stream-enabled');
    if (streamEnabled) {
        streamEnabled.checked = state.streamEnabled;
    }

    // PDF 兼容模式
    const pdfImageModeSwitch = document.getElementById('pdf-image-mode-enabled');
    if (pdfImageModeSwitch) {
        pdfImageModeSwitch.checked = state.pdfImageModeEnabled || false;
    }

    // 思维链开关
    const thinkingEnabled = document.getElementById('thinking-enabled');
    const thinkingStrengthGroup = document.getElementById('thinking-strength-group');
    const thinkingHint = document.getElementById('thinking-hint');
    const budgetGroup = document.getElementById('thinking-budget-group');
    const budgetInput = document.getElementById('thinking-budget');
    if (thinkingEnabled) {
        thinkingEnabled.checked = state.thinkingEnabled;
        if (thinkingStrengthGroup) {
            thinkingStrengthGroup.style.display = state.thinkingEnabled ? 'flex' : 'none';
        }
        if (thinkingHint) {
            thinkingHint.style.display = state.thinkingEnabled ? 'block' : 'none';
        }
        // 更新自定义 budget 输入框显示状态和值
        if (budgetGroup) {
            const showBudget = state.thinkingEnabled && state.thinkingStrength === 'custom';
            budgetGroup.style.display = showBudget ? 'flex' : 'none';
        }
        if (budgetInput) {
            budgetInput.value = state.thinkingBudget;
        }
    }

    // 思维链强度按钮
    const strengthBtns = document.querySelectorAll('.strength-btn');
    strengthBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.strength === state.thinkingStrength);
    });

    // 网络搜索开关
    const webSearchEnabled = document.getElementById('web-search-enabled');
    if (webSearchEnabled) {
        webSearchEnabled.checked = state.webSearchEnabled;
    }

    // XML 工具调用兜底
    const xmlToolCalling = document.getElementById('xml-tool-calling-enabled');
    if (xmlToolCalling) {
        xmlToolCalling.checked = state.xmlToolCallingEnabled;
    }

    // 三格式端点输入框和自定义模型
    ['openai', 'gemini', 'claude'].forEach(format => {
        const endpointInput = document.getElementById(`${format}-endpoint`);
        const apikeyInput = document.getElementById(`${format}-apikey`);
        const customModelInput = document.getElementById(`${format}-custom-model`);

        // 使用 !== undefined 确保空字符串也能正确设置
        if (endpointInput && state.endpoints[format] !== undefined) {
            endpointInput.value = state.endpoints[format];
        }
        if (apikeyInput && state.apiKeys[format] !== undefined) {
            apikeyInput.value = state.apiKeys[format];
        }
        if (customModelInput && state.customModels[format] !== undefined) {
            customModelInput.value = state.customModels[format];
        }
    });

    // 同步模型参数到 UI
    syncModelParamsToUI();

    // 自定义请求头
    import('../ui/enhancements.js').then(({ renderCustomHeaders }) => {
        if (renderCustomHeaders) renderCustomHeaders();
    }).catch(() => {});

    // 预填充 UI 同步
    const prefillEnabled = document.getElementById('prefill-enabled');
    if (prefillEnabled) {
        prefillEnabled.checked = state.prefillEnabled;
    }
    document.getElementById('prefill-config')?.classList.toggle('disabled', !state.prefillEnabled);
    const systemPromptInput = document.getElementById('system-prompt-input');
    if (systemPromptInput) {
        systemPromptInput.value = state.systemPrompt;
    }
    const charNameInput = document.getElementById('char-name');
    if (charNameInput) {
        charNameInput.value = state.charName;
    }
    const userNameInput = document.getElementById('user-name');
    if (userNameInput) {
        userNameInput.value = state.userName;
    }

    // 预填充相关UI - 渲染列表和预设选择器
    import('../ui/prefill.js').then(({ renderPrefillMessagesList, updatePrefillPresetSelect }) => {
        if (renderPrefillMessagesList) renderPrefillMessagesList();
        if (updatePrefillPresetSelect) updatePrefillPresetSelect();
    }).catch(() => {});

    // 快捷开关同步
    import('../ui/quick-toggles.js').then(({ syncQuickToggles }) => {
        if (syncQuickToggles) syncQuickToggles();
    }).catch(() => {});

    // 图片尺寸选择
    if (elements.imageSizeSelect && state.imageSize) {
        elements.imageSizeSelect.value = state.imageSize;
    }

    // Gemini API key 传递方式
    if (elements.geminiApiKeyInHeaderToggle) {
        elements.geminiApiKeyInHeaderToggle.checked = state.geminiApiKeyInHeader || false;
    }

    // 多回复数量
    if (elements.replyCountSelect && state.replyCount) {
        elements.replyCountSelect.value = state.replyCount;
    }

    // API 格式标签高亮
    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.format === state.apiFormat);
    });

    console.log('UI synced with state');
}
