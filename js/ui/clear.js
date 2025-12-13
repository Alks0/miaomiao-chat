/**
 * 清空聊天功能
 * 处理当前会话的清空操作
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { saveCurrentSessionMessages } from '../state/sessions.js';
import { showConfirmDialog } from '../utils/dialogs.js';

/**
 * 处理清空当前会话
 */
export async function handleClear() {
    const confirmed = await showConfirmDialog(
        '确定要清空当前会话的所有对话吗？',
        '确认清空'
    );
    if (!confirmed) return;

    // 清空三种格式的消息
    state.messages = [];
    state.geminiContents = [];
    state.claudeContents = [];

    // 重置相关状态
    state.lastUserMessage = null;
    state.editingIndex = null;
    state.currentReplies = [];
    state.selectedReplyIndex = 0;

    // 清除编辑状态
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
        state.editingElement = null;
    }

    // 清空消息区域
    elements.messagesArea.innerHTML = '';

    // 恢复欢迎消息
    elements.messagesArea.innerHTML = `
        <div class="welcome-message glass">
            <div class="gemini-logo">
                <svg width="64" height="64" viewBox="0 0 64 64">
                    <defs>
                        <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#9168c0"/>
                            <stop offset="100%" style="stop-color:#a8c7fa"/>
                        </linearGradient>
                    </defs>
                    <circle cx="32" cy="32" r="28" fill="url(#gemini-gradient)"/>
                </svg>
            </div>
            <h2>你好，我是 喵喵喵</h2>
        </div>
    `;

    // 保存会话状态
    saveCurrentSessionMessages();
}

/**
 * 初始化清空功能
 */
export function initClearChat() {
    // 绑定清空按钮
    elements.clearButton?.addEventListener('click', handleClear);

    console.log('Clear chat initialized');
}
