/**
 * 会话管理
 * 处理会话的创建、切换、删除和持久化
 * 注意：UI 更新通过事件通知，由 UI 层监听处理
 */

import { state } from '../core/state.js';
import { elements, isElementsInitialized } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { saveSessionToDB, loadAllSessionsFromDB, deleteSessionFromDB, migrateFromLocalStorage, savePreference, loadPreference } from './storage.js';
import { generateSessionId, generateSessionName } from '../utils/helpers.js';
import { renderSessionMessages } from '../messages/restore.js';
import { replaceAllMessages } from '../core/state-mutations.js';

// 防抖保存定时器
let saveSessionTimer = null;

/**
 * 加载所有会话
 */
export async function loadSessions() {
    try {
        // 先尝试从 localStorage 迁移旧数据
        await migrateFromLocalStorage();

        // 从 IndexedDB 加载会话
        state.sessions = await loadAllSessionsFromDB();
    } catch (e) {
        console.error('加载会话失败:', e);
        state.sessions = [];
    }

    // 加载当前会话ID
    let currentId = null;
    try {
        // ✅ 优先从 IndexedDB 加载
        if (state.storageMode !== 'localStorage') {
            currentId = await loadPreference('currentSessionId');
        }
        // 降级：从 localStorage 加载
        if (!currentId) {
            currentId = localStorage.getItem('geminiCurrentSessionId');
        }
    } catch (error) {
        console.error('加载当前会话ID失败:', error);
        currentId = localStorage.getItem('geminiCurrentSessionId');
    }

    // 如果没有会话，创建一个默认会话
    if (state.sessions.length === 0) {
        const newSession = await createNewSession(false);
        // 必须设置 currentSessionId，否则 saveCurrentSessionMessages 不会保存
        state.currentSessionId = newSession.id;
        await saveCurrentSessionId();
    } else if (currentId && state.sessions.find(s => s.id === currentId)) {
        await switchToSession(currentId, false);
    } else {
        // 切换到最新的会话
        await switchToSession(state.sessions[0].id, false);
    }

    // 通知 UI 更新
    eventBus.emit('sessions:loaded', { sessions: state.sessions });
}

/**
 * 保存当前会话ID
 */
export async function saveCurrentSessionId() {
    try {
        // ✅ 优先保存到 IndexedDB
        if (state.storageMode !== 'localStorage') {
            await savePreference('currentSessionId', state.currentSessionId || '');
        } else {
            // 降级：保存到 localStorage
            localStorage.setItem('geminiCurrentSessionId', state.currentSessionId || '');
        }
    } catch (error) {
        console.error('保存当前会话ID失败:', error);
        // 降级处理
        localStorage.setItem('geminiCurrentSessionId', state.currentSessionId || '');
    }
}

/**
 * 保存当前会话的消息（立即执行）
 */
export async function saveCurrentSessionMessages() {
    if (!state.currentSessionId) return;

    const session = state.sessions.find(s => s.id === state.currentSessionId);
    if (!session) return;

    session.messages = [...state.messages];
    session.geminiContents = [...state.geminiContents];
    session.claudeContents = [...state.claudeContents];
    session.apiFormat = state.apiFormat;
    session.updatedAt = Date.now();

    // 自动生成会话名称（取第一条用户消息）
    if (!session.customName) {
        let content = '';

        if (state.apiFormat === 'gemini' && state.geminiContents.length > 0) {
            // Gemini 格式
            const firstUserMsg = state.geminiContents.find(m => m.role === 'user');
            if (firstUserMsg && firstUserMsg.parts) {
                const textPart = firstUserMsg.parts.find(p => p.text);
                if (textPart) {
                    content = textPart.text;
                }
            }
        } else if (state.messages.length > 0) {
            // OpenAI 格式
            const firstUserMsg = state.messages.find(m => m.role === 'user');
            if (firstUserMsg) {
                content = typeof firstUserMsg.content === 'string'
                    ? firstUserMsg.content
                    : firstUserMsg.content.find(p => p.type === 'text')?.text || '';
            }
        }

        if (content) {
            session.name = generateSessionName(content);
        }
    }

    // 保存到 IndexedDB
    try {
        await saveSessionToDB(session);
    } catch (e) {
        console.error('保存会话到 IndexedDB 失败:', e);
        eventBus.emit('ui:notification', { message: '保存会话失败', type: 'error' });
    }

    saveCurrentSessionId();
    eventBus.emit('sessions:updated', { sessions: state.sessions });
}

