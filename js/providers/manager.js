/**
 * 提供商管理模块
 * 负责提供商的创建、更新、删除、切换和数据同步
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { saveCurrentConfig, getDefaultCapabilities } from '../state/config.js';
import { setApiFormat } from '../ui/format-switcher.js';

/**
 * 生成唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string} 唯一标识符
 */
function generateId(prefix = 'provider') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成密钥 ID
 * @returns {string} 密钥唯一标识符
 */
function generateKeyId() {
    return generateId('key');
}

/**
 * 创建提供商
 * @param {Object} data - 提供商数据
 * @returns {Object} 创建的提供商对象
 */
export function createProvider(data) {
    // 初始化密钥列表
    let apiKeys = [];
    let currentKeyId = null;

    if (data.apiKey) {
        const keyId = generateKeyId();
        apiKeys.push({
            id: keyId,
            key: data.apiKey,
            name: '密钥 1',
            enabled: true,
            usageCount: 0,
            lastUsed: null,
            errorCount: 0,
        });
        currentKeyId = keyId;
    }

    const provider = {
        id: generateId(),
        name: data.name,
        apiFormat: data.apiFormat,
        endpoint: data.endpoint || getDefaultEndpoint(data.apiFormat),
        apiKey: data.apiKey || '', // 保留兼容：当前使用的密钥
        apiKeys: apiKeys, // 密钥列表
        currentKeyId: currentKeyId, // 当前选中的密钥 ID
        keyRotation: { // 轮询配置
            enabled: false,
            strategy: 'round-robin', // round-robin | random | least-used | smart
            rotateOnError: true,
            currentIndex: 0,
        },
        enabled: true,
        models: data.models || [],
        createdAt: Date.now(),
        geminiApiKeyInHeader: data.geminiApiKeyInHeader || false,
        modelParams: null,
    };

    state.providers.push(provider);
    saveCurrentConfig();
    eventBus.emit('providers:added', { provider });

    return provider;
}

/**
 * 更新提供商
 * @param {string} id - 提供商 ID
 * @param {Object} updates - 更新的字段
 * @returns {Object|null} 更新后的提供商对象
 */
export function updateProvider(id, updates) {
    const index = state.providers.findIndex(p => p.id === id);
    if (index === -1) return null;

    Object.assign(state.providers[index], updates);

    saveCurrentConfig();
    eventBus.emit('providers:updated', { id, provider: state.providers[index] });

    return state.providers[index];
}

/**
 * 删除提供商
 * @param {string} id - 提供商 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteProvider(id) {
    const index = state.providers.findIndex(p => p.id === id);
    if (index === -1) return false;

    state.providers.splice(index, 1);
    saveCurrentConfig();
    eventBus.emit('providers:deleted', { id });

    return true;
}

// ============================================
// 多密钥管理功能
// ============================================

/**
 * 确保提供商有 apiKeys 数组（兼容旧数据）
 * @param {Object} provider - 提供商对象
 */
export function ensureApiKeysArray(provider) {
    if (!provider.apiKeys) {
        provider.apiKeys = [];
        provider.currentKeyId = null;
        provider.keyRotation = {
            enabled: false,
            strategy: 'round-robin',
            rotateOnError: true,
            currentIndex: 0,
        };

        // 迁移旧的 apiKey 到 apiKeys 数组
        if (provider.apiKey) {
            const keyId = generateKeyId();
            provider.apiKeys.push({
                id: keyId,
                key: provider.apiKey,
                name: '密钥 1',
                enabled: true,
                usageCount: 0,
                lastUsed: null,
                errorCount: 0,
            });
            provider.currentKeyId = keyId;
        }
    }
}

/**
 * 添加 API 密钥
 * @param {string} providerId - 提供商 ID
 * @param {string} key - 密钥值
 * @param {string} name - 密钥名称（可选）
 * @returns {Object|null} 新增的密钥对象
 */
export function addApiKey(providerId, key, name = '') {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return null;

    ensureApiKeysArray(provider);

    const keyId = generateKeyId();
    const keyName = name || `密钥 ${provider.apiKeys.length + 1}`;

    const newKey = {
        id: keyId,
        key: key,
        name: keyName,
        enabled: true,
        usageCount: 0,
        lastUsed: null,
        errorCount: 0,
    };

    provider.apiKeys.push(newKey);

    // 如果是第一个密钥，自动设为当前密钥
    if (provider.apiKeys.length === 1) {
        provider.currentKeyId = keyId;
        provider.apiKey = key;
    }

    saveCurrentConfig();
    eventBus.emit('providers:key-added', { providerId, key: newKey });

    return newKey;
}

