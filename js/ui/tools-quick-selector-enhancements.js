/**
 * 工具快速选择器 MCP 增强功能
 * 提供 MCP 工具按服务器分组显示
 */

import { state } from '../core/state.js';
import { getAllTools, setToolEnabled, isToolEnabled } from '../tools/manager.js';
import { showNotification } from './notifications.js';

/**
 * 获取服务器名称
 */
function getServerName(serverId) {
    const server = state.mcpServers?.find(s => s.id === serverId);
    return server?.name || serverId;
}

/**
 * 增强的渲染工具列表函数
 */
export function enhancedRenderQuickToolsList() {
    const container = document.querySelector('#tools-quick-list');
    if (!container) return;

    // 过滤掉隐藏工具
    const allTools = getAllTools().filter(t => !t.hidden);

    if (allTools.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无可用工具</div>';
        return;
    }

    // 按类型分组
    const builtinTools = allTools.filter(t => t.type === 'builtin');
    const mcpTools = allTools.filter(t => t.type === 'mcp');
    const customTools = allTools.filter(t => t.type === 'custom');

    // 对 MCP 工具按服务器分组
    const mcpToolsByServer = {};
    mcpTools.forEach(tool => {
        const serverId = tool.serverId || 'unknown';
        if (!mcpToolsByServer[serverId]) {
            mcpToolsByServer[serverId] = {
                tools: [],
                serverName: getServerName(serverId)
            };
        }
        mcpToolsByServer[serverId].tools.push(tool);
    });

    let html = '';

    // 渲染内置工具
    if (builtinTools.length > 0) {
        html += renderQuickToolGroup('内置工具', builtinTools);
    }

    // 渲染 MCP 工具（按服务器分组）
    if (Object.keys(mcpToolsByServer).length > 0) {
        html += '<div class="quick-tool-group">';
        html += `<div class="quick-tool-group-header">MCP 工具 (${mcpTools.length})</div>`;

        for (const [serverId, serverData] of Object.entries(mcpToolsByServer)) {
            html += renderMCPServerQuickGroup(serverId, serverData.serverName, serverData.tools);
        }

        html += '</div>';
    }

    // 渲染自定义工具
    if (customTools.length > 0) {
        html += renderQuickToolGroup('自定义工具', customTools);
    }

    container.innerHTML = html;

    // 绑定事件
    bindQuickSelectorEvents();
}

/**
 * 渲染标准工具组
 */
function renderQuickToolGroup(title, tools) {
    const toolsHtml = tools.map(tool => renderQuickToolItem(tool)).join('');

    return `
        <div class="quick-tool-group">
            <div class="quick-tool-group-header">${title} (${tools.length})</div>
            ${toolsHtml}
        </div>
    `;
}

/**
 * 渲染 MCP 服务器分组
 */
function renderMCPServerQuickGroup(serverId, serverName, tools) {
    const allEnabled = tools.every(tool => isToolEnabled(tool.id));
    const someEnabled = tools.some(tool => isToolEnabled(tool.id));

    const html = `
        <div class="quick-selector-mcp-group">
            <div class="quick-selector-mcp-header">
                <span class="quick-selector-mcp-name">${serverName}</span>
                <button class="quick-selector-mcp-toggle"
                        data-server-id="${serverId}">
                    ${allEnabled ? '全部禁用' : (someEnabled ? '全部启用' : '全部启用')}
                </button>
            </div>
            <div class="quick-selector-mcp-tools">
                ${tools.map(tool => renderQuickToolItem(tool, true)).join('')}
            </div>
        </div>
    `;

    return html;
}

/**
 * 渲染单个工具项
 */
function renderQuickToolItem(tool, isMCP = false) {
    const enabled = isToolEnabled(tool.id);
    const className = isMCP ? 'quick-tool-item mcp-sub-item' : 'quick-tool-item';

    return `
        <div class="${className}">
            <input type="checkbox"
                   id="quick-tool-${tool.id}"
                   class="quick-tool-switch"
                   data-tool-id="${tool.id}"
                   ${enabled ? 'checked' : ''}>
            <label for="quick-tool-${tool.id}" class="quick-tool-label">
                <span class="quick-tool-icon">${getQuickToolIcon(tool.type)}</span>
                ${tool.name || tool.id}
                ${tool.type === 'mcp' ? '<span class="tool-badge">MCP</span>' : ''}
            </label>
        </div>
    `;
}

