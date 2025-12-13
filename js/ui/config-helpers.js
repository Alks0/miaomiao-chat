/**
 * 配置辅助功能模块
 * 处理三格式端点输入、思维链配置、配置管理等
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { saveCurrentConfig, syncUIWithState } from '../state/config.js';
import { eventBus } from '../core/events.js';
import { syncQuickToggles } from './quick-toggles.js';
import { showNotification } from './notifications.js';
import { showInputDialog, showConfirmDialog } from '../utils/dialogs.js';

/**
 * 初始化三格式端点输入监听
 */
export function initEndpointInputListeners() {
    const formats = ['openai', 'gemini', 'claude'];

    formats.forEach(format => {
        const endpointInput = document.getElementById(`${format}-endpoint`);
        const apikeyInput = document.getElementById(`${format}-apikey`);
        const customModelInput = document.getElementById(`${format}-custom-model`);

        if (endpointInput) {
            endpointInput.addEventListener('input', (e) => {
                state.endpoints[format] = e.target.value;
                saveCurrentConfig();
            });
        }

        if (apikeyInput) {
            apikeyInput.addEventListener('input', (e) => {
                state.apiKeys[format] = e.target.value;
                saveCurrentConfig();
            });
        }

        if (customModelInput) {
            customModelInput.addEventListener('input', (e) => {
                const customModel = e.target.value.trim();
                state.customModels[format] = customModel;

                // ✅ 新逻辑：直接刷新模型列表（从提供商聚合）
                if (format === state.apiFormat) {
                    import('../ui/models.js').then(({ populateModelSelect }) => {
                        populateModelSelect();
                    }).catch(err => console.warn('Failed to refresh model list:', err));
                }

                saveCurrentConfig();
            });
        }
    });

    // 初始化模型参数监听
    initModelParamsListeners();
}

/**
 * 初始化模型参数监听
 */
function initModelParamsListeners() {
    const openaiParams = {
        'openai-temperature': 'temperature',
        'openai-max-tokens': 'max_tokens',
        'openai-top-p': 'top_p',
        'openai-frequency-penalty': 'frequency_penalty',
        'openai-presence-penalty': 'presence_penalty'
    };

    const geminiParams = {
        'gemini-temperature': 'temperature',
        'gemini-max-output-tokens': 'maxOutputTokens',
        'gemini-top-p': 'topP',
        'gemini-top-k': 'topK'
    };

    const claudeParams = {
        'claude-temperature': 'temperature',
        'claude-max-tokens': 'max_tokens',
        'claude-top-p': 'top_p',
        'claude-top-k': 'top_k'
    };

    setupParamListeners('openai', openaiParams);
    setupParamListeners('gemini', geminiParams);
    setupParamListeners('claude', claudeParams);
}

function setupParamListeners(format, paramsMap) {
    Object.entries(paramsMap).forEach(([inputId, paramKey]) => {
        const input = document.getElementById(inputId);
        if (input) {
            // 初始化值
            const currentValue = state.modelParams[format][paramKey];
            if (currentValue !== null && currentValue !== undefined) {
                input.value = currentValue;
            }

            input.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                if (value === '') {
                    state.modelParams[format][paramKey] = null;
                } else {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        state.modelParams[format][paramKey] = numValue;
                    }
                }
                saveCurrentConfig();
            });
        }
    });
}

/**
 * 初始化思维链配置控件
 */
export function initThinkingControls() {
    const thinkingEnabled = document.getElementById('thinking-enabled');
    const thinkingStrengthGroup = document.getElementById('thinking-strength-group');
    const thinkingHint = document.getElementById('thinking-hint');
    const strengthBtns = document.querySelectorAll('.strength-btn');
    const budgetGroup = document.getElementById('thinking-budget-group');
    const budgetInput = document.getElementById('thinking-budget');

    function updateBudgetInputVisibility() {
        if (budgetGroup) {
            const showBudget = state.thinkingEnabled && state.thinkingStrength === 'custom';
            budgetGroup.style.display = showBudget ? 'flex' : 'none';
        }
    }

    if (thinkingEnabled) {
        thinkingEnabled.checked = state.thinkingEnabled;
        if (thinkingStrengthGroup) {
            thinkingStrengthGroup.style.display = state.thinkingEnabled ? 'flex' : 'none';
        }
        if (thinkingHint) {
            thinkingHint.style.display = state.thinkingEnabled ? 'block' : 'none';
        }
        updateBudgetInputVisibility();

        thinkingEnabled.addEventListener('change', (e) => {
            state.thinkingEnabled = e.target.checked;
            if (thinkingStrengthGroup) {
                thinkingStrengthGroup.style.display = e.target.checked ? 'flex' : 'none';
            }
            if (thinkingHint) {
                thinkingHint.style.display = e.target.checked ? 'block' : 'none';
            }
            updateBudgetInputVisibility();
            syncQuickToggles();
            saveCurrentConfig();
        });
    }

    if (budgetInput) {
        budgetInput.value = state.thinkingBudget;
        budgetInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value, 10);
            if (value >= 1024 && value <= 131072) {
                state.thinkingBudget = value;
                saveCurrentConfig();
            } else {
                e.target.value = state.thinkingBudget;
                showNotification('Token 预算范围: 1024 - 131072', 'warning');
            }
        });
    }

    strengthBtns.forEach(btn => {
        if (btn.dataset.strength === state.thinkingStrength) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            state.thinkingStrength = btn.dataset.strength;
            strengthBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateBudgetInputVisibility();
            saveCurrentConfig();
        });
    });
}