/**
 * 删除 API 密钥
 * @param {string} providerId - 提供商 ID
 * @param {string} keyId - 密钥 ID
 * @returns {boolean} 是否删除成功
 */
export function removeApiKey(providerId, keyId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider || !provider.apiKeys) return false;

    const index = provider.apiKeys.findIndex(k => k.id === keyId);
    if (index === -1) return false;

    provider.apiKeys.splice(index, 1);

    // 如果删除的是当前密钥，切换到第一个可用密钥
    if (provider.currentKeyId === keyId) {
        const nextKey = provider.apiKeys.find(k => k.enabled);
        provider.currentKeyId = nextKey?.id || null;
        provider.apiKey = nextKey?.key || '';
    }

    saveCurrentConfig();
    eventBus.emit('providers:key-removed', { providerId, keyId });

    return true;
}

/**
 * 设置当前使用的密钥
 * @param {string} providerId - 提供商 ID
 * @param {string} keyId - 密钥 ID
 * @returns {boolean} 是否设置成功
 */
export function setCurrentKey(providerId, keyId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider || !provider.apiKeys) return false;

    const key = provider.apiKeys.find(k => k.id === keyId);
    if (!key) return false;

    provider.currentKeyId = keyId;
    provider.apiKey = key.key; // 同步到兼容字段

    // ✅ 切换密钥时清除模型缓存，确保下次拉取使用新密钥
    clearModelsCache(providerId);

    saveCurrentConfig();
    eventBus.emit('providers:key-changed', { providerId, keyId });

    return true;
}

/**
 * 更新密钥信息
 * @param {string} providerId - 提供商 ID
 * @param {string} keyId - 密钥 ID
 * @param {Object} updates - 更新内容
 * @returns {Object|null} 更新后的密钥对象
 */
export function updateApiKey(providerId, keyId, updates) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider || !provider.apiKeys) return null;

    const key = provider.apiKeys.find(k => k.id === keyId);
    if (!key) return null;

    Object.assign(key, updates);

    // 如果更新的是当前密钥的 key 值，同步到兼容字段
    if (provider.currentKeyId === keyId && updates.key) {
        provider.apiKey = updates.key;
    }

    saveCurrentConfig();
    eventBus.emit('providers:key-updated', { providerId, keyId, key });

    return key;
}

/**
 * 获取当前有效的 API 密钥
 * @param {string} providerId - 提供商 ID
 * @returns {string} API 密钥
 */
export function getActiveApiKey(providerId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return '';

    ensureApiKeysArray(provider);

    // 如果没有密钥列表，返回兼容字段
    if (!provider.apiKeys || provider.apiKeys.length === 0) {
        return provider.apiKey || '';
    }

    // 如果开启了轮询，使用轮询逻辑
    if (provider.keyRotation?.enabled) {
        return getRotatedKey(provider);
    }

    // 否则使用当前选中的密钥
    const currentKey = provider.apiKeys.find(k => k.id === provider.currentKeyId && k.enabled);
    if (currentKey) {
        return currentKey.key;
    }

    // 回退：返回第一个可用密钥
    const firstEnabled = provider.apiKeys.find(k => k.enabled);
    return firstEnabled?.key || provider.apiKey || '';
}

/**
 * 根据轮询策略获取密钥
 * @param {Object} provider - 提供商对象
 * @returns {string} API 密钥
 */
