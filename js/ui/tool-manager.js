/**
 * 工具调用管理界面
 * 提供完整的工具 CRUD 功能：创建、读取、更新、删除
 * 参考设计：js/providers/ui.js（左右分栏模态框）
 *
 * 添加事件监听器管理,防止内存泄漏
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { EventListenerManager } from '../utils/event-listener-manager.js';
import {
    getAllTools,
    getEnabledTools,
    setToolEnabled,
    registerCustomTool,
    removeTool,
    isToolEnabled,
    getTool
} from '../tools/manager.js';
import { safeValidate } from '../tools/validator.js';
import { executeTool } from '../tools/executor.js';
import { getToolHistory, clearToolHistory } from '../tools/history.js';
import { debouncedSaveSession } from '../state/sessions.js';
import { showNotification } from './notifications.js';
import { showConfirmDialog } from '../utils/dialogs.js';
import { getIcon } from '../utils/icons.js';

// ========== 模块状态 ==========

let modal = null;
let selectedToolId = null;
let isEditing = false;
let removeFocusTrap = null;
// 全局事件监听器管理器（用于管理持久性监听器）
let globalListenerManager = null;

// ========== 辅助函数 ==========

/**
 * 创建焦点陷阱（Focus Trap）- WCAG 2.4.3 合规
 * 确保 Tab 键导航被限制在模态框内，防止焦点逃逸到背景内容
 * @param {HTMLElement} container - 要限制焦点的容器元素
 * @returns {Function} 移除焦点陷阱的函数
 */
function createFocusTrap(container) {
    if (!container) return () => {};

    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function handleTab(e) {
        if (e.key !== 'Tab') return;

        const focusableElements = container.querySelectorAll(focusableSelector);
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
            // Shift+Tab: 如果在第一个元素，跳到最后一个
            if (document.activeElement === firstElement) {
                e.preventDefault();
                lastElement?.focus();
            }
        } else {
            // Tab: 如果在最后一个元素，跳到第一个
            if (document.activeElement === lastElement) {
                e.preventDefault();
                firstElement?.focus();
            }
        }
    }

    container.addEventListener('keydown', handleTab);

    // 返回清理函数
    return () => {
        container.removeEventListener('keydown', handleTab);
    };
}

// ========== 初始化 ==========

/**
 * 初始化工具管理界面
 */
export function initToolManager() {
    console.log('[Tool Manager] 🔧 初始化工具管理界面...');

    // 创建全局事件监听器管理器
    if (!globalListenerManager) {
        globalListenerManager = new EventListenerManager();
    }

    // 创建模态框
    createModal();

    // 绑定顶部导航栏按钮
    const toggleBtn = document.getElementById('tools-manager-toggle');
    if (toggleBtn) {
        globalListenerManager.add(toggleBtn, 'click', openModal);
    }

    // 监听工具系统事件
    setupEventListeners();

    console.log('[Tool Manager] 工具管理界面已初始化');
}

/**
 * 创建模态框 DOM
 * 性能优化：缓存频繁使用的 DOM 元素
 */
function createModal() {
    modal = document.getElementById('tool-manager-modal');
    if (!modal) {
        console.error('[Tool Manager] 未找到模态框元素 #tool-manager-modal');
        return;
    }

    // 优化：一次性查询所有需要的元素
    const closeBtn = modal.querySelector('.close-tool-manager');
    const tabBtns = modal.querySelectorAll('.tab-btn');
    const searchInput = modal.querySelector('#tool-search-input');
    const addCustomBtn = modal.querySelector('#add-custom-tool-btn');

    // 绑定关闭按钮（使用全局管理器）
    if (closeBtn) {
        globalListenerManager.add(closeBtn, 'click', closeModal);
    }

    // 绑定 Tab 切换
    tabBtns.forEach(btn => {
        globalListenerManager.add(btn, 'click', () => handleTabSwitch(btn.dataset.tab));
    });

    // 点击背景关闭
    const handleModalClick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
    globalListenerManager.add(modal, 'click', handleModalClick);

    // ESC 键关闭
    const handleEscapeKey = (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    };
    globalListenerManager.add(document, 'keydown', handleEscapeKey);

    // 绑定搜索框
    if (searchInput) {
        globalListenerManager.add(searchInput, 'input', handleToolSearch);
    }

    // 绑定添加自定义工具按钮
    if (addCustomBtn) {
        globalListenerManager.add(addCustomBtn, 'click', handleAddCustomTool);
    }

    // 绑定表单按钮
    bindFormButtons();
}

