/**
 * 工具管理器 MCP 增强功能
 * 提供 MCP 工具分组和批量操作功能
 */

import { state } from '../core/state.js';
import { getAllTools, setToolEnabled, isToolEnabled } from '../tools/manager.js';
import { showNotification } from './notifications.js';

// 保存原始的 renderToolsList 函数
let originalRenderToolsList = null;

/**
 * 获取服务器名称
 */
function getServerName(serverId) {
    const server = state.mcpServers?.find(s => s.id === serverId);
    return server?.name || serverId;
}

/**
 * 渲染 MCP 服务器分组
 */
function renderMCPServerGroup(serverId, serverName, tools) {
    const allEnabled = tools.every(tool => isToolEnabled(tool.id));
    const someEnabled = tools.some(tool => isToolEnabled(tool.id));

    const html = `
        <div class="mcp-server-group" data-server-id="${serverId}">
            <div class="mcp-server-header">
                <div class="mcp-server-info">
                    <svg class="collapse-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M6 10l4-4-4-4v8z"/>
                    </svg>
                    <span class="mcp-server-name">${serverName}</span>
                    <span class="mcp-server-count">(${tools.length})</span>
                </div>
                <div class="mcp-batch-actions">
                    <button class="mcp-batch-btn"
                            data-action="toggle-all"
                            data-server-id="${serverId}">
                        ${allEnabled ? '全部禁用' : (someEnabled ? '全部启用' : '全部启用')}
                    </button>
                </div>
            </div>
            <div class="mcp-tools-container">
                ${tools.map(tool => renderToolItem(tool)).join('')}
            </div>
        </div>
    `;

    return html;
}

/**
 * 渲染单个工具项
 */
function renderToolItem(tool) {
    const enabled = isToolEnabled(tool.id);
    const iconHtml = getToolIcon(tool.id, tool.type);

    return `
        <div class="tool-item ${enabled ? 'enabled' : ''}"
             data-tool-id="${tool.id}"
             data-tool-type="${tool.type}">
            <div class="tool-info">
                <div class="tool-icon">
                    ${iconHtml}
                </div>
                <span class="tool-name">${tool.name || tool.id}</span>
            </div>
            <input type="checkbox"
                   class="tool-enable-switch"
                   data-tool-id="${tool.id}"
                   ${enabled ? 'checked' : ''}>
        </div>
    `;
}

/**
 * 获取工具图标（复用原有逻辑）
 */
function getToolIcon(toolId, type) {
    // 内置工具图标映射
    const iconMap = {
        'web_search': 'globe',
        'calculator': 'barChart',
        'datetime': 'clock',
        'unit_converter': 'barChart',
        'text_formatter': 'type',
        'random_generator': 'star'
    };

    // MCP 工具使用插头图标
    if (type === 'mcp') {
        return '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM8 5a3 3 0 100 6 3 3 0 000-6zm0 1.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>';
    }

    // 自定义工具使用齿轮图标
    if (type === 'custom') {
        return '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319z"/></svg>';
    }

    // 其他使用默认图标
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/></svg>';
}

/**
 * 增强的渲染工具列表函数
 */
function enhancedRenderToolsList() {
    const modal = document.getElementById('tool-manager-modal');
    if (!modal) return;

    const listContainer = modal.querySelector('#tools-list-container');
    if (!listContainer) return;

    // 过滤掉 hidden 工具
    const allTools = getAllTools().filter(t => !t.hidden);

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

    // 渲染内容
    let html = renderToolGroup('内置工具', builtinTools, 'builtin');

    // 渲染 MCP 工具（按服务器分组）
    if (Object.keys(mcpToolsByServer).length > 0) {
        html += '<div class="tool-group">';
        html += '<div class="tool-group-header">';
        html += '<span class="tool-group-title">MCP 工具</span>';
        html += `<span class="tool-group-count">(${mcpTools.length})</span>`;
        html += '</div>';
        html += '<div class="tool-group-items">';

        for (const [serverId, serverData] of Object.entries(mcpToolsByServer)) {
            html += renderMCPServerGroup(serverId, serverData.serverName, serverData.tools);
        }

        html += '</div>';
        html += '</div>';
    }

    html += renderToolGroup('自定义工具', customTools, 'custom');

    listContainer.innerHTML = html;

    // 绑定所有事件
    bindEnhancedEvents();
}

/**
 * 渲染标准工具组（复用原有结构）
 */