function getRotatedKey(provider) {
    const enabledKeys = provider.apiKeys.filter(k => k.enabled);
    if (enabledKeys.length === 0) return provider.apiKey || '';

    const rotation = provider.keyRotation;
    let selectedKey;

    switch (rotation.strategy) {
        case 'random':
            selectedKey = enabledKeys[Math.floor(Math.random() * enabledKeys.length)];
            break;

        case 'least-used':
            selectedKey = enabledKeys.reduce((min, k) =>
                k.usageCount < min.usageCount ? k : min
            );
            break;

        case 'smart':
            // 综合考虑使用次数和错误率
            selectedKey = enabledKeys.reduce((best, k) => {
                const score = k.usageCount + k.errorCount * 10; // 错误权重更高
                const bestScore = best.usageCount + best.errorCount * 10;
                return score < bestScore ? k : best;
            });
            break;

        case 'round-robin':
        default:
            const index = rotation.currentIndex % enabledKeys.length;
            selectedKey = enabledKeys[index];
            rotation.currentIndex = (index + 1) % enabledKeys.length;
            break;
    }

    // 更新使用统计
    selectedKey.usageCount++;
    selectedKey.lastUsed = Date.now();

    return selectedKey.key;
}

/**
 * 轮询切换到下一个密钥（遇到错误时调用）
 * @param {string} providerId - 提供商 ID
 * @param {boolean} markError - 是否标记当前密钥错误
 * @returns {string} 新的 API 密钥
 */
export function rotateToNextKey(providerId, markError = false) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider || !provider.apiKeys || provider.apiKeys.length <= 1) {
        return provider?.apiKey || '';
    }

    ensureApiKeysArray(provider);

    // 标记当前密钥错误
    if (markError) {
        const currentKey = provider.apiKeys.find(k => k.id === provider.currentKeyId);
        if (currentKey) {
            currentKey.errorCount++;
        }
    }

    // 获取可用密钥列表（排除当前密钥）
    const enabledKeys = provider.apiKeys.filter(k => k.enabled && k.id !== provider.currentKeyId);
    if (enabledKeys.length === 0) {
        return provider.apiKey || '';
    }

    // 选择下一个密钥
    const nextKey = enabledKeys[0];
    provider.currentKeyId = nextKey.id;
    provider.apiKey = nextKey.key;

    saveCurrentConfig();
    eventBus.emit('providers:key-rotated', { providerId, keyId: nextKey.id });

    console.log(`[KeyRotation] 切换到密钥: ${nextKey.name} (${nextKey.id})`);

    return nextKey.key;
}

/**
 * 设置密钥轮询配置
 * @param {string} providerId - 提供商 ID
 * @param {Object} config - 轮询配置
 */
export function setKeyRotationConfig(providerId, config) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    ensureApiKeysArray(provider);

    provider.keyRotation = {
        ...provider.keyRotation,
        ...config,
    };

    saveCurrentConfig();
    eventBus.emit('providers:rotation-config-changed', { providerId, config: provider.keyRotation });
}

/**
 * 获取当前提供商（根据选中的模型自动判断）
 * @returns {Object|undefined} 当前提供商对象
 */
export function getCurrentProvider() {
    // ✅ 优先1: 使用存储的 currentProviderId（避免同名模型冲突）
    if (state.currentProviderId) {
        const provider = state.providers.find(p => p.id === state.currentProviderId);
        if (provider && provider.enabled) {
            console.log(`[getCurrentProvider] 使用 currentProviderId: ${provider.name} (${provider.id})`);
            return provider;
        } else {
            console.warn(`[getCurrentProvider] currentProviderId 无效或已禁用: ${state.currentProviderId}`);
            // ⚠️ 清除无效的 currentProviderId
            state.currentProviderId = null;
        }
    }

    // 2. 获取当前选中的模型
    let selectedModel = null;

    // 优先从下拉列表获取
    if (typeof elements !== 'undefined' && elements.modelSelect?.value) {
        selectedModel = elements.modelSelect.value;
    } else if (state.selectedModel) {
        // 其次从 state 获取
        selectedModel = state.selectedModel;
    }

    // 3. 如果有选中的模型，找到包含该模型的提供商
    // ✅ 修复: 优先匹配 apiFormat，并支持对象数组格式
    if (selectedModel) {
        const matchingProviders = state.providers.filter(p => {
            if (!p.enabled || !p.models) return false;

            // ✅ 兼容字符串和对象格式
            return p.models.some(m => {
                if (typeof m === 'string') return m === selectedModel;
                if (typeof m === 'object' && m.id) return m.id === selectedModel;
                return false;
            });
        });

        if (matchingProviders.length > 0) {
            // ✅ 优先返回 apiFormat 匹配的提供商
            const formatMatched = matchingProviders.find(p => p.apiFormat === state.apiFormat);
            const provider = formatMatched || matchingProviders[0];

            console.log(`[getCurrentProvider] 根据模型查找: ${provider.name} (${selectedModel}, apiFormat: ${provider.apiFormat})`);
            if (matchingProviders.length > 1) {
                console.warn(`[getCurrentProvider] 多个提供商包含模型 ${selectedModel}, 使用: ${provider.name} (apiFormat: ${provider.apiFormat})`);
            }
            return provider;
        }
    }

    // 4. 如果没有找到，返回第一个启用的提供商
    const firstEnabled = state.providers.find(p => p.enabled);
    if (firstEnabled) {
        console.log(`[getCurrentProvider] 使用第一个启用的提供商: ${firstEnabled.name}`);
        return firstEnabled;
    }

    // 5. 最后返回第一个提供商（即使未启用）
    const fallback = state.providers[0];
    console.warn(`[getCurrentProvider] 使用第一个提供商（可能未启用）: ${fallback?.name || 'none'}`);
    return fallback;
}

