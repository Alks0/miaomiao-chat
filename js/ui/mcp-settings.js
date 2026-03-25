/**
 * MCP 服务器配置 UI
 * 提供 MCP 服务器的添加、删除、连接管理界面
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { mcpClient, detectPlatform } from '../tools/mcp/client.js';
import { saveMCPServer, deleteMCPServer } from '../state/storage.js';
import { showNotification } from './notifications.js';
import { showConfirmDialog } from '../utils/dialogs.js';
import { getIcon } from '../utils/icons.js';
import {
    standardToInternal,
    internalToStandard,
    validateStandardConfig,
    generateTemplate,
    getAvailableTemplates
} from '../tools/mcp/config-converter.js';

const platform = detectPlatform();

// 模态框相关变量
let modal = null;
let isFormOpen = false;
let removeFocusTrap = null;
let isInitialized = false; // 防止重复初始化

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
 * 初始化 MCP 设置 UI
 */
export function initMCPSettings() {
    // 防止重复初始化
    if (isInitialized) {
        console.log('[MCP Settings] ⚠️ 已初始化，跳过');
        return;
    }

    console.log('[MCP Settings] ⚙️ 初始化...');

    modal = document.getElementById('mcp-settings-modal');
    if (!modal) {
        console.error('[MCP Settings] 未找到模态框 #mcp-settings-modal');
        return;
    }

    // 绑定顶部按钮
    const toggleBtn = document.getElementById('mcp-settings-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', openModal);
    } else {
        console.warn('[MCP Settings] 未找到触发按钮 #mcp-settings-toggle');
    }

    // 绑定模态框事件
    setupModalEvents();

    // 绑定表单事件
    bindFormEvents();

    // 监听事件
    setupEventListeners();

    // 初始化状态
    if (!state.mcpServers) {
        state.mcpServers = [];
    }

    isInitialized = true; // 标记为已初始化
    console.log('[MCP Settings] 初始化完成');
}

/**
 * 设置模态框事件
 * 性能优化：缓存 DOM 查询
 */
function setupModalEvents() {
    // 优化：一次性查询所有需要的元素
    const closeBtn = modal.querySelector('.close-mcp-settings');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
            if (isFormOpen) {
                hideServerForm();
            } else {
                closeModal();
            }
        }
    });
}

/**
 * 打开模态框
 */
export function openModal() {
    if (!modal) return;
    modal.classList.add('open');
    renderPlatformInfo();
    renderServerList();

    // 创建焦点陷阱（WCAG 2.4.3 合规）
    removeFocusTrap = createFocusTrap(modal);
}

/**
 * 关闭模态框
 */
export function closeModal() {
    if (!modal) return;

    if (isFormOpen) {
        showConfirmDialog('表单未保存，确定关闭吗？').then(confirmed => {
            if (confirmed) {
                hideServerForm();
                modal.classList.remove('open');

                // 移除焦点陷阱
                if (removeFocusTrap) {
                    removeFocusTrap();
                    removeFocusTrap = null;
                }
            }
        });
    } else {
        modal.classList.remove('open');

        // 移除焦点陷阱
        if (removeFocusTrap) {
            removeFocusTrap();
            removeFocusTrap = null;
        }
    }
}

/**
 * 渲染平台信息
 * 性能优化：缓存 DOM 查询
 */
function renderPlatformInfo() {
    // 优化：一次性查询所有元素
    const badge = modal.querySelector('#mcp-platform-badge');
    const warning = modal.querySelector('#mcp-platform-warning');

    if (badge) {
        badge.textContent = getPlatformLabel(platform);
        badge.className = `platform-badge platform-${platform}`;
    }

    if (warning) {
        warning.innerHTML = getPlatformWarning(platform);
    }
}

/**
 * 显示服务器表单
 */