/**
 * 获取工具图标
 */
function getQuickToolIcon(type) {
    const icons = {
        'builtin': '🔧',
        'mcp': '🔌',
        'custom': '⚙️'
    };
    return icons[type] || '📦';
}

/**
 * 绑定事件处理器
 */
function bindQuickSelectorEvents() {
    // 绑定工具开关
    const switches = document.querySelectorAll('.quick-tool-switch');
    switches.forEach(switchEl => {
        switchEl.addEventListener('change', (e) => {
            const toolId = e.target.dataset.toolId;
            const enabled = e.target.checked;
            setToolEnabled(toolId, enabled);
        });
    });

    // 绑定 MCP 批量操作按钮
    const toggleBtns = document.querySelectorAll('.quick-selector-mcp-toggle');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const serverId = btn.dataset.serverId;
            toggleAllServerToolsQuick(serverId);
        });
    });
}

/**
 * 批量切换服务器工具状态（快速选择器版本）
 */
function toggleAllServerToolsQuick(serverId) {
    const allTools = getAllTools().filter(t => t.type === 'mcp' && t.serverId === serverId);

    // 检查当前状态
    const allEnabled = allTools.every(tool => isToolEnabled(tool.id));
    const newState = !allEnabled;

    // 批量更新状态
    allTools.forEach(tool => {
        setToolEnabled(tool.id, newState);
    });

    // 重新渲染
    enhancedRenderQuickToolsList();

    // 更新主按钮状态
    updateQuickButtonState();
}

/**
 * 更新快速选择器按钮状态
 */
function updateQuickButtonState() {
    const toggleBtn = document.getElementById('toggle-tools');
    if (!toggleBtn) return;

    const enabledTools = getAllTools().filter(t => !t.hidden && isToolEnabled(t.id));
    const totalTools = getAllTools().filter(t => !t.hidden).length;

    const badgeEl = toggleBtn.querySelector('.tools-badge') || createBadge();
    badgeEl.textContent = `${enabledTools.length}/${totalTools}`;
    badgeEl.style.display = enabledTools.length > 0 ? 'flex' : 'none';

    if (!toggleBtn.querySelector('.tools-badge')) {
        toggleBtn.appendChild(badgeEl);
    }

    toggleBtn.classList.toggle('has-enabled', enabledTools.length > 0);
}

/**
 * 创建徽章元素
 */
function createBadge() {
    const badge = document.createElement('span');
    badge.className = 'tools-badge';
    badge.style.cssText = `
        position: absolute;
        top: -4px;
        right: -4px;
        background: var(--md-blue);
        color: white;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
    `;
    return badge;
}

/**
 * 初始化增强功能
 */
export function initQuickSelectorEnhancements() {
    console.log('[Quick Selector MCP] 初始化增强功能...');

    // 等待原始选择器初始化
    const checkAndEnhance = () => {
        const container = document.querySelector('#tools-quick-list');
        if (!container) {
            setTimeout(checkAndEnhance, 100);
            return;
        }

        // 监听选择器打开事件
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const panel = document.querySelector('.tools-quick-selector');
                    if (panel && panel.classList.contains('open')) {
                        setTimeout(enhancedRenderQuickToolsList, 0);
                    }
                }
            });
        });

        const panel = document.querySelector('.tools-quick-selector');
        if (panel) {
            observer.observe(panel, { attributes: true });
        }

        // 监听工具状态变化
        document.addEventListener('tool:enabled:changed', () => {
            if (document.querySelector('.tools-quick-selector.open')) {
                enhancedRenderQuickToolsList();
            }
            updateQuickButtonState();
        });

        // 初始更新按钮状态
        updateQuickButtonState();

        console.log('[Quick Selector MCP] 增强功能已初始化');
    };

    checkAndEnhance();
}

// 导出供调试
window.enhancedRenderQuickToolsList = enhancedRenderQuickToolsList;