/**
 * 处理配置选择
 */
function handleConfigSelect() {
    const index = elements.configSelect.value;
    if (index === '') return;

    const config = state.savedConfigs[parseInt(index)];
    if (!config) return;

    state.currentConfigName = config.name;

    // 应用配置（所有字段）
    if (config.imageSize !== undefined) state.imageSize = config.imageSize;
    if (config.replyCount !== undefined) state.replyCount = config.replyCount;
    if (config.streamEnabled !== undefined) state.streamEnabled = config.streamEnabled;
    if (config.thinkingEnabled !== undefined) state.thinkingEnabled = config.thinkingEnabled;
    if (config.thinkingStrength !== undefined) state.thinkingStrength = config.thinkingStrength;
    if (config.thinkingBudget !== undefined) state.thinkingBudget = config.thinkingBudget;
    if (config.webSearchEnabled !== undefined) state.webSearchEnabled = config.webSearchEnabled;

    if (config.endpoints) state.endpoints = { ...config.endpoints };
    if (config.apiKeys) state.apiKeys = { ...config.apiKeys };
    if (config.customModels) state.customModels = { ...config.customModels };

    if (config.modelParams) {
        ['openai', 'gemini', 'claude'].forEach(format => {
            if (config.modelParams[format]) {
                state.modelParams[format] = { ...state.modelParams[format], ...config.modelParams[format] };
            }
        });
    }

    if (config.customHeaders) state.customHeaders = [...config.customHeaders];
    if (config.prefillEnabled !== undefined) state.prefillEnabled = config.prefillEnabled;
    if (config.systemPrompt !== undefined) state.systemPrompt = config.systemPrompt;
    if (config.prefillMessages) state.prefillMessages = JSON.parse(JSON.stringify(config.prefillMessages));
    if (config.charName !== undefined) state.charName = config.charName;
    if (config.userName !== undefined) state.userName = config.userName;

    if (config.apiFormat) {
        // 通过事件发送格式切换请求，避免循环依赖
        eventBus.emit('config:format-change-requested', { format: config.apiFormat, shouldFetchModels: false });
    }

    saveCurrentConfig();

    // 同步 UI 状态
    syncUIWithState();

    // 通过事件请求获取模型
    eventBus.emit('models:fetch-requested', { forceRefresh: false });

    showNotification(`已切换到配置: ${config.name}`, 'info');
}

/**
 * 处理保存配置
 */
async function handleSaveConfig() {
    const name = await showInputDialog(
        '请输入配置名称:',
        state.currentConfigName || '新配置',
        '保存配置'
    );
    if (!name) return;

    const config = {
        name: name,
        apiEndpoint: elements.apiEndpoint.value,
        apiKey: elements.apiKey.value,
        selectedModel: elements.modelSelect.value,
        apiFormat: state.apiFormat,
        imageSize: state.imageSize,
        replyCount: state.replyCount,
        streamEnabled: state.streamEnabled,
        thinkingEnabled: state.thinkingEnabled,
        thinkingStrength: state.thinkingStrength,
        thinkingBudget: state.thinkingBudget,
        webSearchEnabled: state.webSearchEnabled,
        endpoints: { ...state.endpoints },
        apiKeys: { ...state.apiKeys },
        customModels: { ...state.customModels },
        modelParams: {
            openai: { ...state.modelParams.openai },
            gemini: { ...state.modelParams.gemini },
            claude: { ...state.modelParams.claude }
        },
        customHeaders: [...state.customHeaders],
        prefillEnabled: state.prefillEnabled,
        systemPrompt: state.systemPrompt,
        prefillMessages: JSON.parse(JSON.stringify(state.prefillMessages)),
        charName: state.charName,
        userName: state.userName
    };

    const existingIndex = state.savedConfigs.findIndex(c => c.name === name);
    if (existingIndex >= 0) {
        state.savedConfigs[existingIndex] = config;
    } else {
        state.savedConfigs.push(config);
    }

    state.currentConfigName = name;
    saveCurrentConfig();
    updateConfigSelect();
    showNotification(`配置已保存: ${name}`, 'info');
}

