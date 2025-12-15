/**
 * 快捷工具选择器
 * 提供对话中快速启用/禁用工具的 Popover 面板
 */

import { eventBus } from '../core/events.js';
import { state } from '../core/state.js';
import { getIcon } from '../utils/icons.js';
import { getAllTools, isToolEnabled, setToolEnabled } from '../tools/manager.js';

let selectorPanel = null;
let isOpen = false;
let removeFocusTrap = null;

// ========== 辅助函数 ==========

/**
 * 创建焦点陷阱（Focus Trap）- WCAG 2.4.3 合规
 * 确保 Tab 键导航被限制在选择器内，防止焦点逃逸到背景内容
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
 * 初始化快捷工具选择器
 */
export function initToolsQuickSelector() {
    const toggleBtn = document.getElementById('toggle-tools');
    if (!toggleBtn) {
        console.warn('[ToolsQuickSelector] 未找到工具按钮 #toggle-tools');
        return;
    }

    // 创建选择器面板
    createSelectorPanel();

    // 点击按钮切换面板
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) {
            closeSelector();
        } else {
            openSelector();
        }
    });

    // 点击外部区域关闭
    document.addEventListener('click', (e) => {
        if (isOpen && selectorPanel && !selectorPanel.contains(e.target) && !toggleBtn.contains(e.target)) {
            closeSelector();
        }
    });

    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
        if (isOpen && e.key === 'Escape') {
            closeSelector();
        }
    });

    // 监听工具状态变化
    eventBus.on('tool:enabled:changed', () => {
        renderToolsList();
        updateButtonState();
    });
    eventBus.on('tool:registered', renderToolsList);
    eventBus.on('tool:removed', renderToolsList);

    // ✅ 初始化按钮状态（启动时恢复工具状态后需要更新按钮颜色）
    updateButtonState();

    console.log('[ToolsQuickSelector] ✅ 快捷工具选择器已初始化');
}

/**
 * 创建选择器面板 DOM
 */
function createSelectorPanel() {
    selectorPanel = document.createElement('div');
    selectorPanel.className = 'tools-quick-selector';
    selectorPanel.setAttribute('role', 'dialog');
    selectorPanel.setAttribute('aria-label', '工具选择器');

    selectorPanel.innerHTML = `
        <div class="selector-header">
            <span class="selector-title">
                启用的工具
                (<span id="enabled-count">0</span>/<span id="total-count">0</span>)
            </span>
            <button class="close-selector" aria-label="关闭">×</button>
        </div>
        <input type="search"
               class="selector-search"
               placeholder="搜索工具..."
               aria-label="搜索工具">
        <div class="tools-list-container" role="group" aria-label="工具列表">
            <!-- 动态生成 -->
        </div>
        <div class="tools-quick-actions">
            <button class="quick-action-btn" id="select-all-tools">全选</button>
            <button class="quick-action-btn" id="deselect-all-tools">全不选</button>
            <button class="quick-action-btn primary" id="open-tools-manage">
                ${getIcon('settings', { size: 14 })} 管理
            </button>
        </div>
    `;

    // 插入到工具按钮的父容器
    const toggleBtn = document.getElementById('toggle-tools');
    const parentContainer = toggleBtn.parentElement;
    parentContainer.style.position = 'relative';
    parentContainer.appendChild(selectorPanel);

    // 绑定事件
    bindSelectorEvents();
}

/**
 * 打开选择器
 */
function openSelector() {
    renderToolsList();
    selectorPanel.classList.add('active');
    isOpen = true;

    // 创建焦点陷阱（WCAG 2.4.3 合规）
    removeFocusTrap = createFocusTrap(selectorPanel);

    // 聚焦搜索框
    setTimeout(() => {
        const searchInput = selectorPanel.querySelector('.selector-search');
        if (searchInput) {
            searchInput.focus();
        }
    }, 100);

    eventBus.emit('tools:selector:opened');
}

/**
 * 关闭选择器
 */
function closeSelector() {
    selectorPanel.classList.remove('active');
    isOpen = false;

    // 移除焦点陷阱
    if (removeFocusTrap) {
        removeFocusTrap();
        removeFocusTrap = null;
    }

    // 清空搜索
    const searchInput = selectorPanel.querySelector('.selector-search');
    if (searchInput) {
        searchInput.value = '';
        filterTools('');
    }

    eventBus.emit('tools:selector:closed');
}

/**
 * 渲染工具列表
 */
function renderToolsList() {
    const tools = getAllTools();
    const container = selectorPanel.querySelector('.tools-list-container');

    // 按类型分组
    const groups = {
        builtin: tools.filter(t => t.type === 'builtin'),
        mcp: tools.filter(t => t.type === 'mcp'),
        custom: tools.filter(t => t.type === 'custom')
    };

    let html = '';

    // 内置工具
    if (groups.builtin.length > 0) {
        html += renderToolsGroup('内置工具', getIcon('package', { size: 14 }), groups.builtin);
    }

    // MCP 工具
    if (groups.mcp.length > 0) {
        html += renderToolsGroup('MCP 工具', getIcon('plug', { size: 14 }), groups.mcp);
    }

    // 自定义工具
    if (groups.custom.length > 0) {
        html += renderToolsGroup('自定义工具', getIcon('star', { size: 14 }), groups.custom);
    }

    if (html === '') {
        html = '<p class="empty-state">暂无可用工具<br>点击下方"管理"添加工具</p>';
    }

    container.innerHTML = html;

    // 更新统计
    updateToolsCount();
}