function renderToolGroup(title, tools, type) {
    if (tools.length === 0) return '';

    const toolsHtml = tools.map(tool => {
        const enabled = isToolEnabled(tool.id);
        const iconHtml = getToolIcon(tool.id, type);

        return `
            <div class="tool-item ${enabled ? 'enabled' : ''}"
                 data-tool-id="${tool.id}"
                 data-tool-type="${type}">
                <div class="tool-info">
                    <div class="tool-icon">
                        ${iconHtml}
                    </div>
                    <span class="tool-name">${tool.name || tool.id}</span>
                </div>
                <input type="checkbox"
                       class="tool-enable-switch"
                       data-tool-id="${tool.id}"
                       ${enabled ? 'checked' : ''}>
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
 * 绑定增强的事件处理器
 */
function bindEnhancedEvents() {
    const modal = document.getElementById('tool-manager-modal');
    if (!modal) return;

    // 绑定工具项点击事件
    const toolItems = modal.querySelectorAll('.tool-item');
    toolItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // 如果点击的是开关，不处理
            if (e.target.classList.contains('tool-enable-switch')) return;

            const toolId = item.dataset.toolId;
            selectTool(toolId);
        });
    });

    // 绑定启用开关
    const enableSwitches = modal.querySelectorAll('.tool-enable-switch');
    enableSwitches.forEach(switchEl => {
        switchEl.addEventListener('change', (e) => {
            e.stopPropagation();
            const toolId = e.target.dataset.toolId;
            const enabled = e.target.checked;
            setToolEnabled(toolId, enabled);
        });
    });

    // 绑定 MCP 服务器折叠/展开
    const serverHeaders = modal.querySelectorAll('.mcp-server-header');
    serverHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            // 如果点击的是批量操作按钮，不处理折叠
            if (e.target.classList.contains('mcp-batch-btn')) return;

            const serverGroup = header.closest('.mcp-server-group');
            serverGroup.classList.toggle('collapsed');
        });
    });

    // 绑定批量操作按钮
    const batchBtns = modal.querySelectorAll('.mcp-batch-btn');
    batchBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const serverId = btn.dataset.serverId;
            const action = btn.dataset.action;

            if (action === 'toggle-all') {
                toggleAllServerTools(serverId);
            }
        });
    });
}

/**
 * 选择工具（触发详情显示）
 */
function selectTool(toolId) {
    // 调用原有的选择逻辑
    const event = new CustomEvent('tool-selected', { detail: { toolId } });
    document.dispatchEvent(event);
}

/**
 * 批量切换服务器工具状态
 */
function toggleAllServerTools(serverId) {
    const allTools = getAllTools().filter(t => t.type === 'mcp' && t.serverId === serverId);

    // 检查当前状态
    const allEnabled = allTools.every(tool => isToolEnabled(tool.id));
    const newState = !allEnabled;

    // 批量更新状态
    allTools.forEach(tool => {
        setToolEnabled(tool.id, newState);
    });

    // 显示通知
    const server = state.mcpServers?.find(s => s.id === serverId);
    const serverName = server?.name || serverId;
    showNotification(
        `已${newState ? '启用' : '禁用'} ${serverName} 的所有工具 (${allTools.length} 个)`,
        'success'
    );

    // 重新渲染列表
    enhancedRenderToolsList();
}

/**
 * 初始化增强功能
 */
export function initToolManagerMCPEnhancements() {
    console.log('[Tool Manager MCP] 初始化 MCP 增强功能...');

    // 等待原始模块加载
    const checkAndEnhance = () => {
        const modal = document.getElementById('tool-manager-modal');
        if (!modal) {
            setTimeout(checkAndEnhance, 100);
            return;
        }

        // 替换渲染函数
        if (window.renderToolsList && !originalRenderToolsList) {
            originalRenderToolsList = window.renderToolsList;
            window.renderToolsList = enhancedRenderToolsList;
        }

        // 监听工具管理器打开事件，确保增强功能生效
        document.addEventListener('tool-manager-opened', () => {
            setTimeout(enhancedRenderToolsList, 0);
        });

        // 监听工具状态变化事件
        document.addEventListener('tool:enabled:changed', () => {
            enhancedRenderToolsList();
        });

        console.log('[Tool Manager MCP] MCP 增强功能已初始化');
    };

    checkAndEnhance();
}

// 导出供调试
window.toggleAllServerTools = toggleAllServerTools;