function showServerForm() {
    const form = modal.querySelector('#mcp-server-form');
    if (!form) {
        console.error('[MCP Settings] 未找到服务器表单');
        return;
    }

    // 创建表单内容
    form.innerHTML = `
        <h4>添加 MCP 服务器</h4>

        <div class="form-group">
            <label>服务器类型</label>
            <select id="mcp-server-type" class="form-control">
                <option value="remote">远程服务器 (HTTP/WebSocket)</option>
                ${platform === 'electron' ? '<option value="local">本地服务器 (命令行)</option>' : ''}
            </select>
        </div>

        <div class="form-group">
            <label>服务器名称 <span class="required-indicator">*</span></label>
            <input type="text" id="mcp-server-name" class="form-control" placeholder="例如: GitHub MCP" required aria-required="true">
            <span class="error-message" id="mcp-server-name-error"></span>
        </div>

        <!-- 远程服务器配置 -->
        <div id="mcp-remote-config">
            <div class="form-group">
                <label>服务器 URL <span class="required-indicator">*</span></label>
                <input type="text" id="mcp-server-url" class="form-control" placeholder="https://mcp.example.com 或 ws://mcp.example.com" required aria-required="true">
                <span class="error-message" id="mcp-server-url-error"></span>
            </div>

            <div class="form-group">
                <label>API Key (可选)</label>
                <input type="password" id="mcp-server-apikey" class="form-control" placeholder="mcp_sk_...">
            </div>
        </div>

        <!-- 本地服务器配置（仅 Electron） -->
        ${platform === 'electron' ? `
        <div id="mcp-local-config" style="display: none;">
            <div class="form-group">
                <label>启动命令 <span class="required-indicator">*</span></label>
                <input type="text" id="mcp-server-command" class="form-control" placeholder="npx" required aria-required="true">
                <span class="error-message" id="mcp-server-command-error"></span>
                <small class="form-text text-muted">例如: npx, node, python</small>
            </div>

            <div class="form-group">
                <label>命令参数</label>
                <input type="text" id="mcp-server-args" class="form-control" placeholder="-y @modelcontextprotocol/server-filesystem /path/to/folder">
                <small class="form-text text-muted">多个参数用空格分隔</small>
            </div>

            <div class="form-group">
                <label>工作目录 (可选)</label>
                <input type="text" id="mcp-server-cwd" class="form-control" placeholder="/home/user">
            </div>
        </div>
        ` : ''}

        <div class="form-actions">
            <button id="mcp-save-server-btn" class="btn btn-success">保存</button>
            <button id="mcp-cancel-server-btn" class="btn btn-secondary">取消</button>
        </div>
    `;

    form.style.display = 'block';
    isFormOpen = true;

    // 设置表单内部的验证事件
    setupInlineValidation();
}

/**
 * 隐藏服务器表单
 */
function hideServerForm() {
    const form = modal.querySelector('#mcp-server-form');
    if (form) {
        form.style.display = 'none';
        form.innerHTML = '';
    }
    isFormOpen = false;
}

/**
 * 绑定表单事件
 */
function bindFormEvents() {
    // 使用事件委托，在 modal 级别监听所有点击事件
    modal.addEventListener('click', (e) => {
        // 添加服务器按钮
        if (e.target.id === 'mcp-add-server-btn' || e.target.closest('#mcp-add-server-btn')) {
            showServerForm();
        }
        // 保存按钮
        else if (e.target.id === 'mcp-save-server-btn' || e.target.closest('#mcp-save-server-btn')) {
            handleSaveServer();
        }
        // 取消按钮
        else if (e.target.id === 'mcp-cancel-server-btn' || e.target.closest('#mcp-cancel-server-btn')) {
            hideServerForm();
        }
        // 导入配置按钮
        else if (e.target.id === 'mcp-import-config-btn' || e.target.closest('#mcp-import-config-btn')) {
            importMCPConfig();
        }
        // 导出配置按钮
        else if (e.target.id === 'mcp-export-config-btn' || e.target.closest('#mcp-export-config-btn')) {
            exportMCPConfig();
        }
        // 快速模板按钮
        else if (e.target.id === 'mcp-template-btn' || e.target.closest('#mcp-template-btn')) {
            showTemplateDialog();
        }
    });

    // 使用事件委托监听表单内的 change 事件
    modal.addEventListener('change', (e) => {
        // 服务器类型切换
        if (e.target.id === 'mcp-server-type') {
            const isLocal = e.target.value === 'local';
            toggleConfigSection(isLocal);
        }
    });
}

/**
 * 设置内联验证
 */
function setupInlineValidation() {
    // 服务器名称验证
    const nameInput = modal.querySelector('#mcp-server-name');
    if (nameInput) {
        nameInput.addEventListener('blur', () => validateServerName(nameInput));
        nameInput.addEventListener('input', () => clearFieldError('mcp-server-name'));
    }

    // URL 验证
    const urlInput = modal.querySelector('#mcp-server-url');
    if (urlInput) {
        urlInput.addEventListener('blur', () => validateServerURL(urlInput));
        urlInput.addEventListener('input', () => clearFieldError('mcp-server-url'));
    }

    // 命令验证
    const commandInput = modal.querySelector('#mcp-server-command');
    if (commandInput) {
        commandInput.addEventListener('blur', () => validateServerCommand(commandInput));
        commandInput.addEventListener('input', () => clearFieldError('mcp-server-command'));
    }
}

/**
 * 验证服务器名称
 */
function validateServerName(input) {
    const value = input.value.trim();
    if (!value) {
        setFieldError('mcp-server-name', '请输入服务器名称');
        return false;
    }
    clearFieldError('mcp-server-name');
    return true;
}

/**
 * 验证服务器 URL
 */
function validateServerURL(input) {
    const value = input.value.trim();
    if (!value) {
        setFieldError('mcp-server-url', '请输入服务器 URL');
        return false;
    }

    // 验证 URL 格式（支持 http/https/ws/wss）
    const urlPattern = /^(https?|wss?):\/\/.+/i;
    if (!urlPattern.test(value)) {
        setFieldError('mcp-server-url', '请输入有效的 URL（支持 http://, https://, ws://, wss://）');
        return false;
    }

    clearFieldError('mcp-server-url');
    return true;
}

/**
 * 验证启动命令
 */
