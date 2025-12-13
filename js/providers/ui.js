/**
 * 提供商管理 UI 控制器（左右分栏版本）
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import {
    createProvider,
    updateProvider,
    deleteProvider,
    addModelToProvider,
    removeModelFromProvider,
    addModelsToProvider,
    fetchProviderModels
} from './manager.js';
import { renderCapabilityBadges } from '../utils/capability-badges.js';
import { showInputDialog, showConfirmDialog } from '../utils/dialogs.js';

// 当前选中的提供商ID
let selectedProviderId = null;

/**
 * 初始化提供商 UI
 */
export function initProvidersUI() {
    // 打开模态框
    elements.providersToggle?.addEventListener('click', openProvidersModal);

    // 关闭模态框
    elements.closeProvidersModal?.addEventListener('click', closeProvidersModal);
    elements.providersModal?.querySelector('.modal-overlay')?.addEventListener('click', closeProvidersModal);

    // 搜索
    elements.providersSearchInput?.addEventListener('input', renderProvidersList);

    // 添加按钮
    elements.addProviderBtn?.addEventListener('click', () => {
        showProviderForm(null); // null = 新建模式
    });

    // 监听提供商变更事件
    eventBus.on('providers:added', () => {
        renderProvidersList();
    });

    eventBus.on('providers:updated', () => {
        renderProvidersList();
        // 如果更新的是当前选中的，重新渲染表单
        if (selectedProviderId) {
            showProviderForm(selectedProviderId);
        }
    });

    eventBus.on('providers:deleted', ({ id }) => {
        renderProvidersList();
        // 如果删除的是当前选中的，清空右侧
        if (selectedProviderId === id) {
            selectedProviderId = null;
            showEmptyState();
        }
    });

    eventBus.on('providers:switched', () => {
        renderProvidersList(); // 更新 ON 状态
    });

    // 模型编辑弹窗事件
    document.getElementById('close-edit-model')?.addEventListener('click', closeEditModelModal);
    document.getElementById('cancel-edit-model')?.addEventListener('click', closeEditModelModal);
    document.getElementById('save-edit-model')?.addEventListener('click', saveEditedModel);
    document.getElementById('edit-model-modal')?.querySelector('.modal-overlay')?.addEventListener('click', closeEditModelModal);

    console.log('Providers UI initialized (split layout)');
}

/**
 * 打开提供商模态框
 */
function openProvidersModal() {
    elements.providersModal?.classList.add('active');
    renderProvidersList();

    // 如果有提供商，自动选中第一个启用的，否则选中第一个
    if (state.providers.length > 0) {
        const firstEnabled = state.providers.find(p => p.enabled);
        selectedProviderId = firstEnabled ? firstEnabled.id : state.providers[0].id;
        showProviderForm(selectedProviderId);
    } else {
        showEmptyState();
    }
}

/**
 * 关闭提供商模态框
 */
function closeProvidersModal() {
    elements.providersModal?.classList.remove('active');
    selectedProviderId = null;
}

/**
 * 渲染左侧提供商列表
 */