/**
 * 获取模型的友好显示名称
 * @param {string} modelId - 模型 ID
 * @param {Object} provider - 提供商对象（可选）
 * @returns {string} 模型显示名称
 */
export function getModelDisplayName(modelId, provider = null) {
    if (!modelId) return 'unknown';

    // 如果没有指定提供商，尝试获取当前提供商
    const targetProvider = provider || getCurrentProvider();

    if (!targetProvider || !targetProvider.models) {
        // 没有提供商信息，直接返回模型 ID
        return modelId;
    }

    // 查找模型配置
    const modelConfig = targetProvider.models.find(m => {
        if (typeof m === 'string') {
            return m === modelId;
        }
        if (typeof m === 'object' && m.id) {
            return m.id === modelId;
        }
        return false;
    });

    if (!modelConfig) {
        // 未找到模型配置，返回模型 ID 本身
        return modelId;
    }

    // 如果是对象格式且有 name 字段，返回友好名称
    if (typeof modelConfig === 'object' && modelConfig.name) {
        return modelConfig.name;
    }

    // 否则返回模型 ID
    return modelId;
}

/**
 * 获取当前选中模型的能力配置
 * @returns {Object|null} 能力配置对象 {imageInput: boolean, imageOutput: boolean}
 */
export function getCurrentModelCapabilities() {
    const provider = getCurrentProvider();
    if (!provider || !provider.models) {
        console.warn('[getCurrentModelCapabilities] 无有效的提供商或模型列表');
        return null;
    }

    const selectedModel = state.selectedModel || elements.modelSelect?.value;
    if (!selectedModel) {
        console.warn('[getCurrentModelCapabilities] 未选中任何模型');
        return null;
    }

    // 查找模型配置（兼容字符串和对象格式）
    const modelConfig = provider.models.find(m => {
        // ✅ 兼容字符串格式: "gpt-4o"
        if (typeof m === 'string') {
            return m === selectedModel;
        }
        // ✅ 兼容对象格式: {id: "gpt-4o", name: "GPT-4 Omni", capabilities: {...}}
        if (typeof m === 'object' && m.id) {
            return m.id === selectedModel;
        }
        return false;
    });

    if (!modelConfig) {
        console.warn(`[getCurrentModelCapabilities] 未找到模型配置: ${selectedModel}`);
        return getDefaultCapabilities(provider.apiFormat);
    }

    // ✅ 如果是字符串格式，返回默认能力
    if (typeof modelConfig === 'string') {
        console.log(`[getCurrentModelCapabilities] 模型 ${selectedModel} 使用默认能力（v1格式）`);
        return getDefaultCapabilities(provider.apiFormat);
    }

    // ✅ 返回模型的能力配置（v2格式）
    const capabilities = modelConfig.capabilities || getDefaultCapabilities(provider.apiFormat);
    console.log(`[getCurrentModelCapabilities] 模型 ${selectedModel} 能力:`, capabilities);
    return capabilities;
}

/**
 * 获取默认端点
 * @param {string} apiFormat - API 格式
 * @returns {string} 默认端点 URL
 */
function getDefaultEndpoint(apiFormat) {
    const defaults = {
        openai: 'https://api.openai.com',
        gemini: 'https://generativelanguage.googleapis.com',
        claude: 'https://api.anthropic.com'
    };
    return defaults[apiFormat] || '';
}