function validateServerCommand(input) {
    const value = input.value.trim();
    if (!value) {
        setFieldError('mcp-server-command', '请输入启动命令');
        return false;
    }
    clearFieldError('mcp-server-command');
    return true;
}

/**
 * 设置字段错误
 */
function setFieldError(fieldId, message) {
    const input = modal.querySelector(`#${fieldId}`);
    const errorSpan = modal.querySelector(`#${fieldId}-error`);

    if (input) {
        input.classList.add('error');
        input.setAttribute('aria-invalid', 'true');
    }

    if (errorSpan) {
        errorSpan.textContent = message;
        errorSpan.style.display = 'block';
    }
}

/**
 * 清除字段错误
 */
function clearFieldError(fieldId) {
    const input = modal.querySelector(`#${fieldId}`);
    const errorSpan = modal.querySelector(`#${fieldId}-error`);

    if (input) {
        input.classList.remove('error');
        input.removeAttribute('aria-invalid');
    }

    if (errorSpan) {
        errorSpan.textContent = '';
        errorSpan.style.display = 'none';
    }
}

/**
 * 切换配置区域显示
 */
function toggleConfigSection(isLocal) {
    const remoteConfig = modal.querySelector('#mcp-remote-config');
    const localConfig = modal.querySelector('#mcp-local-config');

    if (remoteConfig) {
        remoteConfig.style.display = isLocal ? 'none' : 'block';
    }

    if (localConfig) {
        localConfig.style.display = isLocal ? 'block' : 'none';
    }
}

/**
 * 处理保存服务器
 */
async function handleSaveServer() {
    const type = modal.querySelector('#mcp-server-type').value;
    const nameInput = modal.querySelector('#mcp-server-name');
    const name = nameInput.value.trim();

    // 使用验证函数
    if (!validateServerName(nameInput)) {
        showNotification('请输入服务器名称', 'error');
        nameInput.focus();
        return;
    }

    const config = {
        id: `mcp_${Date.now()}`,
        name,
        type,
        enabled: true
    };

    if (type === 'remote') {
        const urlInput = modal.querySelector('#mcp-server-url');
        const url = urlInput.value.trim();
        const apiKey = modal.querySelector('#mcp-server-apikey').value.trim();

        // 使用验证函数
        if (!validateServerURL(urlInput)) {
            showNotification('请输入有效的服务器 URL', 'error');
            urlInput.focus();
            return;
        }

        config.url = url;
        if (apiKey) {
            config.apiKey = apiKey;
        }
    } else if (type === 'local') {
        const commandInput = modal.querySelector('#mcp-server-command');
        const command = commandInput.value.trim();
        const argsStr = modal.querySelector('#mcp-server-args').value.trim();
        const cwd = modal.querySelector('#mcp-server-cwd').value.trim();

        // 使用验证函数
        if (!validateServerCommand(commandInput)) {
            showNotification('请输入启动命令', 'error');
            commandInput.focus();
            return;
        }

        config.command = command;
        config.args = argsStr ? argsStr.split(/\s+/) : [];
        if (cwd) {
            config.cwd = cwd;
        }
    }

    // 先保存到 IndexedDB，成功后再添加到状态
    try {
        await saveMCPServer(config);

        // 保存成功后才添加到状态
        state.mcpServers.push(config);

        // 隐藏表单
        hideServerForm();

        // 重新渲染列表
        renderServerList();

        // 自动连接
        connectToServer(config.id);

        showNotification('服务器添加成功', 'success');
    } catch (error) {
        console.error('[MCP Settings] 保存服务器失败:', error);
        showNotification('保存失败，请重试', 'error');
        // 不需要回滚，因为状态还没添加
    }
}

/**
 * 渲染服务器列表
 */