function renderProvidersList() {
    const container = elements.providersList;
    if (!container) return;

    const searchQuery = elements.providersSearchInput?.value.toLowerCase() || '';

    // 过滤提供商
    let providers = state.providers;
    if (searchQuery) {
        providers = providers.filter(p =>
            p.name.toLowerCase().includes(searchQuery) ||
            p.apiFormat.toLowerCase().includes(searchQuery)
        );
    }

    if (providers.length === 0) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p>暂无提供商</p>
            </div>
        `;
        return;
    }

    // 渲染列表项
    container.innerHTML = providers.map(provider => renderProviderItem(provider)).join('');

    // 绑定点击事件（选择提供商）
    container.querySelectorAll('.provider-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // 如果点击的是开关按钮，不触发选择
            if (e.target.closest('.provider-toggle-btn')) return;

            const id = item.dataset.providerId;
            selectedProviderId = id;
            renderProvidersList(); // 更新选中状态
            showProviderForm(id);
        });
    });

    // 绑定开关按钮事件
    container.querySelectorAll('.provider-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止触发 item 点击
            const id = btn.dataset.providerId;
            toggleProviderEnabled(id);
        });
    });
}

/**
 * 渲染单个提供商项（左侧列表）
 * @param {Object} provider - 提供商对象
 * @returns {string} HTML 字符串
 */
function renderProviderItem(provider) {
    const isSelected = provider.id === selectedProviderId;
    const formatLabels = {
        openai: 'OpenAI',
        'openai-responses': 'OpenAI Responses',  // ⭐ 新增
        gemini: 'Gemini',
        claude: 'Claude'
    };

    return `
        <div class="provider-item ${isSelected ? 'selected' : ''}"
             data-provider-id="${provider.id}">
            <div class="provider-item-avatar ${provider.apiFormat}">
                ${provider.name.charAt(0).toUpperCase()}
            </div>
            <div class="provider-item-info">
                <div class="provider-item-name">${escapeHtml(provider.name)}</div>
                <div class="provider-item-format">${formatLabels[provider.apiFormat]}</div>
            </div>
            <button class="provider-toggle-btn" data-provider-id="${provider.id}" title="${provider.enabled ? '禁用（不显示模型）' : '启用（显示模型）'}">
                <div class="toggle-switch ${provider.enabled ? 'on' : 'off'}">
                    <span class="toggle-label">${provider.enabled ? 'ON' : 'OFF'}</span>
                </div>
            </button>
        </div>
    `;
}

/**
 * 显示右侧空状态
 */
function showEmptyState() {
    const container = document.getElementById('provider-detail-content');
    if (!container) return;

    container.innerHTML = `
        <div class="empty-detail">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <p>选择或添加一个提供商</p>
        </div>
    `;
}

/**
 * 显示右侧提供商表单
 * @param {string|null} providerId - 提供商ID，null表示新建
 */
function showProviderForm(providerId) {
    const container = document.getElementById('provider-detail-content');
    if (!container) return;

    const provider = providerId ? state.providers.find(p => p.id === providerId) : null;
    const isEdit = !!provider;

    container.innerHTML = `
        <form class="provider-form" id="provider-detail-form">
            ${isEdit ? `
                <div class="form-group provider-enable-toggle">
                    <div class="toggle-container">
                        <label class="toggle-switch-modern">
                            <input type="checkbox" id="detail-provider-enabled" ${provider.enabled ? 'checked' : ''} />
                            <span class="toggle-slider"></span>
                        </label>
                        <div class="toggle-label-group">
                            <label for="detail-provider-enabled" class="toggle-title">在模型列表中显示此提供商的模型</label>
                            <p class="toggle-hint">启用后，该提供商的模型会出现在设置面板的模型下拉列表中</p>
                        </div>
                    </div>
                </div>
            ` : ''}

            <div class="form-group">
                <label for="detail-provider-name">提供商名称 *</label>
                <input type="text" id="detail-provider-name" value="${provider ? escapeHtml(provider.name) : ''}"
                       placeholder="例如 OpenAI GPT-4" required />
            </div>

            <div class="form-group">
                <label for="detail-provider-format">API 格式 *</label>
                <select id="detail-provider-format" required ${isEdit ? 'disabled' : ''}>
                    <option value="openai" ${provider?.apiFormat === 'openai' ? 'selected' : ''}>OpenAI (Chat Completions)</option>
                    <option value="openai-responses" ${provider?.apiFormat === 'openai-responses' ? 'selected' : ''}>OpenAI (Responses API)</option>
                    <option value="gemini" ${provider?.apiFormat === 'gemini' ? 'selected' : ''}>Gemini</option>
                    <option value="claude" ${provider?.apiFormat === 'claude' ? 'selected' : ''}>Claude</option>
                </select>
                ${isEdit ? '<p class="form-hint">保存后不可修改</p>' : ''}
            </div>

            <div class="form-group">
                <label for="detail-provider-endpoint">API 地址</label>
                <input type="text" id="detail-provider-endpoint" value="${provider ? escapeHtml(provider.endpoint) : ''}"
                       placeholder="留空使用默认地址" />
                <p class="form-hint endpoint-hint" id="endpoint-hint-text"></p>
            </div>

            <div class="form-group">
                <label for="detail-provider-apikey">API 密钥</label>
                <div class="password-input-wrapper">
                    <input type="password" id="detail-provider-apikey" value="${provider?.apiKey || ''}"
                           placeholder="sk-..." />
                    <button type="button" class="password-toggle-btn" id="toggle-apikey-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div class="form-group gemini-only" style="display: ${provider?.apiFormat === 'gemini' || !provider ? 'block' : 'none'};">
                <div class="form-group-inline">
                    <input type="checkbox" id="detail-provider-gemini-header"
                           ${provider?.geminiApiKeyInHeader ? 'checked' : ''} />
                    <label for="detail-provider-gemini-header">通过请求头传递 API Key</label>
                </div>
                <p class="form-hint">启用后使用 x-goog-api-key 请求头（适用于代理）</p>
            </div>

            <div class="form-group">
                <label for="detail-provider-custom-model">自定义模型（可选）</label>
                <input type="text" id="detail-provider-custom-model" value="${provider?.customModel || ''}"
                       placeholder="gpt-4o, gemini-2.0-flash-exp" />
            </div>

            ${isEdit ? `
                <div class="form-group">
                    <label>已添加模型 (${provider.models?.length || 0})</label>
                    <div class="provider-models-list">
                        ${provider.models && provider.models.length > 0 ?
                            provider.models.map(m => {
                                // 兼容字符串和对象格式
                                const modelId = typeof m === 'string' ? m : m.id;
                                const modelName = typeof m === 'string' ? m : (m.name || m.id);
                                const capabilities = typeof m === 'object' ? m.capabilities : null;

                                // 生成能力徽章 HTML
                                const badges = renderCapabilityBadges(capabilities);

                                return `
                                    <div class="model-chip">
                                        <span class="model-chip-name">${escapeHtml(modelName)}${badges}</span>
                                        <button class="edit-model-btn" data-model-id="${escapeHtml(modelId)}" type="button" title="编辑模型">...</button>
                                        <button class="remove-model-btn" data-model="${escapeHtml(modelId)}" type="button" title="删除模型">×</button>
                                    </div>
                                `;
                            }).join('') :
                            '<p class="empty-models">暂无模型，点击下方按钮添加</p>'
                        }
                    </div>
                    <div class="models-actions">
                        <button type="button" id="manage-models-btn" class="btn-secondary">... 管理模型</button>
                        <button type="button" id="add-custom-model-btn" class="btn-secondary">+ 添加自定义</button>
                    </div>
                    <p class="form-hint">只有添加的模型会出现在设置面板的模型下拉列表中</p>
                </div>
            ` : ''}
        </form>

        <div class="detail-footer">
            ${isEdit ? `
                <button type="button" class="btn-danger" id="delete-provider-btn">删除</button>
            ` : ''}
            <button type="button" class="btn-secondary" id="cancel-form-btn">取消</button>
            <button type="button" class="btn-primary" id="save-provider-btn">保存</button>
        </div>
    `;

    // 绑定事件
    bindFormEvents(providerId);
}

/**
 * 绑定表单事件
 * @param {string|null} providerId - 提供商ID，null表示新建
 */
function bindFormEvents(providerId) {
    const isEdit = !!providerId;

    // 保存按钮
    document.getElementById('save-provider-btn')?.addEventListener('click', () => {
        saveProviderForm(providerId);
    });

    // 取消按钮
    document.getElementById('cancel-form-btn')?.addEventListener('click', () => {
        if (isEdit) {
            showProviderForm(providerId); // 重置表单
        } else {
            showEmptyState();
            selectedProviderId = null;
            renderProvidersList();
        }
    });

    // 删除按钮
    document.getElementById('delete-provider-btn')?.addEventListener('click', async () => {
        const provider = state.providers.find(p => p.id === providerId);
        if (!provider) return;

        const confirmed = await showConfirmDialog(
            `确定删除提供商 "${provider.name}"？`,
            '确认删除'
        );
        if (confirmed) {
            deleteProvider(providerId);
        }
    });

    // 密码显示切换
    document.getElementById('toggle-apikey-btn')?.addEventListener('click', () => {
        const input = document.getElementById('detail-provider-apikey');
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    });

    // API格式切换时显示/隐藏Gemini选项和更新端点提示
    document.getElementById('detail-provider-format')?.addEventListener('change', (e) => {
        const apiFormat = e.target.value;
        const geminiOnly = document.querySelector('.gemini-only');
        if (geminiOnly) {
            geminiOnly.style.display = apiFormat === 'gemini' ? 'block' : 'none';
        }
        updateEndpointHint(apiFormat);
    });

    // 初始化端点提示
    const initialFormat = document.getElementById('detail-provider-format')?.value;
    if (initialFormat) {
        updateEndpointHint(initialFormat);
    }

    // 端点输入框失焦时自动补全
    document.getElementById('detail-provider-endpoint')?.addEventListener('blur', (e) => {
        const input = e.target;
        const apiFormat = document.getElementById('detail-provider-format')?.value;
        if (!input.value.trim() || !apiFormat) return;

        const autocompleted = autoCompleteEndpoint(input.value.trim(), apiFormat);
        if (autocompleted !== input.value) {
            input.value = autocompleted;
            // 显示自动补全提示
            const hint = document.getElementById('endpoint-hint-text');
            if (hint) {
                hint.textContent = '✓ 已自动补全端点格式';
                hint.style.color = 'var(--md-green)';
                setTimeout(() => {
                    updateEndpointHint(apiFormat);
                }, 2000);
            }
        }
    });

    // 模型管理按钮（仅编辑模式）
    if (isEdit) {
        // 管理模型按钮
        document.getElementById('manage-models-btn')?.addEventListener('click', () => {
            showModelsManageModal(providerId);
        });

        // 添加自定义模型按钮
        document.getElementById('add-custom-model-btn')?.addEventListener('click', () => {
            showAddCustomModelDialog(providerId);
        });

        // 删除模型按钮（使用事件委托）
        document.querySelectorAll('.remove-model-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const modelId = btn.dataset.model;
                const confirmed = await showConfirmDialog(
                    `确定移除模型 "${modelId}"？`,
                    '确认移除'
                );
                if (confirmed) {
                    removeModelFromProvider(providerId, modelId);
                    showProviderForm(providerId); // 刷新表单
                }
            });
        });

        // 编辑模型按钮（使用事件委托）
        document.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const modelId = btn.dataset.modelId;
                openEditModelModal(providerId, modelId);
            });
        });
    }
}

/**
 * 保存提供商表单
 * @param {string|null} providerId - 提供商ID，null表示新建
 */
function saveProviderForm(providerId) {
    const name = document.getElementById('detail-provider-name')?.value.trim();
    const apiFormat = document.getElementById('detail-provider-format')?.value;
    const endpoint = document.getElementById('detail-provider-endpoint')?.value.trim();
    const apiKey = document.getElementById('detail-provider-apikey')?.value.trim();
    const customModel = document.getElementById('detail-provider-custom-model')?.value.trim();
    const geminiApiKeyInHeader = document.getElementById('detail-provider-gemini-header')?.checked || false;
    const enabled = document.getElementById('detail-provider-enabled')?.checked ?? true; // 新建默认启用

    if (!name) {
        alert('请输入提供商名称');
        return;
    }

    if (!apiFormat) {
        alert('请选择API格式');
        return;
    }

    // 自动补全端点格式（如果用户填写了端点）
    const finalEndpoint = endpoint ? autoCompleteEndpoint(endpoint, apiFormat) : endpoint;

    const data = {
        name,
        apiFormat,
        endpoint: finalEndpoint,
        apiKey,
        customModel,
        geminiApiKeyInHeader,
        enabled
    };

    if (providerId) {
        // 更新
        updateProvider(providerId, data);
        eventBus.emit('ui:notification', { message: '提供商已更新', type: 'success' });
    } else {
        // 新建
        const provider = createProvider(data);
        selectedProviderId = provider.id;
        renderProvidersList();
        showProviderForm(provider.id);
        eventBus.emit('ui:notification', { message: '提供商已创建', type: 'success' });
    }
}

/**
 * 切换提供商启用状态
 * @param {string} providerId - 提供商ID
 */
function toggleProviderEnabled(providerId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    provider.enabled = !provider.enabled;
    updateProvider(providerId, { enabled: provider.enabled });

    // 更新列表显示
    renderProvidersList();

    // 如果是当前选中的，更新表单
    if (selectedProviderId === providerId) {
        showProviderForm(providerId);
    }

    eventBus.emit('ui:notification', {
        message: `${provider.name} 已${provider.enabled ? '启用' : '禁用'}`,
        type: 'success'
    });
}

/**
 * HTML转义
 * @param {string} text - 文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== 模型管理弹窗 ==========

/**
 * 打开模型管理弹窗（第三层）
 * @param {string} providerId - 提供商ID
 */
async function showModelsManageModal(providerId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    const modal = document.getElementById('models-manage-modal');
    const title = document.getElementById('models-manage-title');
    const loading = document.getElementById('models-loading');
    const checklist = document.getElementById('models-checklist');

    if (!modal || !loading || !checklist) return;

    // 打开模态框
    modal.classList.add('active');
    title.textContent = `从 API 添加模型 - ${provider.name}`;

    // 显示加载状态
    loading.style.display = 'flex';
    checklist.innerHTML = '';

    try {
        // 拉取模型列表（带缓存）
        const allModels = await fetchProviderModels(providerId);

        // 隐藏加载状态
        loading.style.display = 'none';

        // 渲染复选框列表
        renderModelsChecklist(providerId, allModels);

        // 绑定模型管理弹窗事件
        bindModelsManageEvents(providerId);

    } catch (error) {
        loading.style.display = 'none';
        checklist.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-error);">
                <p>拉取模型失败: ${escapeHtml(error.message)}</p>
                <button type="button" class="btn-secondary" id="retry-fetch-models">重试</button>
            </div>
        `;

        // 绑定关闭按钮（确保即使失败也能关闭窗口）
        const closeHandler = () => {
            modal.classList.remove('active');
            // 移除 ESC 键监听器
            if (modal._escHandler) {
                document.removeEventListener('keydown', modal._escHandler);
                modal._escHandler = null;
            }
        };

        // ESC 键关闭（WCAG 2.1.1）
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeHandler();
            }
        };
        // 移除旧的 ESC 监听器（如果存在）
        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
        }
        document.addEventListener('keydown', escHandler);
        modal._escHandler = escHandler;

        const closeBtn = document.getElementById('close-models-manage');
        const cancelBtn = document.getElementById('cancel-models-manage');

        closeBtn?.replaceWith(closeBtn.cloneNode(true));
        document.getElementById('close-models-manage')?.addEventListener('click', closeHandler);
        cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
        document.getElementById('cancel-models-manage')?.addEventListener('click', closeHandler);

        // 重试按钮
        document.getElementById('retry-fetch-models')?.addEventListener('click', () => {
            showModelsManageModal(providerId);
        });
    }
}