/**
 * 防抖保存当前会话（500ms 延迟）
 */
export function debouncedSaveSession() {
    clearTimeout(saveSessionTimer);
    saveSessionTimer = setTimeout(() => {
        saveCurrentSessionMessages();
    }, 500);
}

/**
 * 创建新会话
 * @param {boolean} shouldSwitch - 是否立即切换到新会话
 * @returns {Promise<Object>} 新会话对象
 */
export async function createNewSession(shouldSwitch = true) {
    // 检查当前会话是否为空，如果为空则直接复用
    const currentSession = state.sessions.find(s => s.id === state.currentSessionId);
    if (currentSession) {
        const hasMessages = (currentSession.messages?.length > 0) ||
                           (currentSession.geminiContents?.length > 0) ||
                           (currentSession.claudeContents?.length > 0);
        if (!hasMessages && !currentSession.customName) {
            // 当前会话为空且没有自定义名称，直接复用
            eventBus.emit('ui:notification', { message: '当前会话为空，无需创建新会话', type: 'info' });
            return currentSession;
        }
    }

    // 先保存当前会话
    await saveCurrentSessionMessages();

    const newSession = {
        id: generateSessionId(),
        name: '新会话',
        messages: [],
        geminiContents: [],
        claudeContents: [],
        apiFormat: state.apiFormat, // 继承当前 API 格式
        createdAt: Date.now(),
        updatedAt: Date.now(),
        customName: false,
    };

    state.sessions.unshift(newSession);

    // 保存到 IndexedDB
    try {
        await saveSessionToDB(newSession);
    } catch (e) {
        console.error('保存新会话失败:', e);
    }

    if (shouldSwitch) {
        await switchToSession(newSession.id, false);
        eventBus.emit('ui:notification', { message: '已创建新会话', type: 'info' });
    }

    eventBus.emit('sessions:updated', { sessions: state.sessions });
    return newSession;
}

/**
 * 切换到指定会话
 * @param {string} sessionId - 会话 ID
 * @param {boolean} saveOld - 是否保存旧会话
 * @param {Object} elements - DOM 元素引用（用于检查输入框）
 */