function renderServerList() {
    if (!modal) return;

    const listContainer = modal.querySelector('#mcp-server-list');
    if (!listContainer) return;

    if (!state.mcpServers || state.mcpServers.length === 0) {
        listContainer.innerHTML = `
            <div class="mcp-empty-state">
                <p>暂无 MCP 服务器</p>
                <p class="text-muted">点击上方"添加服务器"按钮开始配置</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = state.mcpServers.map(server => createServerCard(server)).join('');

    // 绑定服务器卡片事件
    bindServerCardEvents();
}

/**
 * 创建服务器卡片
 */
function createServerCard(server) {
    const status = mcpClient.isConnected(server.id);
    const tools = mcpClient.getToolsByServer(server.id);
    const toolCount = tools.length;
    const retryCount = server.retryCount || 0;
    const retryText = retryCount > 0 ? `重试${retryCount > 1 ? ` (${retryCount})` : ''}` : '连接';

    return `
        <div class="mcp-server-card" data-server-id="${server.id}">
            <div class="mcp-server-header">
                <div class="mcp-server-title">
                    <h4>${server.name}</h4>
                    <span class="mcp-server-type-badge ${server.type}">${server.type === 'local' ? '本地' : '远程'}</span>
                </div>
                <div class="mcp-server-actions">
                    ${status ? `
                        <button class="btn btn-sm btn-warning mcp-disconnect-btn" data-server-id="${server.id}">断开</button>
                    ` : `
                        <button class="btn btn-sm btn-success mcp-connect-btn ${retryCount > 0 ? 'retry-btn' : ''}" data-server-id="${server.id}">${retryText}</button>
                    `}
                    <button class="btn btn-sm btn-danger mcp-delete-btn" data-server-id="${server.id}">删除</button>
                </div>
            </div>

            <div class="mcp-server-status">
                <span class="status-indicator ${status ? 'connected' : 'disconnected'}"></span>
                <span>${status ? '已连接' : '未连接'}</span>
                ${status ? `<span class="mcp-tool-count">(${toolCount} 个工具)</span>` : ''}
            </div>

            ${server.type === 'remote' ? `
                <div class="mcp-server-details">
                    <div><strong>URL:</strong> ${server.url}</div>
                    ${server.apiKey ? '<div><strong>API Key:</strong> ••••••••</div>' : ''}
                </div>
            ` : `
                <div class="mcp-server-details">
                    <div><strong>命令:</strong> ${server.command} ${(server.args || []).join(' ')}</div>
                    ${server.cwd ? `<div><strong>工作目录:</strong> ${server.cwd}</div>` : ''}
                </div>
            `}

            ${status && toolCount > 0 ? `
                <div class="mcp-tools-list">
                    <strong>可用工具:</strong>
                    <ul>
                        ${tools.map(tool => `<li>${tool.name} - ${tool.description || '无描述'}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * 绑定服务器卡片事件
 */
function bindServerCardEvents() {
    // 连接按钮
    modal.querySelectorAll('.mcp-connect-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const serverId = e.target.dataset.serverId;
            await connectToServer(serverId);
        });
    });

    // 断开按钮
    modal.querySelectorAll('.mcp-disconnect-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const serverId = e.target.dataset.serverId;
            await disconnectFromServer(serverId);
        });
    });

    // 删除按钮
    modal.querySelectorAll('.mcp-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const serverId = e.target.dataset.serverId;
            await deleteServer(serverId);
        });
    });
}

/**
 * 连接到服务器
 */