/**
 * 处理删除配置
 */
async function handleDeleteConfig() {
    const index = elements.configSelect.value;
    if (index === '') {
        showNotification('请先选择要删除的配置', 'warning');
        return;
    }

    const config = state.savedConfigs[parseInt(index)];
    if (!config) return;

    const confirmed = await showConfirmDialog(
        `确定删除配置 "${config.name}" 吗？`,
        '确认删除'
    );
    if (!confirmed) return;

    state.savedConfigs.splice(parseInt(index), 1);
    if (state.currentConfigName === config.name) {
        state.currentConfigName = '';
    }

    saveCurrentConfig();
    updateConfigSelect();
    showNotification(`已删除配置: ${config.name}`, 'info');
}

/**
 * 更新配置下拉框
 */
function updateConfigSelect() {
    if (!elements.configSelect) return;

    elements.configSelect.innerHTML = '<option value="">选择配置...</option>';
    state.savedConfigs.forEach((config, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = config.name;
        if (config.name === state.currentConfigName) {
            option.selected = true;
        }
        elements.configSelect.appendChild(option);
    });
}

/**
 * 初始化配置管理
 */
export function initConfigManagement() {
    // 绑定配置选择
    elements.configSelect?.addEventListener('change', handleConfigSelect);
    elements.saveConfig?.addEventListener('click', handleSaveConfig);
    elements.deleteConfig?.addEventListener('click', handleDeleteConfig);

    // 初始化下拉框
    updateConfigSelect();

    console.log('Config management initialized');
}

/**
 * 初始化其他配置项
 */
export function initOtherConfigInputs() {
    // Gemini 图片大小
    elements.imageSizeSelect?.addEventListener('change', (e) => {
        state.imageSize = e.target.value;
        saveCurrentConfig();
    });

    // Gemini API Key 传递方式
    elements.geminiApiKeyInHeaderToggle?.addEventListener('change', (e) => {
        state.geminiApiKeyInHeader = e.target.checked;
        saveCurrentConfig();
    });

    // 流式开关（设置面板）
    const streamEnabled = document.getElementById('stream-enabled');
    if (streamEnabled) {
        streamEnabled.checked = state.streamEnabled;
        streamEnabled.addEventListener('change', (e) => {
            state.streamEnabled = e.target.checked;
            syncQuickToggles();
            saveCurrentConfig();
        });
    }

    // 网络搜索开关（设置面板）
    const webSearchEnabled = document.getElementById('web-search-enabled');
    if (webSearchEnabled) {
        webSearchEnabled.checked = state.webSearchEnabled;
        webSearchEnabled.addEventListener('change', (e) => {
            state.webSearchEnabled = e.target.checked;
            syncQuickToggles();
            saveCurrentConfig();
        });
    }

    // 多回复数量
    elements.replyCountSelect?.addEventListener('change', (e) => {
        state.replyCount = parseInt(e.target.value, 10);
        saveCurrentConfig();
    });

    // ⭐ 新增：思维链 None 模式
    if (elements.thinkingNoneMode) {
        elements.thinkingNoneMode.checked = state.thinkingNoneMode || false;
        elements.thinkingNoneMode.addEventListener('change', (e) => {
            state.thinkingNoneMode = e.target.checked;
            saveCurrentConfig();
        });
    }

    // ⭐ 新增：输出详细度开关和选择器
    const verbosityEnabled = elements.verbosityEnabled;
    const outputVerbosity = elements.outputVerbosity;
    const verbositySelectGroup = document.getElementById('verbosity-select-group');

    if (verbosityEnabled && outputVerbosity && verbositySelectGroup) {
        // 初始化状态
        verbosityEnabled.checked = state.verbosityEnabled || false;
        outputVerbosity.value = state.outputVerbosity || 'medium';
        verbositySelectGroup.style.display = state.verbosityEnabled ? 'block' : 'none';

        // 开关监听
        verbosityEnabled.addEventListener('change', (e) => {
            state.verbosityEnabled = e.target.checked;
            verbositySelectGroup.style.display = e.target.checked ? 'block' : 'none';
            saveCurrentConfig();
        });

        // 选择器监听
        outputVerbosity.addEventListener('change', (e) => {
            state.outputVerbosity = e.target.value;
            saveCurrentConfig();
        });
    }

    console.log('Other config inputs initialized');
}