/**
 * 渲染模型复选框列表
 * @param {string} providerId - 提供商ID
 * @param {string[]} allModels - 所有可用模型
 */
function renderModelsChecklist(providerId, allModels) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    const checklist = document.getElementById('models-checklist');
    const searchInput = document.getElementById('models-search-input');
    const bulkActions = document.getElementById('models-bulk-actions');

    if (!checklist) return;

    const searchQuery = searchInput?.value.toLowerCase() || '';

    // ✅ 过滤模型（支持对象格式）
    const filteredModels = searchQuery
        ? allModels.filter(m => {
            const modelId = typeof m === 'string' ? m : m.id;
            const modelName = typeof m === 'string' ? m : (m.name || m.id);
            return modelId.toLowerCase().includes(searchQuery) ||
                   modelName.toLowerCase().includes(searchQuery);
        })
        : allModels;

    if (filteredModels.length === 0) {
        checklist.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                <p>没有找到匹配的模型</p>
            </div>
        `;
        // 隐藏全选/反选按钮
        if (bulkActions) bulkActions.style.display = 'none';
        return;
    }

    // 显示全选/反选按钮
    if (bulkActions) bulkActions.style.display = 'flex';

    // ✅ 渲染复选框列表（支持对象格式）
    checklist.innerHTML = filteredModels.map(model => {
        const modelId = typeof model === 'string' ? model : model.id;
        const modelName = typeof model === 'string' ? model : (model.name || model.id);

        // 检查是否已选中（兼容字符串和对象格式）
        const isChecked = provider.models?.some(m => {
            const existingId = typeof m === 'string' ? m : m.id;
            return existingId === modelId;
        }) || false;

        return `
            <div class="model-checkbox-item">
                <input type="checkbox" id="model-${escapeHtml(modelId)}" value="${escapeHtml(modelId)}"
                       ${isChecked ? 'checked' : ''} />
                <label for="model-${escapeHtml(modelId)}">${escapeHtml(modelName)}</label>
            </div>
        `;
    }).join('');

    // 更新选中数量
    updateSelectedCount();

    // ✅ 滚动指示器：监听滚动事件切换 scrolled 类
    if (checklist) {
        checklist.addEventListener('scroll', function handleScroll() {
            if (checklist.scrollTop > 10) {
                checklist.classList.add('scrolled');
            } else {
                checklist.classList.remove('scrolled');
            }
        });
    }
}

/**
 * 绑定模型管理弹窗事件
 * @param {string} providerId - 提供商ID
 */
function bindModelsManageEvents(providerId) {
    const modal = document.getElementById('models-manage-modal');
    const searchInput = document.getElementById('models-search-input');
    const checklist = document.getElementById('models-checklist');
    const closeBtn = document.getElementById('close-models-manage');
    const cancelBtn = document.getElementById('cancel-models-manage');
    const addBtn = document.getElementById('add-selected-models');

    if (!modal) return;

    // 关闭按钮
    const closeHandler = () => {
        modal.classList.remove('active');
        searchInput.value = '';
        // 隐藏全选/反选按钮
        const bulkActions = document.getElementById('models-bulk-actions');
        if (bulkActions) bulkActions.style.display = 'none';
        // 移除 ESC 键监听器
        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
            modal._escHandler = null;
        }
    };

    // ESC 键关闭（WCAG 2.1.1）
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeHandler();
        }
    };
    // 移除旧的 ESC 监听器（如果存在）
    if (modal._escHandler) {
        document.removeEventListener('keydown', modal._escHandler);
    }
    document.addEventListener('keydown', escHandler);
    modal._escHandler = escHandler;

    closeBtn?.replaceWith(closeBtn.cloneNode(true)); // 移除旧事件
    document.getElementById('close-models-manage')?.addEventListener('click', closeHandler);
    cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
    document.getElementById('cancel-models-manage')?.addEventListener('click', closeHandler);

    // 搜索框
    searchInput?.replaceWith(searchInput.cloneNode(true));
    document.getElementById('models-search-input')?.addEventListener('input', async () => {
        const allModels = await fetchProviderModels(providerId);
        renderModelsChecklist(providerId, allModels);
        bindModelsManageEvents(providerId); // 重新绑定事件
    });

    // 复选框变化监听
    checklist?.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateSelectedCount);
    });

    // ========== 全选按钮 ==========
    const selectAllBtn = document.getElementById('select-all-models');
    selectAllBtn?.replaceWith(selectAllBtn.cloneNode(true));
    document.getElementById('select-all-models')?.addEventListener('click', () => {
        const checkboxes = checklist?.querySelectorAll('input[type="checkbox"]');
        checkboxes?.forEach(cb => {
            cb.checked = true;
        });
        updateSelectedCount();
    });

    // ========== 反选按钮 ==========
    const deselectAllBtn = document.getElementById('deselect-all-models');
    deselectAllBtn?.replaceWith(deselectAllBtn.cloneNode(true));
    document.getElementById('deselect-all-models')?.addEventListener('click', () => {
        const checkboxes = checklist?.querySelectorAll('input[type="checkbox"]');
        checkboxes?.forEach(cb => {
            cb.checked = !cb.checked;
        });
        updateSelectedCount();
    });

    // 添加选中的模型按钮
    addBtn?.replaceWith(addBtn.cloneNode(true));
    document.getElementById('add-selected-models')?.addEventListener('click', () => {
        const selectedCheckboxes = Array.from(checklist.querySelectorAll('input[type="checkbox"]:checked'));
        const selectedModels = selectedCheckboxes.map(cb => cb.value);

        if (selectedModels.length === 0) {
            eventBus.emit('ui:notification', { message: '请至少选择一个模型', type: 'warning' });
            return;
        }

        // 批量添加模型
        const addedCount = addModelsToProvider(providerId, selectedModels);

        eventBus.emit('ui:notification', {
            message: `成功添加 ${addedCount} 个模型`,
            type: 'success'
        });

        // 关闭弹窗并刷新表单
        closeHandler();
        showProviderForm(providerId);
    });
}

/**
 * 更新选中的模型数量
 */
function updateSelectedCount() {
    const checklist = document.getElementById('models-checklist');
    const countSpan = document.getElementById('selected-models-count');

    if (!checklist || !countSpan) return;

    const selectedCount = checklist.querySelectorAll('input[type="checkbox"]:checked').length;
    countSpan.textContent = selectedCount.toString();
}

/**
 * 显示添加自定义模型对话框
 * @param {string} providerId - 提供商ID
 */
async function showAddCustomModelDialog(providerId) {
    const modelId = await showInputDialog(
        '请输入模型ID:',
        '',
        '添加自定义模型'
    );

    if (!modelId || !modelId.trim()) {
        return; // 用户取消或输入为空
    }

    const success = addModelToProvider(providerId, modelId.trim());

    if (success) {
        eventBus.emit('ui:notification', {
            message: `模型 "${modelId.trim()}" 已添加`,
            type: 'success'
        });
        showProviderForm(providerId); // 刷新表单
    } else {
        eventBus.emit('ui:notification', {
            message: `模型已存在`,
            type: 'warning'
        });
    }
}

/**
 * 更新端点提示文本
 * @param {string} apiFormat - API格式
 */
function updateEndpointHint(apiFormat) {
    const hint = document.getElementById('endpoint-hint-text');
    if (!hint) return;

    const hints = {
        'openai': '示例: https://api.openai.com/v1/chat/completions 或 http://localhost:8000/v1/chat/completions',
        'openai-responses': '示例: https://api.openai.com/v1/chat/completions（自动使用 Responses API）',
        'gemini': '示例: https://generativelanguage.googleapis.com 或自定义代理地址',
        'claude': '示例: https://api.anthropic.com/v1/messages 或自定义代理地址'
    };

    hint.textContent = hints[apiFormat] || '请输入完整的API端点地址';
    hint.style.color = 'var(--md-muted)';
}

/**
 * 自动补全端点格式
 * @param {string} endpoint - 用户输入的端点
 * @param {string} apiFormat - API格式
 * @returns {string} 补全后的端点
 */
function autoCompleteEndpoint(endpoint, apiFormat) {
    // 移除末尾斜杠
    endpoint = endpoint.replace(/\/$/, '');

    switch (apiFormat) {
        case 'openai':
        case 'openai-responses':
            // OpenAI 格式自动补全
            if (!endpoint.includes('/chat/completions')) {
                if (endpoint.includes('/v1')) {
                    return endpoint + '/chat/completions';
                } else {
                    return endpoint + '/v1/chat/completions';
                }
            }
            return endpoint;

        case 'gemini':
            // Gemini 格式自动补全
            // 如果已经是完整的 API 路径，不做修改
            if (endpoint.includes('/v1beta/models') || endpoint.includes('/v1/models')) {
                return endpoint;
            }
            // 如果只是域名，返回基础 URL（不加具体路径，让后续逻辑处理）
            return endpoint;

        case 'claude':
            // Claude 格式自动补全
            if (!endpoint.includes('/messages')) {
                if (endpoint.includes('/v1')) {
                    return endpoint + '/messages';
                } else {
                    return endpoint + '/v1/messages';
                }
            }
            return endpoint;

        default:
            return endpoint;
    }
}

/**
 * 打开模型编辑弹窗
 * @param {string} providerId - 提供商ID
 * @param {string} modelId - 模型ID
 */
function openEditModelModal(providerId, modelId) {
    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    // 查找模型配置
    const modelConfig = provider.models.find(m => {
        return typeof m === 'string' ? m === modelId : m.id === modelId;
    });

    if (!modelConfig) return;

    // 获取模型数据（兼容字符串和对象格式）
    const model = typeof modelConfig === 'string'
        ? { id: modelConfig, name: modelConfig, capabilities: { imageInput: false, imageOutput: false } }
        : modelConfig;

    // 填充表单
    document.getElementById('edit-model-id').value = model.id;
    document.getElementById('edit-model-name').value = model.name || model.id;
    document.getElementById('edit-model-image-input').checked = model.capabilities?.imageInput || false;
    document.getElementById('edit-model-image-output').checked = model.capabilities?.imageOutput || false;

    // 显示弹窗
    const modal = document.getElementById('edit-model-modal');
    if (modal) {
        modal.style.display = 'flex';
        // 保存上下文数据，供保存时使用
        modal.dataset.providerId = providerId;
        modal.dataset.modelId = modelId;
    }
}

/**
 * 保存编辑的模型
 */
function saveEditedModel() {
    const modal = document.getElementById('edit-model-modal');
    if (!modal) return;

    const providerId = modal.dataset.providerId;
    const modelId = modal.dataset.modelId;

    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) return;

    // 获取表单数据
    const newName = document.getElementById('edit-model-name').value.trim();
    const imageInput = document.getElementById('edit-model-image-input').checked;
    const imageOutput = document.getElementById('edit-model-image-output').checked;

    if (!newName) {
        alert('请输入模型名称');
        return;
    }

    // 更新模型配置
    const modelIndex = provider.models.findIndex(m => {
        return typeof m === 'string' ? m === modelId : m.id === modelId;
    });

    if (modelIndex === -1) return;

    // 构建新的模型对象
    provider.models[modelIndex] = {
        id: modelId,
        name: newName,
        capabilities: {
            imageInput,
            imageOutput
        }
    };

    // 更新提供商
    updateProvider(providerId, { models: provider.models });

    // 关闭弹窗
    closeEditModelModal();

    // 刷新提供商表单（如果正在显示）
    if (selectedProviderId === providerId) {
        showProviderForm(providerId);
    }

    eventBus.emit('ui:notification', { message: '模型已更新', type: 'success' });
}

/**
 * 关闭模型编辑弹窗
 */
function closeEditModelModal() {
    const modal = document.getElementById('edit-model-modal');
    if (modal) {
        modal.style.display = 'none';
        delete modal.dataset.providerId;
        delete modal.dataset.modelId;
    }
}