async function connectToServer(serverId) {
    const server = state.mcpServers.find(s => s.id === serverId);
    if (!server) {
        console.error(`[MCP Settings] 服务器不存在: ${serverId}`);
        return;
    }

    // 初始化重试计数
    if (!server.retryCount) {
        server.retryCount = 0;
    }

    // 显示加载状态（使用 loading class）
    const btn = modal.querySelector(`.mcp-connect-btn[data-server-id="${serverId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        // 保存原始文本以便恢复
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '连接中...';
    }

    // 监听重试事件，更新按钮文本
    const retryHandler = (data) => {
        if (data.serverId === serverId && btn) {
            btn.textContent = `重试中 (${data.attempt}/${data.maxRetries})`;
        }
    };
    eventBus.on('mcp:retry-attempt', retryHandler);

    const result = await mcpClient.connect(server);

    // 移除事件监听器
    eventBus.off('mcp:retry-attempt', retryHandler);

    if (result.success) {
        console.log(`[MCP Settings] 已连接: ${server.name}`);
        showNotification(`已连接到 ${server.name}`, 'success');
        // 重置重试计数，标记为启用
        server.retryCount = 0;
        server.enabled = true;

        // 保存到 IndexedDB
        try {
            await saveMCPServer(server);
        } catch (error) {
            console.error('[MCP Settings] 保存服务器状态失败:', error);
        }

        renderServerList(); // 刷新列表
    } else {
        console.error(`[MCP Settings] ❌ 连接失败: ${result.error}`);
        // 增加重试计数（仅在非重试耗尽的情况下）
        if (!result.retriesExhausted) {
            server.retryCount = (server.retryCount || 0) + 1;
        }

        // 保存到 IndexedDB
        try {
            await saveMCPServer(server);
        } catch (error) {
            console.error('[MCP Settings] 保存服务器状态失败:', error);
        }

        // 显示友好的错误消息
        const friendlyError = getErrorMessage(result.errorType, result.error);
        const errorMsg = result.retriesExhausted
            ? `${friendlyError}（已重试 ${server.retryCount} 次）`
            : friendlyError;

        showNotification(errorMsg, 'error');

        // 移除加载状态，更新按钮
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('loading');
            // 不可重试错误显示"配置"，可重试显示"重试"
            btn.textContent = result.retryable === false ? '检查配置' : '重试';
            btn.classList.add('retry-btn');
        }

        renderServerList(); // 刷新列表以显示重试按钮
    }
}

/**
 * 断开服务器连接
 */
async function disconnectFromServer(serverId) {
    await mcpClient.disconnect(serverId);

    // 持久化断开状态，防止重启后自动重连
    const server = state.mcpServers.find(s => s.id === serverId);
    if (server) {
        server.enabled = false;
        try {
            await saveMCPServer(server);
        } catch (error) {
            console.error('[MCP Settings] 保存断开状态失败:', error);
        }
    }

    renderServerList();
}

/**
 * 删除服务器
 */
async function deleteServer(serverId) {
    const server = state.mcpServers.find(s => s.id === serverId);
    if (!server) return;

    // 使用自定义确认对话框
    const confirmed = await showConfirmDialog(
        `确定要删除服务器 "${server.name}" 吗？`,
        '删除服务器'
    );

    if (!confirmed) {
        return;
    }

    // 先断开连接（必须等待断开完成，避免资源泄漏）
    if (mcpClient.hasConnection(serverId)) {
        try {
            await mcpClient.disconnect(serverId);
        } catch (error) {
            console.error('[MCP Settings] 断开连接失败:', error);
            // 即使断开失败，也继续删除（用户主动删除）
        }
    }

    // 从状态中移除
    state.mcpServers = state.mcpServers.filter(s => s.id !== serverId);

    // 从 IndexedDB 中删除
    try {
        await deleteMCPServer(serverId);
    } catch (error) {
        console.error('[MCP Settings] 删除服务器失败:', error);
        showNotification('删除失败，请重试', 'error');
        return;
    }

    // 刷新列表
    renderServerList();

    showNotification(`已删除服务器: ${server.name}`, 'info');
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
    // 监听连接/断开事件，刷新列表
    eventBus.on('mcp:connected', () => {
        renderServerList();
    });

    eventBus.on('mcp:disconnected', () => {
        renderServerList();
    });

    eventBus.on('mcp:tools-discovered', () => {
        renderServerList();
    });

    // 监听连接丢失事件
    eventBus.on('mcp:connection-lost', (data) => {
        console.warn(`[MCP Settings] ⚠️ 连接丢失: ${data.serverName}`);
        showNotification(`${getIcon('alertCircle', { size: 14 })} ${data.serverName} 连接断开，将在 5 秒后自动重连...`, 'warning');
        renderServerList();
    });

    // 监听重连失败事件
    eventBus.on('mcp:reconnect-failed', (data) => {
        console.error(`[MCP Settings] ❌ 自动重连失败: ${data.serverName}`);
        showNotification(`${getIcon('xCircle', { size: 14 })} ${data.serverName} 自动重连失败，请手动重试`, 'error');
        renderServerList();
    });

    // 监听 Electron 子进程重启事件
    if (window.electron) {
        // 服务器正在重启
        eventBus.on('mcp:server-restarting', (data) => {
            console.log(`[MCP Settings] 🔄 服务器重启中: ${data.serverId} (尝试 ${data.attempt})`);
            showNotification(`${getIcon('loader', { size: 14 })} MCP 服务器正在重启... (${data.attempt}/3)`, 'info');
        });

        // 服务器重启成功
        eventBus.on('mcp:server-restarted', (data) => {
            console.log(`[MCP Settings] 服务器重启成功: ${data.serverId}`);
            showNotification(`${getIcon('checkCircle', { size: 14 })} MCP 服务器已自动恢复`, 'success');
            renderServerList();
        });

        // 服务器重启失败
        eventBus.on('mcp:server-restart-failed', (data) => {
            console.error(`[MCP Settings] ❌ 服务器重启失败: ${data.serverId}`);
            showNotification(`${getIcon('xCircle', { size: 14 })} MCP 服务器重启失败，请手动重新连接`, 'error');
            renderServerList();
        });

        // 达到重启次数上限
        eventBus.on('mcp:restart-limit-exceeded', (data) => {
            console.error(`[MCP Settings] 🛑 达到重启上限: ${data.serverId}`);
            showNotification(`${getIcon('xCircle', { size: 14 })} MCP 服务器频繁崩溃，已停止自动重启`, 'error');
            renderServerList();
        });
    }
}

/**
 * 获取平台标签
 */
function getPlatformLabel(platform) {
    const labels = {
        'electron': 'Electron 桌面版',
        'web': 'Web 浏览器',
        'android': 'Android'
    };
    return labels[platform] || platform;
}

/**
 * 获取平台警告信息
 */
function getPlatformWarning(platform) {
    if (platform === 'web') {
        return `
            <div class="platform-warning web-warning">
                ${getIcon('alertCircle', { size: 14 })} Web 版本仅支持远程 MCP 服务器。如需使用本地 MCP，请下载 Electron 桌面版。
            </div>
        `;
    } else if (platform === 'android') {
        return `
            <div class="platform-warning android-warning">
                ${getIcon('alertCircle', { size: 14 })} Android 版本仅支持远程 MCP 服务器。如需使用本地 MCP，请使用 Electron 桌面版。
            </div>
        `;
    }
    return '';
}

/**
 * 获取友好的错误消息
 * @param {string} errorType - 错误类型
 * @param {string} rawError - 原始错误消息
 * @returns {string} 友好的错误消息
 */
function getErrorMessage(errorType, rawError) {
    const errorMessages = {
        'platform_unsupported': `${getIcon('xCircle', { size: 14 })} 当前平台不支持本地 MCP 服务器，请使用 Electron 桌面版`,
        'invalid_config': `${getIcon('xCircle', { size: 14 })} 配置错误：请检查 URL 或命令参数是否正确`,
        'auth_failed': `${getIcon('xCircle', { size: 14 })} 认证失败：请检查 API Key 是否正确`,
        'timeout': `${getIcon('clock', { size: 14 })} 连接超时：服务器可能未响应，请稍后重试`,
        'network_error': `${getIcon('globe', { size: 14 })} 网络错误：请检查网络连接或服务器地址`,
        'server_error': `${getIcon('settings', { size: 14 })} 服务器错误：MCP 服务器可能暂时不可用`,
        'unknown_error': `${getIcon('alertCircle', { size: 14 })} 未知错误：${rawError}`
    };

    return errorMessages[errorType] || errorMessages['unknown_error'];
}

// ========== 配置导入/导出功能 ==========

/**
 * 导出 MCP 配置为 JSON 文件
 */
export async function exportMCPConfig() {
    try {
        // 转换为标准格式
        const standardConfig = internalToStandard(state.mcpServers || []);

        // 生成 JSON 字符串（格式化，2 空格缩进）
        const jsonString = JSON.stringify(standardConfig, null, 2);

        // 创建 Blob
        const blob = new Blob([jsonString], { type: 'application/json' });

        // 生成文件名（带时间戳）
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `mcp-config-${timestamp}.json`;

        // 下载文件
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();

        // 清理 URL
        setTimeout(() => URL.revokeObjectURL(link.href), 100);

        showNotification(`${getIcon('download', { size: 14 })} 配置已导出: ${filename}`, 'success');
    } catch (error) {
        console.error('[MCP Settings] 导出配置失败:', error);
        showNotification(`${getIcon('xCircle', { size: 14 })} 导出配置失败: ${error.message}`, 'error');
    }
}

/**
 * 导入 MCP 配置 JSON 文件
 */
export async function importMCPConfig() {
    // 显示导入方式选择对话框
    const importMethod = await showImportMethodDialog();

    if (!importMethod) return;

    let jsonText;

    if (importMethod === 'file') {
        // 文件上传方式
        jsonText = await selectJsonFile();
    } else if (importMethod === 'paste') {
        // 粘贴 JSON 方式
        jsonText = await showJsonPasteDialog();
    }

    if (!jsonText) return;

    // 处理导入的 JSON
    await processImportedJson(jsonText);
}

/**
 * 显示导入方式选择对话框
 * @returns {Promise<'file'|'paste'|null>}
 */
async function showImportMethodDialog() {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'modal active';
        dialog.style.zIndex = '10002';

        dialog.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>${getIcon('upload', { size: 18 })} 导入 MCP 配置</h3>
                    <button class="modal-close" aria-label="关闭">&times;</button>
                </div>
                <div class="modal-body">
                    <p>请选择导入方式：</p>
                    <div class="import-method-options" style="margin-top: 16px; display: flex; flex-direction: column; gap: 12px;">
                        <button class="btn btn-primary" id="import-from-file" style="padding: 16px; text-align: left;">
                            ${getIcon('fileText', { size: 18 })} <strong>从文件上传</strong>
                            <small style="display: block; margin-top: 4px; opacity: 0.8;">选择本地 JSON 配置文件</small>
                        </button>
                        <button class="btn btn-primary" id="import-from-paste" style="padding: 16px; text-align: left;">
                            ${getIcon('clipboard', { size: 18 })} <strong>粘贴 JSON 内容</strong>
                            <small style="display: block; margin-top: 4px; opacity: 0.8;">直接粘贴或输入 JSON 配置</small>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const cleanup = () => {
            document.body.removeChild(dialog);
        };

        dialog.querySelector('#import-from-file').addEventListener('click', () => {
            cleanup();
            resolve('file');
        });

        dialog.querySelector('#import-from-paste').addEventListener('click', () => {
            cleanup();
            resolve('paste');
        });

        dialog.querySelector('.modal-close').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        dialog.querySelector('.modal-overlay').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });
    });
}

/**
 * 选择 JSON 文件
 * @returns {Promise<string|null>}
 */
async function selectJsonFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';

        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }

            try {
                const text = await file.text();
                resolve(text);
            } catch (error) {
                showNotification(`${getIcon('xCircle', { size: 14 })} 读取文件失败: ${error.message}`, 'error');
                resolve(null);
            }
        };

        input.click();
    });
}

/**
 * 显示 JSON 粘贴对话框
 * @returns {Promise<string|null>}
 */
async function showJsonPasteDialog() {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'modal active';
        dialog.style.zIndex = '10002';

        // 生成示例 JSON
        const exampleJson = `// 示例 JSON (stdio):
// {
//   "mcpServers": {
//     "stdio-server-example": {
//       "command": "npx",
//       "args": ["-y", "mcp-server-example"]
//     }
//   }
// }

// 示例 JSON (sse):
// {
//   "mcpServers": {
//     "sse-server-example": {
//       "type": "sse",
//       "url": "http://localhost:3000"
//     }
//   }
// }

// 示例 JSON (streamable-http):
// {
//   "mcpServers": {
//     "streamable-http-example": {
//       "type": "streamable-http",
//       "url": "http://localhost:3001/mcp",
//       "headers": {
//         "Content-Type": "application/json",
//         "Authorization": "Bearer your-token"
//       }
//     }
//   }
// }`;

        dialog.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 800px; max-height: 90vh;">
                <div class="modal-header">
                    <h3>${getIcon('clipboard', { size: 18 })} 从 JSON 导入</h3>
                    <button class="modal-close" aria-label="关闭">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 12px;">请从 MCP Servers 的介绍页面复制配置 JSON（优先使用 NPX 或 UVX 配置），并粘贴到输入框中</p>
                    <textarea
                        id="json-paste-textarea"
                        placeholder="粘贴 JSON 内容到这里..."
                        style="
                            width: 100%;
                            height: 400px;
                            padding: 12px;
                            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                            font-size: 13px;
                            line-height: 1.5;
                            background: var(--color-bg-code, #1e1e1e);
                            color: var(--md-text, #e0e0e0);
                            border: var(--border);
                            border-radius: 6px;
                            resize: vertical;
                            tab-size: 2;
                        "
                    >${exampleJson}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="json-paste-cancel">取消</button>
                    <button class="btn btn-primary" id="json-paste-confirm">确定</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const textarea = dialog.querySelector('#json-paste-textarea');
        const cleanup = () => {
            document.body.removeChild(dialog);
        };

        // 聚焦并选中示例文本
        setTimeout(() => {
            textarea.focus();
            textarea.select();
        }, 100);

        dialog.querySelector('#json-paste-confirm').addEventListener('click', () => {
            const content = textarea.value.trim();
            cleanup();
            resolve(content || null);
        });

        dialog.querySelector('#json-paste-cancel').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        dialog.querySelector('.modal-close').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        dialog.querySelector('.modal-overlay').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });
    });
}