/**
 * 获取默认提供商名称
 * @param {string} format - API 格式
 * @returns {string} 默认名称
 */
function getDefaultProviderName(format) {
    const names = {
        openai: 'OpenAI',
        gemini: 'Google Gemini',
        claude: 'Anthropic Claude'
    };
    return names[format] || format;
}

// ========== 模型管理功能 ==========

// 模型缓存 (5分钟有效期)
const modelsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟

/**
 * 添加单个模型到提供商
 * @param {string} providerId - 提供商ID
 * @param {string|Object} modelData - 模型ID（字符串）或模型对象
 * @returns {boolean} 是否添加成功
 */
export function addModelToProvider(providerId, modelData) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return false;

    if (!provider.models) {
        provider.models = [];
    }

    // 规范化为对象格式
    let modelObj;
    if (typeof modelData === 'string') {
        // v1 格式：字符串 → 对象
        modelObj = {
            id: modelData,
            name: modelData,
            capabilities: getDefaultCapabilities(provider.apiFormat)
        };
    } else if (typeof modelData === 'object' && modelData.id) {
        // v2 格式：对象
        modelObj = {
            id: modelData.id,
            name: modelData.name || modelData.id,
            capabilities: modelData.capabilities || getDefaultCapabilities(provider.apiFormat)
        };
    } else {
        console.error('无效的模型数据:', modelData);
        return false;
    }

    // 避免重复添加（兼容字符串和对象格式）
    const exists = provider.models.some(m => {
        const mId = typeof m === 'string' ? m : m.id;
        return mId === modelObj.id;
    });

    if (exists) {
        console.warn(`模型 ${modelObj.id} 已存在于提供商 ${provider.name}`);
        return false;
    }

    provider.models.push(modelObj);
    saveCurrentConfig();
    eventBus.emit('providers:models-changed', { providerId, provider });
    console.log(`✅ 已添加模型 ${modelObj.id} 到提供商 ${provider.name}`);

    return true;
}

/**
 * 从提供商移除模型
 * @param {string} providerId - 提供商ID
 * @param {string} modelId - 模型ID
 * @returns {boolean} 是否删除成功
 */
export function removeModelFromProvider(providerId, modelId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider || !provider.models) return false;

    // ✅ 兼容字符串和对象格式查找
    const index = provider.models.findIndex(m => {
        if (typeof m === 'string') return m === modelId;
        if (typeof m === 'object' && m.id) return m.id === modelId;
        return false;
    });

    if (index === -1) return false;

    provider.models.splice(index, 1);
    saveCurrentConfig();
    eventBus.emit('providers:models-changed', { providerId, provider });
    console.log(`✅ 已移除模型 ${modelId} 从提供商 ${provider.name}`);

    return true;
}

/**
 * 批量添加模型到提供商
 * @param {string} providerId - 提供商ID
 * @param {Array<string|Object>} modelDataList - 模型ID数组或模型对象数组
 * @returns {number} 成功添加的数量
 */
export function addModelsToProvider(providerId, modelDataList) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return 0;

    if (!provider.models) {
        provider.models = [];
    }

    let addedCount = 0;
    modelDataList.forEach(modelData => {
        // 规范化为对象格式
        let modelObj;
        if (typeof modelData === 'string') {
            modelObj = {
                id: modelData,
                name: modelData,
                capabilities: getDefaultCapabilities(provider.apiFormat)
            };
        } else if (typeof modelData === 'object' && modelData.id) {
            modelObj = {
                id: modelData.id,
                name: modelData.name || modelData.id,
                capabilities: modelData.capabilities || getDefaultCapabilities(provider.apiFormat)
            };
        } else {
            console.warn('跳过无效的模型数据:', modelData);
            return;
        }

        // 检查是否已存在（兼容字符串和对象格式）
        const exists = provider.models.some(m => {
            const mId = typeof m === 'string' ? m : m.id;
            return mId === modelObj.id;
        });

        if (!exists) {
            provider.models.push(modelObj);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveCurrentConfig();
        eventBus.emit('providers:models-changed', { providerId, provider });
        console.log(`✅ 批量添加了 ${addedCount} 个模型到提供商 ${provider.name}`);
    }

    return addedCount;
}

/**
 * 从 API 拉取提供商的模型列表（带缓存）
 * @param {string} providerId - 提供商ID
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 * @returns {Promise<string[]>} 模型ID数组
 */
export async function fetchProviderModels(providerId, forceRefresh = false) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) {
        throw new Error(`提供商不存在: ${providerId}`);
    }

    // 检查缓存
    const cached = modelsCache.get(providerId);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`使用缓存的模型列表 (${provider.name})`);
        return cached.models;
    }

    console.log(`从 API 拉取模型列表 (${provider.name})...`);

    // 调用内部函数拉取模型
    const models = await fetchModelsFromAPI(provider);

    // 更新缓存
    modelsCache.set(providerId, { models, timestamp: Date.now() });

    return models;
}