export async function switchToSession(sessionId, saveOld = true, elements = null) {
    // ✅ 防止重复切换（同一会话）
    if (state.currentSessionId === sessionId) return;

    // ✅ 防止竞态条件：如果正在切换，忽略新的切换请求
    if (state.isSwitchingSession) {
        console.warn(`会话切换正在进行中，忽略切换到 ${sessionId} 的请求`);
        return;
    }

    // 检查是否有未保存的内容（如果提供了 elements）
    if (elements) {
        const hasUnsavedContent = elements.userInput?.value.trim().length > 0 ||
                                  state.editingIndex !== null ||
                                  state.uploadedImages.length > 0;
        if (hasUnsavedContent) {
            // 发出事件，让 UI 层处理确认对话框
            eventBus.emit('sessions:confirm-switch', { sessionId, saveOld });
            return;
        }
    }

    // ✅ 设置切换标志，防止并发切换
    state.isSwitchingSession = true;

    try {
        // 保存当前会话
        if (saveOld && state.currentSessionId) {
            await saveCurrentSessionMessages();
        }

        const session = state.sessions.find(s => s.id === sessionId);
        if (!session) {
            console.error(`会话 ${sessionId} 不存在`);
            return;
        }

        const oldSessionId = state.currentSessionId;

        // 切换会话 - 恢复所有三种格式
        state.currentSessionId = sessionId;

        // ✅ 使用安全的状态更新函数替换消息数组
        replaceAllMessages(
            session.messages || [],
            session.geminiContents || [],
            session.claudeContents || []
        );

        state.lastUserMessage = null;
        state.messageHistory = [];

        // ✅ 退出编辑模式（清理 DOM 状态）
        if (state.editingElement) {
            state.editingElement.classList.remove('editing');
        }
        state.editingIndex = null;
        state.editingElement = null;

        // ✅ 清空输入框
        if (elements && elements.userInput) {
            elements.userInput.value = '';
            elements.userInput.style.height = 'auto';
        }

        // ✅ 通知 UI 更新编辑按钮状态
        eventBus.emit('editor:mode-changed', { isEditing: false });

        state.currentReplies = [];
        state.selectedReplyIndex = 0;
        state.uploadedImages = [];

        // ✅ 更新图片预览（清空）
        eventBus.emit('ui:update-image-preview');

        // ✅ 将当前会话的生成任务移到后台（如果正在生成）
        if (oldSessionId && state.isLoading && state.currentAbortController) {
            console.log(`[sessions.js] 将会话 ${oldSessionId} 的任务移到后台, state.isLoading =`, state.isLoading);
            state.backgroundTasks.set(oldSessionId, {
                abortController: state.currentAbortController,
                messageElement: state.currentAssistantMessage,
            });
            eventBus.emit('ui:notification', {
                message: '上一个会话的生成将在后台继续',
                type: 'info',
                duration: 3000
            });
        }

        // 恢复会话的 API 格式
        if (session.apiFormat && session.apiFormat !== state.apiFormat) {
            state.apiFormat = session.apiFormat;
            eventBus.emit('config:format-change-requested', { format: session.apiFormat, shouldFetchModels: false });
        }

        // ✅ 检查目标会话是否有后台任务
        const backgroundTask = state.backgroundTasks.get(sessionId);
        if (backgroundTask) {
            // 恢复后台任务的状态
            state.isLoading = true;
            state.currentAbortController = backgroundTask.abortController;
            // currentAssistantMessage 将在 renderSessionMessages 后自动恢复
            console.log(`[sessions.js] 恢复会话 ${sessionId} 的后台任务, state.isLoading =`, state.isLoading);

            // 🔧 显示取消按钮（恢复后台任务时）
            eventBus.emit('ui:show-cancel-button');
        } else {
            // 🔧 没有后台任务，完全重置状态和UI（修复切换会话后按钮卡住的问题）
            state.isLoading = false;
            state.isSending = false;  // ✅ 重置发送锁，防止跨会话锁定
            state.currentAssistantMessage = null;
            state.currentAbortController = null;

            // 清除发送锁超时定时器
            if (state.sendLockTimeout) {
                clearTimeout(state.sendLockTimeout);
                state.sendLockTimeout = null;
            }

            console.log('[sessions.js] 切换到空闲会话，已重置 state.isLoading =', state.isLoading, ', state.isSending =', state.isSending);

            // 重置 UI 按钮状态
            eventBus.emit('ui:reset-input-buttons');
        }

        saveCurrentSessionId();

        // 渲染会话消息
        renderSessionMessages();

        // ✅ 如果有后台任务，恢复 currentAssistantMessage 引用
        if (backgroundTask && backgroundTask.messageElement && isElementsInitialized()) {
            // 延迟到下一帧执行，确保 renderSessionMessages() 的 DOM 操作完全完成
            requestAnimationFrame(() => {
                // 二次检查：确保会话没有再次切换
                if (state.currentSessionId !== sessionId) {
                    console.warn('[sessions.js] 会话已切换，取消后台任务恢复');
                    return;
                }

                try {
                    // 直接使用 document.getElementById 避免 Proxy 问题
                    const messagesArea = document.getElementById('messages');
                    if (!messagesArea) {
                        console.error('[sessions.js] messagesArea 不存在');
                        return;
                    }

                    const lastAssistantMsg = messagesArea.querySelector('.message.assistant:last-child .message-content');
                    if (lastAssistantMsg) {
                        state.currentAssistantMessage = lastAssistantMsg;
                        console.log('[sessions.js] ✅ 后台任务 DOM 引用已恢复（已保存的消息）');
                    } else {
                        // ✅ 修复：未找到消息框，创建新的占位符（消息还没保存到数组）
                        console.log('[sessions.js] 未找到助手消息，创建新占位符（正在流式输出）');

                        // 创建消息框（与 handler.js 中的逻辑一致）
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message assistant';

                        const avatar = document.createElement('div');
                        avatar.className = 'message-avatar';
                        avatar.textContent = 'AI';

                        const contentWrapper = document.createElement('div');
                        contentWrapper.className = 'message-content-wrapper';

                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        contentDiv.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';

                        messageDiv.appendChild(avatar);
                        contentWrapper.appendChild(contentDiv);
                        messageDiv.appendChild(contentWrapper);

                        // 添加到 DOM
                        messagesArea.appendChild(messageDiv);

                        // 恢复引用
                        state.currentAssistantMessage = contentDiv;
                        console.log('[sessions.js] ✅ 后台任务占位符已创建');
                    }
                } catch (error) {
                    console.error('[sessions.js] ❌ 恢复后台任务失败:', error);
                }
            });
        }

        // 通知 UI 更新
        eventBus.emit('session:switched', {
            oldId: oldSessionId,
            newId: sessionId,
            session
        });
    } catch (error) {
        console.error('会话切换失败:', error);
        eventBus.emit('ui:notification', { message: '会话切换失败', type: 'error' });
    } finally {
        // ✅ 无论成功或失败，都清除切换标志
        state.isSwitchingSession = false;
    }
}