/**
 * 智能移除 JSON 注释（避免删除字符串中的注释符号）
 * @param {string} jsonText - 带注释的 JSON 文本
 * @returns {string} 清理后的 JSON
 */
function removeJsonComments(jsonText) {
    const lines = jsonText.split('\n');
    const result = [];
    let inMultilineComment = false;

    for (const line of lines) {
        let cleanLine = '';
        let inString = false;
        let stringChar = null;
        let i = 0;

        while (i < line.length) {
            const char = line[i];
            const nextChar = line[i + 1];

            // 处理多行注释
            if (inMultilineComment) {
                if (char === '*' && nextChar === '/') {
                    inMultilineComment = false;
                    i += 2;
                    continue;
                }
                i++;
                continue;
            }

            // 处理字符串
            if ((char === '"' || char === "'") && (i === 0 || line[i - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                    stringChar = null;
                }
                cleanLine += char;
                i++;
                continue;
            }

            // 在字符串内，直接添加
            if (inString) {
                cleanLine += char;
                i++;
                continue;
            }

            // 检测注释开始
            if (char === '/' && nextChar === '/') {
                // 单行注释，跳过本行剩余部分
                break;
            }

            if (char === '/' && nextChar === '*') {
                // 多行注释开始
                inMultilineComment = true;
                i += 2;
                continue;
            }

            cleanLine += char;
            i++;
        }

        // 只保留非空行
        if (cleanLine.trim()) {
            result.push(cleanLine);
        }
    }

    return result.join('\n');
}

/**
 * 处理导入的 JSON 内容
 * @param {string} jsonText - JSON 文本
 */
async function processImportedJson(jsonText) {
    try {
        // 智能移除注释（避免删除字符串中的注释符号）
        const cleanJson = removeJsonComments(jsonText);

        // 解析 JSON
        let configData;
        try {
            configData = JSON.parse(cleanJson);
        } catch {
            throw new Error('JSON 格式错误，请检查内容是否正确');
        }

        // 验证配置
        const validation = validateStandardConfig(configData);
        if (!validation.valid) {
            const errorList = validation.errors.join('\n• ');
            throw new Error(`配置验证失败:\n• ${errorList}`);
        }

        // 转换为内部格式
        const servers = standardToInternal(configData);

        if (servers.length === 0) {
            throw new Error('配置文件中没有有效的服务器');
        }

        // 询问用户是替换还是合并
        const action = await showImportMergeDialog(servers.length);

        if (action === 'cancel') {
            return;
        }

        // 替换模式：清空现有配置
        if (action === 'replace') {
            // 断开所有连接（使用 connections Map 而不是 server.connected）
            for (const server of state.mcpServers || []) {
                if (mcpClient.hasConnection(server.id)) {
                    try {
                        await mcpClient.disconnect(server.id);
                    } catch (error) {
                        console.error(`[MCP Settings] 断开服务器 ${server.id} 失败:`, error);
                        // 继续处理其他服务器
                    }
                }
            }

            // 删除所有服务器
            for (const server of state.mcpServers || []) {
                try {
                    await deleteMCPServer(server.id);
                } catch (error) {
                    console.error(`[MCP Settings] 删除服务器 ${server.id} 失败:`, error);
                }
            }

            state.mcpServers = [];
        }

        // 保存导入的服务器
        for (const server of servers) {
            await saveMCPServer(server);
            state.mcpServers.push(server);
        }

        // 刷新 UI
        renderServerList();

        showNotification(
            `${getIcon('checkCircle', { size: 14 })} 成功导入 ${servers.length} 个 MCP 服务器`,
            'success'
        );
    } catch (error) {
        console.error('[MCP Settings] 导入配置失败:', error);
        showNotification(`${getIcon('xCircle', { size: 14 })} 导入配置失败: ${error.message}`, 'error');
    }
}

/**
 * 显示导入合并对话框
 * @param {number} serverCount - 要导入的服务器数量
 * @returns {Promise<'replace'|'merge'|'cancel'>}
 */
async function showImportMergeDialog(serverCount) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'modal active';
        dialog.style.zIndex = '10002'; // 高于 MCP 设置模态框

        dialog.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>${getIcon('upload', { size: 18 })} 导入 MCP 配置</h3>
                </div>
                <div class="modal-body">
                    <p>即将导入 <strong>${serverCount}</strong> 个 MCP 服务器。</p>
                    <p>请选择导入方式：</p>
                    <div class="import-options" style="margin-top: 16px;">
                        <button class="btn btn-warning" id="import-replace">
                            ${getIcon('refreshCw', { size: 14 })} 替换现有配置
                            <small style="display: block; margin-top: 4px; opacity: 0.8;">删除所有现有服务器，替换为导入的配置</small>
                        </button>
                        <button class="btn btn-primary" id="import-merge" style="margin-top: 8px;">
                            ${getIcon('plus', { size: 14 })} 合并到现有配置
                            <small style="display: block; margin-top: 4px; opacity: 0.8;">保留现有服务器，添加导入的配置</small>
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="import-cancel">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // 绑定事件
        dialog.querySelector('#import-replace').addEventListener('click', () => {
            document.body.removeChild(dialog);
            resolve('replace');
        });

        dialog.querySelector('#import-merge').addEventListener('click', () => {
            document.body.removeChild(dialog);
            resolve('merge');
        });

        dialog.querySelector('#import-cancel').addEventListener('click', () => {
            document.body.removeChild(dialog);
            resolve('cancel');
        });

        // 点击背景取消
        dialog.querySelector('.modal-overlay').addEventListener('click', () => {
            document.body.removeChild(dialog);
            resolve('cancel');
        });
    });
}

