/**
 * 侧边栏控制模块
 * 处理会话列表的显示和交互
 */

import { state, elements } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { switchToSession, deleteSession, renameSession, createNewSession } from '../state/sessions.js';
import { escapeHtml } from '../utils/helpers.js';
import { getCurrentQuery, highlightMatch } from './session-search.js';
import { sessionToMarkdown } from '../messages/converters.js';
import { getIcon } from '../utils/icons.js';
import { showNotification } from './notifications.js';
// 新增：IndexedDB 偏好设置 API
import { savePreference, loadPreference } from '../state/storage.js';
// 新增：自定义对话框（替代 Electron 中不支持的 prompt/confirm）
import { showInputDialog, showConfirmDialog } from '../utils/dialogs.js';

// 模块状态
let _initialized = false;
let _subscriptions = [];
let _searchResults = null; // 搜索结果（包含匹配消息信息）

/**
 * 焦点陷阱 - 限制焦点在指定元素内
 * @param {HTMLElement} element - 要限制焦点的元素
 */
function trapFocus(element) {
    if (element._focusTrapHandler) return; // 已经设置过

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handler = (e) => {
        if (e.key !== 'Tab') return;

        const focusableElements = element.querySelectorAll(focusableSelector);
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    };

    element.addEventListener('keydown', handler);
    element._focusTrapHandler = handler;
}

/**
 * 移除焦点陷阱
 * @param {HTMLElement} element - 元素
 */
function removeFocusTrap(element) {
    if (element._focusTrapHandler) {
        element.removeEventListener('keydown', element._focusTrapHandler);
        delete element._focusTrapHandler;
    }
}

/**
 * 切换侧边栏
 * @param {boolean} skipSave - 是否跳过保存状态
 */
export async function toggleSidebar(skipSave = false) {
    if (!elements.sidebar) return;

    const isOpening = !elements.sidebar.classList.contains('open');
    elements.sidebar.classList.toggle('open');

    // 控制 overlay 显示（不依赖 CSS，直接用 JS）
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        if (isOpening) {
            overlay.style.visibility = 'visible';
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'auto';
            overlay.style.zIndex = '99';  // 在侧边栏(100)之下
        } else {
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
        }
    }

    if (isOpening) {
        // 打开时启用焦点陷阱
        trapFocus(elements.sidebar);
        // 禁用主内容的交互
        document.querySelector('.app-container')?.setAttribute('inert', '');
    } else {
        // 关闭时移除焦点陷阱
        removeFocusTrap(elements.sidebar);
        // 恢复主内容交互
        document.querySelector('.app-container')?.removeAttribute('inert');
        // 返回焦点到触发按钮
        elements.sidebarToggle?.focus();
    }

    // 保存侧边栏状态
    if (!skipSave) {
        try {
            if (state.storageMode !== 'localStorage') {
                await savePreference('sidebarOpen', isOpening);
            } else {
                localStorage.setItem('sidebarOpen', isOpening ? 'true' : 'false');
            }
        } catch (error) {
            console.error('保存侧边栏状态失败:', error);
            localStorage.setItem('sidebarOpen', isOpening ? 'true' : 'false');
        }
    }
}

/**
 * 更新后台任务指示器
 */
export function updateBackgroundTasksIndicator() {
    if (!elements.backgroundTasksIndicator) return;

    const taskCount = state.backgroundTasks.size;
    if (taskCount > 0) {
        elements.backgroundTasksIndicator.style.display = 'flex';
        elements.backgroundTasksIndicator.textContent = `${taskCount} 个后台任务`;
    } else {
        elements.backgroundTasksIndicator.style.display = 'none';
    }
}

/**
 * 更新会话列表 UI
 */