/**
 * 绑定表单按钮事件
 */
function bindFormButtons() {
    // 验证 Schema 按钮
    const validateBtn = modal.querySelector('#validate-schema-btn');
    if (validateBtn) {
        validateBtn.addEventListener('click', handleValidateSchema);
    }

    // 测试工具按钮
    const testBtn = modal.querySelector('#test-tool-btn');
    if (testBtn) {
        testBtn.addEventListener('click', handleTestTool);
    }

    // 删除按钮
    const deleteBtn = modal.querySelector('#delete-tool-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteTool);
    }

    // 取消按钮
    const cancelBtn = modal.querySelector('#cancel-tool-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', handleCancelEdit);
    }

    // 保存按钮
    const saveBtn = modal.querySelector('#save-tool-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveTool);
    }
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
    // 监听工具注册事件
    eventBus.on('tool:registered', renderToolsList);
    eventBus.on('tool:enabled:changed', renderToolsList);
    eventBus.on('tool:removed', renderToolsList);
    eventBus.on('tools:updated', renderToolsList);

    // 监听快捷选择器的"管理"按钮
    eventBus.on('tools:manage:open', openModal);
}

// ========== 模态框控制 ==========

/**
 * 打开模态框
 */
export function openModal() {
    if (!modal) return;

    modal.style.display = 'flex';
    renderToolsList();
    showEmptyState();

    // 创建焦点陷阱（WCAG 2.4.3 合规）
    removeFocusTrap = createFocusTrap(modal);

    console.log('[Tool Manager] 📂 打开工具管理界面');
}

/**
 * 关闭模态框
 */
export function closeModal() {
    if (!modal) return;

    // 如果正在编辑，提示保存
    if (isEditing) {
        showConfirmDialog('有未保存的更改，确定要关闭吗？', '确认关闭').then(confirmed => {
            if (confirmed) {
                modal.style.display = 'none';
                resetForm();

                // 移除焦点陷阱
                if (removeFocusTrap) {
                    removeFocusTrap();
                    removeFocusTrap = null;
                }
            }
        });
    } else {
        modal.style.display = 'none';
        resetForm();

        // 移除焦点陷阱
        if (removeFocusTrap) {
            removeFocusTrap();
            removeFocusTrap = null;
        }
    }

    console.log('[Tool Manager] 📁 关闭工具管理界面');
}

// ========== 工具列表渲染 ==========

/**
 * 渲染工具列表（左侧）
 * 性能优化：缓存 DOM 查询
 */
function renderToolsList() {
    // 优化：缓存容器查询
    const listContainer = modal.querySelector('#tools-list-container');
    if (!listContainer) return;

    // 过滤掉 hidden 工具（如 Computer Use）
    const allTools = getAllTools().filter(t => !t.hidden);

    // 按类型分组
    const builtinTools = allTools.filter(t => t.type === 'builtin');
    const mcpTools = allTools.filter(t => t.type === 'mcp');
    const customTools = allTools.filter(t => t.type === 'custom');

    listContainer.innerHTML = `
        ${renderToolGroup('内置工具', builtinTools, 'builtin')}
        ${renderToolGroup('MCP 工具', mcpTools, 'mcp')}
        ${renderToolGroup('自定义工具', customTools, 'custom')}
    `;

    // 优化：一次性查询所有元素
    const toolItems = listContainer.querySelectorAll('.tool-item');
    const enableSwitches = listContainer.querySelectorAll('.tool-enable-switch');

    // 绑定工具项点击事件
    toolItems.forEach(item => {
        item.addEventListener('click', () => {
            const toolId = item.dataset.toolId;
            selectTool(toolId);
        });
    });

    // 绑定启用开关
    enableSwitches.forEach(switchEl => {
        switchEl.addEventListener('change', (e) => {
            e.stopPropagation(); // 阻止冒泡到工具项点击
            const toolId = e.target.dataset.toolId;
            const enabled = e.target.checked;
            setToolEnabled(toolId, enabled);
            showNotification(`工具 ${enabled ? '已启用' : '已禁用'}`, 'success');
        });
    });
}

