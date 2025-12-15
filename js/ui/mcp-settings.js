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

const platform = detectPlatform();

// 模态框相关变量
let modal = null;
let isFormOpen = false;
let removeFocusTrap = null;

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

    console.log('[MCP Settings] ✅ 初始化完成');
}

/**
 * 设置模态框事件
 */
function setupModalEvents() {
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
 */
function renderPlatformInfo() {
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

    // ✅ 使用验证函数
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

        // ✅ 使用验证函数
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

        // ✅ 使用验证函数
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

    // ✅ 先保存到 IndexedDB，成功后再添加到状态
    try {
        await saveMCPServer(config);

        // ✅ 保存成功后才添加到状态
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
        // ✅ 不需要回滚，因为状态还没添加
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
    const status = mcpClient.connections.has(server.id);
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

    // ✅ 显示加载状态（使用 loading class）
    const btn = modal.querySelector(`.mcp-connect-btn[data-server-id="${serverId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        // 保存原始文本以便恢复
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '连接中...';
    }

    // ✅ 监听重试事件，更新按钮文本
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
        console.log(`[MCP Settings] ✅ 已连接: ${server.name}`);
        showNotification(`已连接到 ${server.name}`, 'success');
        // ✅ 重置重试计数
        server.retryCount = 0;

        // ✅ 保存到 IndexedDB
        try {
            await saveMCPServer(server);
        } catch (error) {
            console.error('[MCP Settings] 保存服务器状态失败:', error);
        }

        renderServerList(); // 刷新列表
    } else {
        console.error(`[MCP Settings] ❌ 连接失败: ${result.error}`);
        // ✅ 增加重试计数（仅在非重试耗尽的情况下）
        if (!result.retriesExhausted) {
            server.retryCount = (server.retryCount || 0) + 1;
        }

        // ✅ 保存到 IndexedDB
        try {
            await saveMCPServer(server);
        } catch (error) {
            console.error('[MCP Settings] 保存服务器状态失败:', error);
        }

        // ✅ 显示友好的错误消息
        const friendlyError = getErrorMessage(result.errorType, result.error);
        const errorMsg = result.retriesExhausted
            ? `${friendlyError}（已重试 ${server.retryCount} 次）`
            : friendlyError;

        showNotification(errorMsg, 'error');

        // ✅ 移除加载状态，更新按钮
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
    renderServerList(); // 刷新列表
}

/**
 * 删除服务器
 */
async function deleteServer(serverId) {
    const server = state.mcpServers.find(s => s.id === serverId);
    if (!server) return;

    // ✅ 使用自定义确认对话框
    const confirmed = await showConfirmDialog(
        `确定要删除服务器 "${server.name}" 吗？`,
        '删除服务器'
    );

    if (!confirmed) {
        return;
    }

    // 先断开连接
    if (mcpClient.connections.has(serverId)) {
        mcpClient.disconnect(serverId);
    }

    // 从状态中移除
    state.mcpServers = state.mcpServers.filter(s => s.id !== serverId);

    // ✅ 从 IndexedDB 中删除
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

    // ✅ 监听连接丢失事件
    eventBus.on('mcp:connection-lost', (data) => {
        console.warn(`[MCP Settings] ⚠️ 连接丢失: ${data.serverName}`);
        showNotification(`${getIcon('alertCircle', { size: 14 })} ${data.serverName} 连接断开，将在 5 秒后自动重连...`, 'warning');
        renderServerList();
    });

    // ✅ 监听重连失败事件
    eventBus.on('mcp:reconnect-failed', (data) => {
        console.error(`[MCP Settings] ❌ 自动重连失败: ${data.serverName}`);
        showNotification(`${getIcon('xCircle', { size: 14 })} ${data.serverName} 自动重连失败，请手动重试`, 'error');
        renderServerList();
    });

    // ✅ 监听 Electron 子进程重启事件
    if (window.electron) {
        // 服务器正在重启
        eventBus.on('mcp:server-restarting', (data) => {
            console.log(`[MCP Settings] 🔄 服务器重启中: ${data.serverId} (尝试 ${data.attempt})`);
            showNotification(`${getIcon('loader', { size: 14 })} MCP 服务器正在重启... (${data.attempt}/3)`, 'info');
        });

        // 服务器重启成功
        eventBus.on('mcp:server-restarted', (data) => {
            console.log(`[MCP Settings] ✅ 服务器重启成功: ${data.serverId}`);
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
 * ✅ 获取友好的错误消息
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

console.log('[MCP Settings] 📝 MCP 配置 UI 模块已加载');