/**
 * 渲染工具组
 */
function renderToolsGroup(groupName, groupIcon, tools) {
    const enabledCount = tools.filter(t => isToolEnabled(t.id)).length;
    const totalCount = tools.length;

    let html = `
        <div class="tools-group">
            <div class="tools-group-title">
                <span class="group-icon">${groupIcon}</span>
                <span class="group-name">${groupName}</span>
                <span class="group-count">(${enabledCount}/${totalCount})</span>
            </div>
    `;

    tools.forEach(tool => {
        const toolId = tool.id || '';
        const toolName = tool.name || '未命名工具';
        const toolIcon = tool.icon || '🔧';
        const enabled = isToolEnabled(toolId);
        const isMCP = tool.type === 'mcp';

        html += `
            <label class="tool-checkbox-item" data-tool-id="${toolId}">
                <input type="checkbox"
                       data-tool-id="${toolId}"
                       ${enabled ? 'checked' : ''}
                       aria-label="${toolName}">
                <span class="checkbox-custom" aria-hidden="true"></span>
                <span class="tool-icon">${toolIcon}</span>
                <span class="tool-name">${toolName}</span>
                ${isMCP ? '<span class="tool-badge mcp">MCP</span>' : ''}
            </label>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * 绑定选择器事件
 */
function bindSelectorEvents() {
    // 关闭按钮
    const closeBtn = selectorPanel.querySelector('.close-selector');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSelector);
    }

    // 全选
    const selectAllBtn = selectorPanel.querySelector('#select-all-tools');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            toggleAllTools(true);
        });
    }

    // 全不选
    const deselectAllBtn = selectorPanel.querySelector('#deselect-all-tools');
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            toggleAllTools(false);
        });
    }

    // 打开管理界面
    const manageBtn = selectorPanel.querySelector('#open-tools-manage');
    if (manageBtn) {
        manageBtn.addEventListener('click', () => {
            closeSelector();
            eventBus.emit('tools:manage:open');
        });
    }

    // 搜索
    const searchInput = selectorPanel.querySelector('.selector-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterTools(e.target.value);
        });
    }

    // 工具复选框变化（事件委托）
    const listContainer = selectorPanel.querySelector('.tools-list-container');
    if (listContainer) {
        listContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                const toolId = e.target.dataset.toolId;
                const enabled = e.target.checked;
                toggleTool(toolId, enabled);
            }
        });
    }
}

/**
 * 切换工具启用状态
 */
function toggleTool(toolId, enabled) {
    // 使用官方 API
    setToolEnabled(toolId, enabled);

    // manager.js 会自动发布事件，无需手动发布

    // 更新统计和按钮状态
    updateToolsCount();
    updateButtonState();

    console.log(`[ToolsQuickSelector] ${enabled ? '启用' : '禁用'}工具: ${toolId}`);
}

/**
 * 全选/全不选
 */
function toggleAllTools(enabled) {
    const checkboxes = selectorPanel.querySelectorAll('input[type="checkbox"][data-tool-id]');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked !== enabled) {
            checkbox.checked = enabled;
            const toolId = checkbox.dataset.toolId;
            if (toolId) {
                toggleTool(toolId, enabled);
            }
        }
    });
}

/**
 * 更新工具计数
 */
function updateToolsCount() {
    const tools = getAllTools();
    const enabledCount = tools.filter(t => isToolEnabled(t.id)).length;
    const totalCount = tools.length;

    const enabledEl = selectorPanel.querySelector('#enabled-count');
    const totalEl = selectorPanel.querySelector('#total-count');

    if (enabledEl) enabledEl.textContent = enabledCount;
    if (totalEl) totalEl.textContent = totalCount;
}

/**
 * 更新按钮激活状态
 */
function updateButtonState() {
    const tools = getAllTools();
    const hasEnabled = tools.some(t => isToolEnabled(t.id));
    const toggleBtn = document.getElementById('toggle-tools');

    if (toggleBtn) {
        toggleBtn.classList.toggle('active', hasEnabled);
    }
}

/**
 * 搜索过滤工具
 */
function filterTools(query) {
    const items = selectorPanel.querySelectorAll('.tool-checkbox-item');
    const lowerQuery = query.toLowerCase();

    items.forEach(item => {
        const toolNameEl = item.querySelector('.tool-name');
        if (toolNameEl) {
            const toolName = toolNameEl.textContent.toLowerCase();
            const matches = toolName.includes(lowerQuery);
            item.style.display = matches ? 'flex' : 'none';
        }
    });

    // 隐藏空组
    const groups = selectorPanel.querySelectorAll('.tools-group');
    groups.forEach(group => {
        const visibleItems = Array.from(group.querySelectorAll('.tool-checkbox-item')).filter(item => {
            return item.style.display !== 'none';
        });
        group.style.display = visibleItems.length > 0 ? 'block' : 'none';
    });
}