/**
 * 从模板创建配置
 * @param {string} templateId - 模板 ID
 */
export async function createFromTemplate(templateId) {
    try {
        // 生成模板
        const templateConfig = generateTemplate(templateId);

        // 转换为内部格式
        const servers = standardToInternal(templateConfig);

        if (servers.length === 0) {
            throw new Error('模板无效');
        }

        // 保存服务器
        for (const server of servers) {
            await saveMCPServer(server);
            state.mcpServers.push(server);
        }

        // 刷新 UI
        renderServerList();

        showNotification(
            `${getIcon('checkCircle', { size: 14 })} 已从模板创建 ${servers.length} 个服务器`,
            'success'
        );
    } catch (error) {
        console.error('[MCP Settings] 从模板创建失败:', error);
        showNotification(`${getIcon('xCircle', { size: 14 })} 从模板创建失败: ${error.message}`, 'error');
    }
}

/**
 * 显示模板选择对话框
 */
export async function showTemplateDialog() {
    return new Promise((resolve) => {
        const templates = getAvailableTemplates();

        const dialog = document.createElement('div');
        dialog.className = 'modal active';
        dialog.style.zIndex = '10002';

        const templateHTML = templates.map(t => `
            <div class="template-item" data-template-id="${t.id}">
                <div class="template-name">${t.name}</div>
                <div class="template-description">${t.description}</div>
            </div>
        `).join('');

        dialog.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3>${getIcon('package', { size: 18 })} 选择配置模板</h3>
                    <button class="modal-close" aria-label="关闭">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="template-list">
                        ${templateHTML}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="template-cancel">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .template-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .template-item {
                padding: 12px 16px;
                border: var(--border);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .template-item:hover {
                background: var(--md-surface);
                border-color: var(--md-blue);
            }

            .template-name {
                font-weight: 600;
                margin-bottom: 4px;
                color: var(--md-text);
            }

            .template-description {
                font-size: 13px;
                color: var(--md-muted);
            }
        `;
        document.head.appendChild(style);

        // 绑定事件
        dialog.querySelectorAll('.template-item').forEach(item => {
            item.addEventListener('click', async () => {
                const templateId = item.dataset.templateId;
                document.body.removeChild(dialog);
                document.head.removeChild(style);
                await createFromTemplate(templateId);
                resolve(templateId);
            });
        });

        dialog.querySelector('#template-cancel').addEventListener('click', () => {
            document.body.removeChild(dialog);
            document.head.removeChild(style);
            resolve(null);
        });

        dialog.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(dialog);
            document.head.removeChild(style);
            resolve(null);
        });

        dialog.querySelector('.modal-overlay').addEventListener('click', () => {
            document.body.removeChild(dialog);
            document.head.removeChild(style);
            resolve(null);
        });
    });
}

console.log('[MCP Settings] 📝 MCP 配置 UI 模块已加载');
