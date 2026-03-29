/**
 * 模型列表聚合功能
 * 从提供商的 models 数组聚合生成模型下拉列表
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { saveCurrentConfig } from '../state/config.js';
import { eventBus } from '../core/events.js';
import { renderCapabilityBadgesText } from '../utils/capability-badges.js';
import { updateMobileHeaderTitle } from './mobile-overflow-menu.js';

/**
 * 填充模型下拉列表（从提供商聚合）
 */
export function populateModelSelect() {
    if (!elements.modelSelect) return;

    const enabledProviders = state.providers.filter(p => p.enabled);

    // 清空下拉列表
    elements.modelSelect.innerHTML = '';

    if (enabledProviders.length === 0) {
        // 没有启用的提供商
        const option = document.createElement('option');
        option.textContent = '请先在提供商管理中启用并添加模型';
        option.disabled = true;
        elements.modelSelect.appendChild(option);
        console.warn('No enabled providers');
        return;
    }

    let hasAnyModels = false;

    // 遍历所有启用的提供商
    enabledProviders.forEach(provider => {
        if (provider.models && provider.models.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = provider.name;

            provider.models.forEach(model => {
                // 支持对象和字符串格式
                const modelId = typeof model === 'string' ? model : model.id;
                const modelName = typeof model === 'string' ? model : (model.name || model.id);
                const capabilities = typeof model === 'object' ? model.capabilities : null;

                const option = document.createElement('option');
                option.value = modelId;
                option.dataset.providerId = provider.id;  // 存储提供商 ID

                // 添加能力标签（纯文本格式）
                const badgesText = renderCapabilityBadgesText(capabilities);
                option.textContent = modelName + badgesText;

                // 如果是当前选中的模型，标记为 selected
                if (modelId === state.selectedModel) {
                    option.selected = true;
                }

                optgroup.appendChild(option);
            });

            elements.modelSelect.appendChild(optgroup);
            hasAnyModels = true;
        }
    });

    if (!hasAnyModels) {
        // 有启用的提供商，但都没有模型
        const option = document.createElement('option');
        option.textContent = '请在提供商管理中添加模型';
        option.disabled = true;
        elements.modelSelect.appendChild(option);
        console.warn('Enabled providers have no models');
        return;
    }

    console.log(`模型列表已更新 (${enabledProviders.length} 个提供商)`);

    // 更新移动端标题栏
    const selectedOption = elements.modelSelect.selectedOptions[0];
    if (selectedOption) {
        const modelName = typeof selectedOption.value === 'string' ? selectedOption.value : '';
        updateMobileHeaderTitle(modelName.split('/').pop() || modelName);
    }
}

/**
 * 初始化模型列表功能
 */
export function initModels() {
    // 监听提供商变更事件，重新聚合模型列表
    eventBus.on('providers:updated', populateModelSelect);
    eventBus.on('providers:switched', populateModelSelect);
    eventBus.on('providers:models-changed', populateModelSelect);

    // 监听下拉列表变化，保存到 state.selectedModel 并同步 apiFormat
    elements.modelSelect?.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        const selectedOption = e.target.selectedOptions[0];
        const providerId = selectedOption?.dataset.providerId;

        state.selectedModel = selectedModel;

        // 根据 providerId 查找提供商（而不是模型名）
        const provider = state.providers.find(p => p.id === providerId);

        if (provider && provider.apiFormat !== state.apiFormat) {
            console.log(`🔄 模型切换: ${selectedModel} (${provider.name}) -> 自动切换到 ${provider.apiFormat} 格式`);

            // 更新 apiFormat (不触发格式切换事件,避免重复刷新模型列表)
            state.apiFormat = provider.apiFormat;

            // 显示/隐藏对应的配置面板：只显示当前格式对应的配置面板
            document.querySelectorAll('.api-config').forEach(panel => {
                panel.style.display = 'none';
            });
            const configPanel = document.getElementById(`${provider.apiFormat}-config`);
            if (configPanel) {
                configPanel.style.display = 'block';
            }

            // 发送通知
            eventBus.emit('ui:notification', {
                message: `已切换到 ${provider.apiFormat.toUpperCase()} 格式`,
                type: 'info',
                duration: 2000
            });
        }

        // 存储当前提供商 ID，供 getCurrentProvider() 使用
        state.currentProviderId = providerId;

        // 同步 provider 的 geminiApiKeyInHeader 到 state（用于 API 请求）
        if (provider && provider.apiFormat === 'gemini') {
            state.geminiApiKeyInHeader = provider.geminiApiKeyInHeader || false;
            console.log(`🔄 同步 geminiApiKeyInHeader: ${state.geminiApiKeyInHeader}`);
        }

        saveCurrentConfig();
        console.log(`Model selected: ${selectedModel} from ${provider?.name || 'unknown'} (format: ${state.apiFormat})`);

        // 更新移动端标题栏
        updateMobileHeaderTitle(selectedModel.split('/').pop() || selectedModel);
    });

    // 初始填充
    populateModelSelect();

    console.log('Models list initialized (aggregated from providers)');
}