/**
 * 渲染工具分组
 */
function renderToolGroup(title, tools, type) {
    if (tools.length === 0) return '';

    const toolsHtml = tools.map(tool => {
        const enabled = isToolEnabled(tool.id);
        const selected = selectedToolId === tool.id ? 'selected' : '';
        const icon = getToolIcon(tool.id, type);

        return `
            <div class="tool-item ${selected}" data-tool-id="${tool.id}" data-type="${type}">
                <div class="tool-item-content">
                    <span class="tool-icon">${icon}</span>
                    <span class="tool-name">${tool.name}</span>
                </div>
                <label class="tool-enable-switch-container" onclick="event.stopPropagation()">
                    <input type="checkbox"
                           class="tool-enable-switch"
                           data-tool-id="${tool.id}"
                           ${enabled ? 'checked' : ''}>
                    <span class="switch-slider"></span>
                </label>
            </div>
        `;
    }).join('');

    return `
        <div class="tool-group">
            <div class="tool-group-header">
                <span class="tool-group-title">${title}</span>
                <span class="tool-group-count">(${tools.length})</span>
            </div>
            <div class="tool-group-items">
                ${toolsHtml}
            </div>
        </div>
    `;
}

/**
 * 获取工具图标（返回 SVG）
 */
function getToolIcon(toolId, type) {
    // 内置工具图标映射（返回图标名称）
    const iconMap = {
        'web_search': 'globe',
        'calculator': 'barChart',
        'datetime': 'clock',
        'unit_converter': 'barChart',
        'text_formatter': 'type',
        'random_generator': 'star'
    };

    let iconName = iconMap[toolId];

    // 根据类型返回默认图标
    if (!iconName) {
        if (type === 'mcp') iconName = 'plug';
        else if (type === 'custom') iconName = 'tool';
        else iconName = 'settings';
    }

    return getIcon(iconName, { size: 16, className: 'tool-icon' });
}

// ========== 工具选择和详情 ==========

/**
 * 选择工具
 */
function selectTool(toolId) {
    selectedToolId = toolId;

    // 更新列表选中状态
    modal.querySelectorAll('.tool-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.toolId === toolId);
    });

    // 显示工具详情表单
    showToolForm(toolId);
}

/**
 * 显示工具详情表单
 */