export function updateSessionList() {
    if (!elements.sessionList) return;

    // 使用搜索结果或默认显示所有会话
    const currentQuery = getCurrentQuery();
    let sessionsData = _searchResults;

    if (!sessionsData) {
        // 没有搜索时，将所有会话转换为相同格式
        sessionsData = state.sessions.map(s => ({ session: s, matchedMessages: [] }));
    }

    // 如果没有会话，显示空状态
    if (sessionsData.length === 0 && state.sessions.length === 0) {
        elements.sessionList.innerHTML = `
            <div class="session-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12h18M3 6h18M3 18h18"/>
                    <circle cx="12" cy="12" r="10"/>
                </svg>
                <div style="margin-top: 12px;">还没有会话</div>
                <div style="margin-top: 8px; font-size: 11px; opacity: 0.7;">
                    点击上方"新建"按钮开始
                </div>
            </div>
        `;
        return;
    }

    // 如果搜索后没有结果，显示空搜索结果
    if (sessionsData.length === 0 && currentQuery) {
        elements.sessionList.innerHTML = `
            <div class="session-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                </svg>
                <div style="margin-top: 12px;">未找到匹配的会话</div>
                <div style="margin-top: 8px; font-size: 11px; opacity: 0.7;">
                    尝试其他搜索关键词
                </div>
            </div>
        `;
        return;
    }

    // 获取现有 DOM 元素的 session ID 映射
    const existingElements = new Map();
    elements.sessionList.querySelectorAll('.session-item').forEach(el => {
        existingElements.set(el.dataset.sessionId, el);
    });

    // 清除空状态（如果有）
    const emptyState = elements.sessionList.querySelector('.session-list-empty');
    if (emptyState) emptyState.remove();

    // 构建新的会话 ID 集合
    const sessionIds = new Set(sessionsData.map(d => d.session.id));

    // 删除不再存在的会话元素
    existingElements.forEach((el, id) => {
        if (!sessionIds.has(id)) {
            el.remove();
        }
    });

    sessionsData.forEach(({ session, matchedMessages }, idx) => {
        let sessionEl = existingElements.get(session.id);
        const hasBackgroundTask = state.backgroundTasks.has(session.id);
        const isActive = session.id === state.currentSessionId;

        // 绑定会话元素事件的辅助函数
        const bindSessionEvents = (element, sessionData) => {
            // 检查是否已经绑定过事件（防止重复绑定）
            if (element._eventsBound) {
                return;
            }

            // 重命名按钮
            const renameBtn = element.querySelector('.rename-session-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const newName = await showInputDialog(
                        '请输入新的会话名称:',
                        sessionData.name,
                        '重命名会话'
                    );
                    if (newName && newName.trim()) {
                        renameSession(sessionData.id, newName);
                    }
                });
            }

            // 删除按钮
            const deleteBtn = element.querySelector('.delete-session-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const confirmed = await showConfirmDialog(
                        `确定要删除会话 "${sessionData.name}" 吗？`,
                        '确认删除'
                    );
                    if (confirmed) {
                        deleteSession(sessionData.id);
                    }
                });
            }

            // 导出按钮
            const exportBtn = element.querySelector('.export-session-btn');
            if (exportBtn) {
                exportBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const markdown = sessionToMarkdown(sessionData);
                        await navigator.clipboard.writeText(markdown);
                        showNotification('会话已作为 Markdown 复制到剪切板', 'success');
                    } catch (err) {
                        console.error('导出失败:', err);
                        showNotification('导出失败: ' + err.message, 'error');
                    }
                });
            }

            // 标记为已绑定，避免重复绑定
            element._eventsBound = true;
        };

        if (sessionEl) {
            // 更新现有元素
            sessionEl.className = `session-item${isActive ? ' active' : ''}`;
            const nameEl = sessionEl.querySelector('.session-name');
            if (nameEl) {
                // 高亮匹配文本
                if (currentQuery) {
                    nameEl.innerHTML = highlightMatch(session.name, currentQuery);
                } else {
                    nameEl.textContent = session.name;
                }
                nameEl.title = session.name;
            }

            const generatingEl = sessionEl.querySelector('.session-generating');
            if (hasBackgroundTask && !generatingEl) {
                const infoEl = sessionEl.querySelector('.session-info');
                if (infoEl) {
                    infoEl.insertAdjacentHTML('beforeend', '<span class="session-generating">生成中...</span>');
                }
            } else if (!hasBackgroundTask && generatingEl) {
                generatingEl.remove();
            }

            // 更新匹配消息预览
            updateMatchedMessagesPreview(sessionEl, matchedMessages, currentQuery);

            // 注意：不需要重新绑定事件，已存在元素已经绑定过了
        } else {
            // 创建新元素
            sessionEl = document.createElement('div');
            sessionEl.className = `session-item${isActive ? ' active' : ''}`;
            sessionEl.dataset.sessionId = session.id;
            sessionEl.setAttribute('tabindex', '0');
            sessionEl.setAttribute('role', 'button');
            sessionEl.setAttribute('aria-label', `会话: ${session.name}`);

            // 会话名称（高亮匹配）
            const sessionNameHTML = currentQuery
                ? highlightMatch(session.name, currentQuery)
                : escapeHtml(session.name);

            sessionEl.innerHTML = `
                <div class="session-info">
                    <span class="session-name" title="${escapeHtml(session.name)}">${sessionNameHTML}</span>
                    ${hasBackgroundTask ? '<span class="session-generating">生成中...</span>' : ''}
                </div>
                <div class="session-actions">
                    <button class="session-action-btn export-session-btn export" title="复制为 Markdown" aria-label="复制此会话为 Markdown">
                        ${getIcon('copy', { size: 14 })}
                    </button>
                    <button class="session-action-btn rename-session-btn" title="重命名" aria-label="重命名会话">
                        ${getIcon('edit', { size: 14 })}
                    </button>
                    <button class="session-action-btn delete-session-btn delete" title="删除" aria-label="删除会话">
                        ${getIcon('trash', { size: 14 })}
                    </button>
                </div>
            `;

            // 点击事件（支持消息定位）
            sessionEl.addEventListener('click', (e) => {
                // 如果点击的是消息预览项，跳转到该消息
                const messagePreviewItem = e.target.closest('.matched-message-item');
                if (messagePreviewItem) {
                    const messageIndex = parseInt(messagePreviewItem.dataset.messageIndex);
                    switchToSessionAndScrollToMessage(session.id, messageIndex);
                } else {
                    // 否则正常切换会话
                    switchToSession(session.id);
                }
            });

            // 使用统一的事件绑定函数
            bindSessionEvents(sessionEl, session);

            // 键盘事件
            sessionEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    switchToSession(session.id);
                }
            });

            // 插入到正确位置
            if (idx === 0) {
                elements.sessionList.insertBefore(sessionEl, elements.sessionList.firstChild);
            } else {
                const prevSession = state.sessions[idx - 1];
                const prevEl = elements.sessionList.querySelector(`[data-session-id="${prevSession.id}"]`);
                if (prevEl) {
                    prevEl.after(sessionEl);
                } else {
                    elements.sessionList.appendChild(sessionEl);
                }
            }
        }

        // 添加匹配消息预览（新元素）
        updateMatchedMessagesPreview(sessionEl, matchedMessages, currentQuery);
    });
}