/**
 * 删除会话
 * @param {string} sessionId - 会话 ID
 */
export async function deleteSession(sessionId) {
    const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
    if (sessionIndex === -1) return;

    // 从数据库删除
    try {
        await deleteSessionFromDB(sessionId);
    } catch (e) {
        console.error('从数据库删除会话失败:', e);
        eventBus.emit('ui:notification', { message: '删除会话失败', type: 'error' });
        return;
    }

    // 停止该会话的后台任务
    const task = state.backgroundTasks.get(sessionId);
    if (task) {
        task.abortController.abort();
        state.backgroundTasks.delete(sessionId);
    }

    // 从状态中删除
    state.sessions.splice(sessionIndex, 1);

    // 如果删除的是当前会话，切换到其他会话
    if (state.currentSessionId === sessionId) {
        if (state.sessions.length > 0) {
            // 切换到下一个会话（或上一个）
            const nextSession = state.sessions[sessionIndex] || state.sessions[sessionIndex - 1];
            await switchToSession(nextSession.id, false);
        } else {
            // 没有会话了，创建新会话
            await createNewSession(true);
        }
    }

    eventBus.emit('ui:notification', { message: '会话已删除', type: 'info' });
    eventBus.emit('sessions:updated', { sessions: state.sessions });
}

/**
 * 重命名会话
 * @param {string} sessionId - 会话 ID
 * @param {string} newName - 新名称
 */
export async function renameSession(sessionId, newName) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.name = newName.trim() || '未命名会话';
    session.customName = true;
    session.updatedAt = Date.now();

    await saveSessionToDB(session);
    eventBus.emit('sessions:updated', { sessions: state.sessions });
    eventBus.emit('ui:notification', { message: '会话已重命名', type: 'info' });
}

// 监听消息变更事件，自动保存会话
eventBus.on('messages:changed', () => {
    debouncedSaveSession();
});

// 监听存储配额超出事件，显示通知
eventBus.on('storage:quota-exceeded', ({ message }) => {
    eventBus.emit('ui:notification', { message, type: 'error' });
});