function showToolForm(toolOrId) {
    // 支持两种参数类型：字符串 ID 或工具对象
    const tool = typeof toolOrId === 'string' ? getTool(toolOrId) : toolOrId;
    if (!tool) {
        showEmptyState();
        return;
    }

    const detailContainer = modal.querySelector('#tool-detail-container');
    if (!detailContainer) return;

    // 判断是否可编辑（自定义工具可编辑，内置和MCP工具只读）
    const isEditable = tool.type === 'custom';
    isEditing = false;

    detailContainer.innerHTML = `
        <div class="tool-detail-form">
            <h3 class="form-section-title">基本信息</h3>

            <div class="form-group">
                <label>工具名称 ${isEditable ? '<span class="required">*</span>' : ''}</label>
                <input type="text"
                       id="tool-name-input"
                       class="form-control"
                       value="${tool.name}"
                       ${!isEditable ? 'readonly' : ''}
                       placeholder="例如: web_search">
                <small class="form-hint">用于 API 调用的唯一标识符（仅限字母、数字、下划线）</small>
            </div>

            <div class="form-group">
                <label>工具描述 ${isEditable ? '<span class="required">*</span>' : ''}</label>
                <textarea id="tool-description-input"
                          class="form-control"
                          rows="3"
                          ${!isEditable ? 'readonly' : ''}
                          placeholder="清晰描述工具功能，帮助 LLM 判断何时使用">${tool.description || ''}</textarea>
            </div>

            <div class="form-group">
                <label>工具类型</label>
                <input type="text"
                       class="form-control"
                       value="${getToolTypeLabel(tool.type)}"
                       readonly>
            </div>

            <h3 class="form-section-title">参数定义</h3>

            <div class="form-group">
                <label>JSON Schema ${isEditable ? '<span class="required">*</span>' : ''}</label>
                <textarea id="tool-schema-input"
                          class="form-control code-editor"
                          rows="12"
                          ${!isEditable ? 'readonly' : ''}
                          placeholder='{"type": "object", "properties": {...}}'>${JSON.stringify(tool.parameters || {}, null, 2)}</textarea>
                ${isEditable ? '<button id="validate-schema-btn" class="btn btn-sm btn-secondary">验证 Schema</button>' : ''}
                <small class="form-hint">
                    定义工具接受的参数结构。
                    ${isEditable ? '<a href="#" onclick="showSchemaExamples(); return false;">查看示例</a>' : ''}
                </small>
                <div id="schema-validation-result" class="validation-result"></div>
            </div>

            ${isEditable ? renderPermissionsForm() : ''}
            ${isEditable ? renderRateLimitForm() : ''}

            <div class="form-actions">
                <button id="test-tool-btn" class="btn btn-secondary">🧪 测试工具</button>
                ${isEditable ? '<button id="delete-tool-btn" class="btn btn-danger">删除</button>' : ''}
                ${isEditable ? '<button id="cancel-tool-btn" class="btn btn-default">取消</button>' : ''}
                ${isEditable ? '<button id="save-tool-btn" class="btn btn-primary">保存</button>' : ''}
            </div>
        </div>
    `;

    // 重新绑定按钮事件
    bindFormButtons();

    // 监听输入变化
    if (isEditable) {
        const inputs = detailContainer.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                isEditing = true;
            });
        });
    }
}

/**
 * 渲染权限配置表单
 */
function renderPermissionsForm() {
    return `
        <h3 class="form-section-title">权限设置</h3>

        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" id="require-approval-checkbox" class="form-checkbox">
                <span>需要用户确认</span>
            </label>
            <label class="checkbox-label">
                <input type="checkbox" id="allow-filesystem-checkbox" class="form-checkbox">
                <span>允许文件系统访问</span>
            </label>
            <label class="checkbox-label">
                <input type="checkbox" id="allow-network-checkbox" class="form-checkbox">
                <span>允许网络请求</span>
            </label>
        </div>
    `;
}

/**
 * 渲染速率限制表单
 */
function renderRateLimitForm() {
    return `
        <h3 class="form-section-title">速率限制</h3>

        <div class="form-group">
            <div class="rate-limit-inputs">
                <span>最多调用</span>
                <input type="number"
                       id="rate-limit-max-input"
                       class="form-control form-control-sm"
                       min="1"
                       value="10">
                <span>次 /</span>
                <input type="number"
                       id="rate-limit-window-input"
                       class="form-control form-control-sm"
                       min="1"
                       value="1">
                <select id="rate-limit-unit-select" class="form-control form-control-sm">
                    <option value="minute">分钟</option>
                    <option value="hour">小时</option>
                    <option value="day">天</option>
                </select>
            </div>
        </div>
    `;
}

/**
 * 显示空状态
 */
function showEmptyState() {
    const detailContainer = modal.querySelector('#tool-detail-container');
    if (!detailContainer) return;

    detailContainer.innerHTML = `
        <div class="empty-state">
            <svg class="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p class="empty-title">选择工具查看详情</p>
            <p class="empty-hint">或点击下方"添加自定义工具"开始配置</p>
        </div>
    `;

    selectedToolId = null;
    isEditing = false;
}

/**
 * 获取工具类型标签
 */
function getToolTypeLabel(type) {
    const labels = {
        'builtin': '内置工具',
        'mcp': 'MCP 工具',
        'custom': '自定义工具'
    };
    return labels[type] || type;
}

// ========== 表单操作 ==========

/**
 * 处理添加自定义工具
 */