/**
 * 清除提供商的模型缓存
 * @param {string} providerId - 提供商ID
 */
export function clearModelsCache(providerId) {
    if (providerId) {
        modelsCache.delete(providerId);
        console.log(`已清除提供商 ${providerId} 的模型缓存`);
    } else {
        modelsCache.clear();
        console.log('已清除所有模型缓存');
    }
}

/**
 * 内部函数：从 API 拉取模型列表
 * @param {Object} provider - 提供商对象
 * @returns {Promise<Array<Object>>} 模型对象数组（v2格式）
 */
async function fetchModelsFromAPI(provider) {
    const { apiFormat, endpoint, apiKey, geminiApiKeyInHeader } = provider;
    let allModels = [];

    try {
        if (apiFormat === 'gemini') {
            // Gemini API 格式 - 支持分页获取所有模型
            const baseModelsEndpoint = `${endpoint.replace(/\/$/, '')}/v1beta/models`;
            console.log('Fetching Gemini models from:', baseModelsEndpoint);

            let pageToken = null;

            // 循环获取所有分页
            do {
                let modelsEndpoint = baseModelsEndpoint;
                const queryParams = [];

                // 根据配置决定 API key 传递方式
                const headers = {};
                if (geminiApiKeyInHeader) {
                    headers['x-goog-api-key'] = apiKey;
                } else {
                    queryParams.push(`key=${apiKey}`);
                }

                // 添加分页参数
                queryParams.push('pageSize=100');
                if (pageToken) {
                    queryParams.push(`pageToken=${pageToken}`);
                }

                if (queryParams.length > 0) {
                    modelsEndpoint += '?' + queryParams.join('&');
                }

                const response = await fetch(modelsEndpoint, {
                    method: 'GET',
                    headers: headers,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                // Gemini 返回格式: { models: [...], nextPageToken: "..." }
                const models = data.models || [];
                allModels = allModels.concat(models);

                // 获取下一页 token
                pageToken = data.nextPageToken || null;
            } while (pageToken);

            console.log(`Total Gemini models fetched: ${allModels.length}`);

            // 提取模型名称，优先显示支持 generateContent 的模型，返回对象格式（v2）
            return allModels
                .map(m => ({
                    id: m.name.replace('models/', ''),
                    supportsChat: m.supportedGenerationMethods?.includes('generateContent') || false,
                }))
                .sort((a, b) => {
                    // 支持聊天的模型排在前面
                    if (a.supportsChat && !b.supportsChat) return -1;
                    if (!a.supportsChat && b.supportsChat) return 1;
                    return a.id.localeCompare(b.id);
                })
                .map(m => ({
                    id: m.id,
                    name: m.id,
                    capabilities: getDefaultCapabilities('gemini')
                }));
        } else {
            // OpenAI 兼容格式
            // 智能构造 /models 端点
            let modelsEndpoint;
            if (endpoint.includes('/chat/completions')) {
                modelsEndpoint = endpoint.replace('/chat/completions', '/models');
            } else if (endpoint.includes('/v1')) {
                // 如果包含 /v1 但不是 /chat/completions，添加 /models
                modelsEndpoint = endpoint.replace(/\/$/, '') + '/models';
            } else {
                // 默认添加 /v1/models
                modelsEndpoint = endpoint.replace(/\/$/, '') + '/v1/models';
            }

            console.log('Fetching OpenAI models from:', modelsEndpoint);

            const response = await fetch(modelsEndpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // OpenAI 返回格式: { data: [{ id: "gpt-4", ... }] }，返回对象格式（v2）
            const models = data.data || [];
            return models.map(m => ({
                id: m.id,
                name: m.id,
                capabilities: getDefaultCapabilities(apiFormat)
            }));
        }
    } catch (error) {
        console.error(`拉取模型失败 (${provider.name}):`, error);
        throw error;
    }
}

/**
 * ⚠️ 从旧配置迁移到提供商系统 (首次运行)
 * 自动将现有的 apiKeys/endpoints 转换为提供商对象
 */
export function migrateFromLegacyConfig() {
    // 如果已有提供商,跳过迁移
    if (state.providers.length > 0) {
        console.log('✅ 提供商系统已初始化,跳过迁移');
        return;
    }

    console.log('🔄 检测到旧配置,开始迁移到提供商系统...');

    // 保存原始配置作为备份（包括 selectedModel）
    const backup = {
        apiFormat: state.apiFormat,
        endpoints: { ...state.endpoints },
        apiKeys: { ...state.apiKeys },
        customModels: { ...state.customModels },
        geminiApiKeyInHeader: state.geminiApiKeyInHeader,
        selectedModel: elements.modelSelect?.value || state.selectedModel || ''  // ✅ 备份当前选中的模型
    };
    localStorage.setItem('config-backup-pre-migration', JSON.stringify(backup));
    console.log('💾 已备份旧配置到 localStorage.config-backup-pre-migration');

    // 为每个已配置的格式创建提供商
    ['openai', 'gemini', 'claude'].forEach(format => {
        // 如果有 API Key 或端点,说明用户配置过这个格式
        if (state.apiKeys[format] || state.endpoints[format]) {
            // ✅ 智能迁移模型列表
            const models = [];

            // 1. 如果有自定义模型，添加到列表
            if (state.customModels[format]) {
                models.push(state.customModels[format]);
            }

            // 2. 如果是当前格式且有选中的模型，也添加
            if (format === state.apiFormat && backup.selectedModel) {
                const currentModel = backup.selectedModel;
                if (!models.includes(currentModel)) {
                    models.push(currentModel);
                }
            }

            // 3. 如果没有任何模型，添加一个默认模型（确保有内容）
            if (models.length === 0) {
                const defaultModel = format === 'gemini' ? 'gemini-2.0-flash' :
                                    format === 'claude' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o';
                models.push(defaultModel);
            }

            const provider = createProvider({
                name: getDefaultProviderName(format),
                apiFormat: format,
                endpoint: state.endpoints[format] || getDefaultEndpoint(format),
                apiKey: state.apiKeys[format] || '',
                models: models,  // ✅ 迁移模型列表
                geminiApiKeyInHeader: format === 'gemini' ? state.geminiApiKeyInHeader : false
            });

            console.log(`  ✅ 迁移 ${format} → "${provider.name}" (${models.length} 个模型: ${models.join(', ')})`);
        }
    });

    // 如果当前格式没有创建提供商(可能因为没有 API Key),创建一个默认的
    const hasCurrentFormatProvider = state.providers.some(p => p.apiFormat === state.apiFormat);
    if (!hasCurrentFormatProvider && state.apiFormat) {
        const models = [];
        if (state.customModels[state.apiFormat]) {
            models.push(state.customModels[state.apiFormat]);
        }
        if (backup.selectedModel && !models.includes(backup.selectedModel)) {
            models.push(backup.selectedModel);
        }
        if (models.length === 0) {
            const defaultModel = state.apiFormat === 'gemini' ? 'gemini-2.0-flash' :
                                state.apiFormat === 'claude' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o';
            models.push(defaultModel);
        }

        const provider = createProvider({
            name: getDefaultProviderName(state.apiFormat),
            apiFormat: state.apiFormat,
            endpoint: state.endpoints[state.apiFormat] || getDefaultEndpoint(state.apiFormat),
            apiKey: state.apiKeys[state.apiFormat] || '',
            models: models,
            geminiApiKeyInHeader: state.apiFormat === 'gemini' ? state.geminiApiKeyInHeader : false
        });
        console.log(`  ✅ 创建默认提供商 "${provider.name}" (${models.length} 个模型)`);
    }

    console.log(`✅ 迁移完成: 创建了 ${state.providers.length} 个提供商`);
}