/**
 * 更新匹配消息预览
 * @param {HTMLElement} sessionEl - 会话元素
 * @param {Array} matchedMessages - 匹配的消息列表
 * @param {string} query - 搜索关键词
 */
function updateMatchedMessagesPreview(sessionEl, matchedMessages, query) {
    // 移除旧的预览
    const oldPreview = sessionEl.querySelector('.matched-messages-preview');
    if (oldPreview) {
        oldPreview.remove();
    }

    // 如果没有匹配消息或没有搜索，不显示预览
    if (!matchedMessages || matchedMessages.length === 0 || !query) {
        return;
    }

    // 创建预览容器
    const previewContainer = document.createElement('div');
    previewContainer.className = 'matched-messages-preview';

    matchedMessages.forEach(msg => {
        const previewItem = document.createElement('div');
        previewItem.className = 'matched-message-item';
        previewItem.dataset.messageIndex = msg.index;

        // 角色标签
        const roleLabel = msg.role === 'user' ? '用户' : (msg.role === 'assistant' ? 'AI' : msg.role);
        const roleClass = msg.role === 'user' ? 'role-user' : 'role-assistant';

        previewItem.innerHTML = `
            <span class="message-role ${roleClass}">${roleLabel}</span>
            <span class="message-preview-text">${highlightMatch(msg.preview, query)}</span>
        `;

        previewContainer.appendChild(previewItem);
    });

    sessionEl.appendChild(previewContainer);
}

/**
 * 切换会话并滚动到指定消息
 * @param {string} sessionId - 会话ID
 * @param {number} messageIndex - 消息索引
 */
async function switchToSessionAndScrollToMessage(sessionId, messageIndex) {
    await switchToSession(sessionId);

    // 等待消息渲染完成后滚动
    setTimeout(() => {
        scrollToMessage(messageIndex);
    }, 300);
}

/**
 * 滚动到指定消息并高亮
 * @param {number} messageIndex - 消息索引
 */
function scrollToMessage(messageIndex) {
    const messagesArea = elements.messagesArea;
    if (!messagesArea) return;

    // 查找对应的消息元素
    const messageElements = messagesArea.querySelectorAll('.message');
    const targetMessage = messageElements[messageIndex];

    if (targetMessage) {
        // 滚动到该消息
        targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 添加高亮效果
        targetMessage.classList.add('search-highlighted');

        // 3秒后移除高亮
        setTimeout(() => {
            targetMessage.classList.remove('search-highlighted');
        }, 3000);
    }
}