function handleAddCustomTool() {
    selectedToolId = `custom_${Date.now()}`;

    const newTool = {
        id: selectedToolId,
        name: '',
        description: '',
        type: 'custom',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        enabled: true
    };

    // 传递工具对象而非 ID
    showToolForm(newTool);

    // 不立即设置 isEditing，只有当用户开始输入时才设置
    // isEditing = true;  // 移除这一行，第 454-461 行的输入监听器会在用户输入时设置

    console.log('[Tool Manager] ➕ 创建新工具');
}

/**
 * 处理验证 Schema
 */
function handleValidateSchema() {
    const schemaInput = modal.querySelector('#tool-schema-input');
    const resultDiv = modal.querySelector('#schema-validation-result');

    if (!schemaInput || !resultDiv) return;

    try {
        const schema = JSON.parse(schemaInput.value);

        // 基本验证：必须是 object 类型
        if (schema.type !== 'object') {
            throw new Error('Schema 必须是 object 类型');
        }

        resultDiv.innerHTML = `<span class="validation-success">${getIcon('checkCircle', { size: 14 })} Schema 格式正确</span>`;
        resultDiv.className = 'validation-result success';

        setTimeout(() => {
            resultDiv.innerHTML = '';
        }, 3000);

    } catch (error) {
        resultDiv.innerHTML = `<span class="validation-error">${getIcon('xCircle', { size: 14 })} ${error.message}</span>`;
        resultDiv.className = 'validation-result error';
    }
}

/**
 * 处理测试工具
 */
async function handleTestTool() {
    if (!selectedToolId) {
        showNotification('请先选择要测试的工具', 'error');
        return;
    }

    const tool = getTool(selectedToolId);
    if (!tool) {
        showNotification('工具不存在', 'error');
        return;
    }

    await showToolTestDialog(tool);
}

/**
 * 处理删除工具
 */
async function handleDeleteTool() {
    if (!selectedToolId) return;

    const tool = getTool(selectedToolId);
    if (!tool) return;

    const confirmed = await showConfirmDialog(
        `确定要删除工具 "${tool.name}" 吗？`,
        '删除工具'
    );

    if (!confirmed) return;

    removeTool(selectedToolId);
    debouncedSaveSession();

    showNotification(`已删除工具: ${tool.name}`, 'success');
    showEmptyState();
    renderToolsList();

    console.log('[Tool Manager] 🗑️ 删除工具:', selectedToolId);
}

/**
 * 处理取消编辑
 */
function handleCancelEdit() {
    if (isEditing) {
        showConfirmDialog('有未保存的更改，确定要取消吗？', '确认取消').then(confirmed => {
            if (confirmed) {
                showEmptyState();
            }
        });
    } else {
        showEmptyState();
    }
}

/**
 * 处理保存工具
 */
async function handleSaveTool() {
    const nameInput = modal.querySelector('#tool-name-input');
    const descInput = modal.querySelector('#tool-description-input');
    const schemaInput = modal.querySelector('#tool-schema-input');

    if (!nameInput || !descInput || !schemaInput) return;

    const name = nameInput.value.trim();
    const description = descInput.value.trim();

    // 验证必填字段
    if (!name) {
        showNotification('请输入工具名称', 'error');
        nameInput.focus();
        return;
    }

    if (!description) {
        showNotification('请输入工具描述', 'error');
        descInput.focus();
        return;
    }

    // 验证 Schema
    let schema;
    try {
        schema = JSON.parse(schemaInput.value);
        if (schema.type !== 'object') {
            throw new Error('Schema 必须是 object 类型');
        }
    } catch (error) {
        showNotification(`Schema 格式错误: ${error.message}`, 'error');
        schemaInput.focus();
        return;
    }

    // 获取权限配置
    const permissions = {
        requireApproval: modal.querySelector('#require-approval-checkbox')?.checked || false,
        allowFilesystem: modal.querySelector('#allow-filesystem-checkbox')?.checked || false,
        allowNetwork: modal.querySelector('#allow-network-checkbox')?.checked || false
    };

    // 获取速率限制
    const rateLimit = {
        max: parseInt(modal.querySelector('#rate-limit-max-input')?.value || '10'),
        window: parseInt(modal.querySelector('#rate-limit-window-input')?.value || '1'),
        unit: modal.querySelector('#rate-limit-unit-select')?.value || 'minute'
    };

    // 构建工具配置
    const toolConfig = {
        name,
        description,
        parameters: schema,
        permissions,
        rateLimit
    };

    // 注册工具
    try {
        registerCustomTool({
            id: selectedToolId,
            ...toolConfig
        });
        debouncedSaveSession();

        showNotification('工具已保存', 'success');
        isEditing = false;
        renderToolsList();
        selectTool(selectedToolId); // 刷新详情显示

        console.log('[Tool Manager] 💾 保存工具:', selectedToolId, toolConfig);
    } catch (error) {
        showNotification(`保存失败: ${error.message}`, 'error');
        console.error('[Tool Manager] 保存工具失败:', error);
    }
}

/**
 * 重置表单
 */
function resetForm() {
    selectedToolId = null;
    isEditing = false;
    showEmptyState();
}

// ========== 搜索功能 ==========

/**
 * 处理工具搜索
 */
function handleToolSearch(e) {
    const query = e.target.value.toLowerCase().trim();

    const toolItems = modal.querySelectorAll('.tool-item');
    toolItems.forEach(item => {
        const toolId = item.dataset.toolId;
        const tool = getTool(toolId);

        if (!tool) {
            item.style.display = 'none';
            return;
        }

        const nameMatch = tool.name.toLowerCase().includes(query);
        const descMatch = (tool.description || '').toLowerCase().includes(query);

        item.style.display = (nameMatch || descMatch) ? 'flex' : 'none';
    });

    // 隐藏空分组
    modal.querySelectorAll('.tool-group').forEach(group => {
        const visibleItems = group.querySelectorAll('.tool-item[style*="flex"]').length;
        group.style.display = visibleItems > 0 ? 'block' : 'none';
    });
}

// ========== Tab 切换 ==========

/**
 * 处理 Tab 切换
 * @param {string} tabId - Tab ID (tools/permissions/history)
 */
function handleTabSwitch(tabId) {
    if (!modal) return;

    // 更新 Tab 按钮状态
    modal.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // 更新 Tab 内容显示
    modal.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.dataset.tab === tabId);
    });

    console.log(`[Tool Manager] 切换到 Tab: ${tabId}`);

    // 根据 Tab 加载对应内容
    if (tabId === 'permissions') {
        loadPermissionsTab();
    } else if (tabId === 'history') {
        loadHistoryTab();
    }
}

/**
 * 加载权限管理 Tab 内容
 */