/**
 * 初始化侧边栏
 */
export function initSidebar() {
    // 防止重复初始化
    if (_initialized) {
        console.warn('Sidebar already initialized');
        return;
    }

    // 初始化 overlay 的初始状态
    const sidebarOverlay = document.querySelector('.sidebar-overlay');
    if (sidebarOverlay) {
        // 强制设置初始样式，覆盖所有CSS
        sidebarOverlay.style.position = 'fixed';
        sidebarOverlay.style.inset = '0';
        sidebarOverlay.style.background = 'rgba(56, 56, 56, 0.6)';
        sidebarOverlay.style.visibility = 'hidden';
        sidebarOverlay.style.opacity = '0';
        sidebarOverlay.style.pointerEvents = 'none';
        sidebarOverlay.style.zIndex = '99';
        sidebarOverlay.style.cursor = 'pointer';
        sidebarOverlay.style.border = 'none';
        sidebarOverlay.style.padding = '0';
        sidebarOverlay.style.transition = 'opacity 0.2s ease-out, visibility 0.2s ease-out';

        // 使用事件捕获确保一定能接收到点击
        sidebarOverlay.addEventListener('click', function(e) {
            console.log('🔵 Sidebar overlay clicked');
            e.stopPropagation();  // 阻止事件继续传播
            toggleSidebar();
        }, true);  // true = 捕获阶段
    }

    // 绑定侧边栏切换按钮
    if (elements.sidebarToggle) {
        elements.sidebarToggle.addEventListener('click', () => toggleSidebar());
    }

    // 绑定新建会话按钮（带防抖保护）
    if (elements.newSessionBtn) {
        let isCreating = false;
        elements.newSessionBtn.addEventListener('click', async () => {
            if (isCreating || state.isSwitchingSession) return;
            isCreating = true;
            elements.newSessionBtn.disabled = true;
            try {
                await createNewSession(true);
            } finally {
                isCreating = false;
                elements.newSessionBtn.disabled = false;
            }
        });
    }

    // 绑定关闭侧边栏按钮
    if (elements.closeSidebar) {
        elements.closeSidebar.addEventListener('click', () => toggleSidebar());
    }

    // 侧边栏状态恢复已移至 main.js（使用 IndexedDB 优先）
    // 删除此处的 localStorage 读取，避免重复恢复

    // 监听会话相关事件（保存 unsubscribe 函数）
    _subscriptions.push(
        eventBus.on('session:switched', () => {
            updateSessionList();
            updateBackgroundTasksIndicator();
        })
    );

    _subscriptions.push(
        eventBus.on('sessions:updated', () => {
            updateSessionList();
        })
    );

    _subscriptions.push(
        eventBus.on('sessions:loaded', () => {
            updateSessionList();
        })
    );

    _subscriptions.push(
        eventBus.on('sessions:search-filter', ({ searchResults, query }) => {
            _searchResults = searchResults;
            updateSessionList();
        })
    );

    _initialized = true;
    console.log('Sidebar initialized');

    // 修复竞态条件：手动触发一次会话列表更新
    // 因为 loadSessions() 可能在 initSidebar() 之前就触发了 sessions:loaded 事件
    updateSessionList();

    // 将函数暴露到全局作用域供 HTML onclick 使用
    window.switchToSession = switchToSession;
    window.deleteSession = async (sessionId) => {
        const confirmed = await showConfirmDialog('确定要删除此会话吗？', '确认删除');
        if (confirmed) {
            deleteSession(sessionId);
        }
    };
    window.renameSession = async (sessionId) => {
        const session = state.sessions.find(s => s.id === sessionId);
        if (session) {
            const newName = await showInputDialog(
                '请输入新的会话名称:',
                session.name,
                '重命名会话'
            );
            if (newName && newName.trim()) {
                renameSession(sessionId, newName);
            }
        }
    };
    window.toggleSidebar = toggleSidebar;
}

/**
 * 清理侧边栏模块（用于重置或销毁）
 */
export function cleanupSidebar() {
    if (!_initialized) {
        return;
    }

    // 取消所有事件订阅
    _subscriptions.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    });
    _subscriptions = [];

    _initialized = false;
    console.log('🧹 Sidebar cleaned up');
}