function loadPermissionsTab() {
    const container = document.getElementById('permissions-list-container');
    if (!container) return;

    // 获取所有工具并渲染权限列表（过滤掉 hidden 工具）
    const tools = getAllTools().filter(t => !t.hidden);
    if (tools.length === 0) {
        container.innerHTML = '<p class="no-data-hint">暂无工具</p>';
        return;
    }

    let html = '<div class="permissions-list">';
    tools.forEach(tool => {
        const enabled = isToolEnabled(tool.id);
        html += `
            <div class="permission-item">
                <div class="permission-info">
                    <span class="permission-name">${tool.name || tool.id}</span>
                    <span class="permission-type type-${tool.type}">${tool.type}</span>
                </div>
                <div class="permission-controls">
                    <label class="switch">
                        <input type="checkbox" ${enabled ? 'checked' : ''} data-tool-id="${tool.id}">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;

    // 绑定开关事件
    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const toolId = e.target.dataset.toolId;
            setToolEnabled(toolId, e.target.checked);
            showNotification(`工具 "${toolId}" 已${e.target.checked ? '启用' : '禁用'}`, 'success');
        });
    });
}

/**
 * 加载执行历史 Tab 内容
 */
function loadHistoryTab() {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    // 获取历史记录
    const history = getToolHistory({ limit: 50 });
    if (!history || history.length === 0) {
        container.innerHTML = '<p class="no-data-hint">暂无执行历史</p>';
        return;
    }

    let html = '<div class="history-list">';
    history.forEach(record => {
        const time = new Date(record.timestamp).toLocaleString();
        const statusClass = record.success ? 'success' : 'error';
        const statusText = record.success ? '成功' : '失败';

        html += `
            <div class="history-item ${statusClass}">
                <div class="history-info">
                    <span class="history-name">${record.toolName || record.toolId}</span>
                    <span class="history-time">${time}</span>
                </div>
                <div class="history-status">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                    ${record.duration ? `<span class="history-duration">${record.duration}ms</span>` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;

    // 绑定清空按钮
    const clearBtn = document.getElementById('clear-history-btn');
    if (clearBtn) {
        clearBtn.onclick = async () => {
            const confirmed = await showConfirmDialog('确定要清空所有执行历史吗？', '清空历史');
            if (confirmed) {
                clearToolHistory();
                loadHistoryTab();
                showNotification('执行历史已清空', 'success');
            }
        };
    }
}

// ========== 工具测试对话框 ==========

/**
 * 显示工具测试对话框
 * @param {Object} tool - 工具定义
 */
async function showToolTestDialog(tool) {
    const modal = document.getElementById('tool-test-dialog-modal');
    const title = document.getElementById('tool-test-dialog-title');
    const description = document.getElementById('tool-test-description');
    const formContainer = document.getElementById('tool-test-form-container');
    const resultContainer = document.getElementById('tool-test-result-container');
    const resultContent = document.getElementById('tool-test-result-content');
    const executeBtn = document.getElementById('tool-test-execute-btn');
    const closeBtn = document.getElementById('tool-test-close-btn');
    const closeBtnX = document.getElementById('close-tool-test-dialog');

    // 设置标题和描述
    title.textContent = `测试工具: ${tool.name || tool.id}`;
    description.textContent = tool.description || '无描述';

    // 生成表单
    const schema = tool.inputSchema;
    if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
        formContainer.innerHTML = '<p class="no-params-hint">此工具无参数</p>';
    } else {
        formContainer.innerHTML = generateFormFromSchema(schema);
    }

    // 隐藏结果容器
    resultContainer.style.display = 'none';
    resultContent.innerHTML = '';

    // 显示对话框
    modal.style.display = 'flex';

    // 事件处理器
    const handleExecute = async () => {
        try {
            // 收集表单数据
            const args = collectFormData(formContainer, schema);

            // 显示加载状态
            executeBtn.disabled = true;
            executeBtn.textContent = '执行中...';
            resultContainer.style.display = 'none';

            // 执行工具
            const { executeTool } = await import('../tools/executor.js');
            const result = await executeTool(tool.id, args);

            // 显示成功结果
            resultContent.innerHTML = `
                <div class="test-result-success">
                    <h4>执行成功</h4>
                    <pre class="result-data">${JSON.stringify(result, null, 2)}</pre>
                </div>
            `;
            resultContainer.style.display = 'block';
            showNotification('工具执行成功', 'success');

        } catch (error) {
            // 显示错误结果
            resultContent.innerHTML = `
                <div class="test-result-error">
                    <h4>❌ 执行失败</h4>
                    <pre class="error-message">${error.message}</pre>
                </div>
            `;
            resultContainer.style.display = 'block';
            showNotification('工具执行失败', 'error');

        } finally {
            executeBtn.disabled = false;
            executeBtn.textContent = '执行测试';
        }
    };

    const handleClose = () => {
        modal.style.display = 'none';
        executeBtn.removeEventListener('click', handleExecute);
        closeBtn.removeEventListener('click', handleClose);
        closeBtnX.removeEventListener('click', handleClose);
    };

    executeBtn.addEventListener('click', handleExecute);
    closeBtn.addEventListener('click', handleClose);
    closeBtnX.addEventListener('click', handleClose);

    // ESC 关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            handleClose();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

/**
 * 从 JSON Schema 生成表单 HTML
 * @param {Object} schema - JSON Schema
 * @returns {string} HTML 字符串
 */
function generateFormFromSchema(schema) {
    const properties = schema.properties || {};
    const required = schema.required || [];

    let html = '<div class="tool-test-form">';

    for (const [key, prop] of Object.entries(properties)) {
        const isRequired = required.includes(key);
        const label = prop.title || key;
        const description = prop.description || '';

        html += `
            <div class="form-field">
                <label for="test-param-${key}">
                    ${label}
                    ${isRequired ? '<span class="required">*</span>' : ''}
                </label>
                ${description ? `<p class="field-description">${description}</p>` : ''}
        `;

        // 根据类型生成不同的输入控件
        if (prop.type === 'string') {
            if (prop.enum) {
                // 枚举类型 - 下拉选择
                html += `<select id="test-param-${key}" ${isRequired ? 'required' : ''}>`;
                html += '<option value="">-- 请选择 --</option>';
                prop.enum.forEach(value => {
                    html += `<option value="${value}">${value}</option>`;
                });
                html += '</select>';
            } else if (prop.format === 'textarea' || (prop.maxLength && prop.maxLength > 100)) {
                // 多行文本
                html += `<textarea id="test-param-${key}" rows="3" placeholder="${prop.default || ''}" ${isRequired ? 'required' : ''}></textarea>`;
            } else {
                // 单行文本
                html += `<input type="text" id="test-param-${key}" placeholder="${prop.default || ''}" ${isRequired ? 'required' : ''} />`;
            }
        } else if (prop.type === 'number' || prop.type === 'integer') {
            // 数字
            html += `<input type="number" id="test-param-${key}" placeholder="${prop.default !== undefined ? prop.default : ''}" ${isRequired ? 'required' : ''} />`;
        } else if (prop.type === 'boolean') {
            // 布尔值 - 复选框
            html += `
                <label class="checkbox-label">
                    <input type="checkbox" id="test-param-${key}" ${prop.default ? 'checked' : ''} />
                    ${prop.default !== undefined ? `(默认: ${prop.default})` : ''}
                </label>
            `;
        } else if (prop.type === 'array' || prop.type === 'object') {
            // 数组/对象 - JSON 编辑器
            html += `<textarea id="test-param-${key}" rows="5" class="code-editor" placeholder="${prop.type === 'array' ? '[]' : '{}'}" ${isRequired ? 'required' : ''}></textarea>`;
            html += `<p class="field-hint">请输入有效的 JSON 格式</p>`;
        } else {
            // 其他类型 - 文本输入
            html += `<input type="text" id="test-param-${key}" placeholder="${prop.default || ''}" ${isRequired ? 'required' : ''} />`;
        }

        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * 收集并验证表单数据
 * @param {HTMLElement} container - 表单容器
 * @param {Object} schema - JSON Schema
 * @returns {Object} 参数对象
 */
function collectFormData(container, schema) {
    if (!schema || !schema.properties) {
        return {};
    }

    const properties = schema.properties;
    const required = schema.required || [];
    const args = {};

    for (const [key, prop] of Object.entries(properties)) {
        const input = container.querySelector(`#test-param-${key}`);
        if (!input) continue;

        let value;

        // 根据类型收集值
        if (prop.type === 'boolean') {
            value = input.checked;
        } else if (prop.type === 'number' || prop.type === 'integer') {
            value = input.value ? parseFloat(input.value) : undefined;
        } else if (prop.type === 'array' || prop.type === 'object') {
            // 解析 JSON
            const jsonStr = input.value.trim();
            if (jsonStr) {
                try {
                    value = JSON.parse(jsonStr);
                } catch (error) {
                    throw new Error(`参数 "${key}" 的 JSON 格式无效: ${error.message}`);
                }
            }
        } else {
            // 字符串
            value = input.value;
        }

        // 必填验证
        if (required.includes(key) && (value === undefined || value === '' || value === null)) {
            throw new Error(`参数 "${key}" 为必填项`);
        }

        // 只添加非空值
        if (value !== undefined && value !== '' && value !== null) {
            args[key] = value;
        }
    }

    return args;
}

console.log('[Tool Manager] 📝 工具管理 UI 模块已加载');
