/**
 * 快捷消息管理模块
 * 处理快捷消息的CRUD操作、持久化和发送逻辑
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { showNotification } from '../ui/notifications.js';
import { saveCurrentConfig } from './config.js';
// ✅ 新增：IndexedDB 快捷消息 API
import { loadAllQuickMessages, saveQuickMessage, deleteQuickMessage as deleteQuickMessageFromDB } from './storage.js';

/**
 * 初始化快捷消息（从存储加载）
 */
export async function initQuickMessages() {
    await loadQuickMessagesFromStorage();
    console.log('✅ Quick Messages initialized');
}

/**
 * 从存储加载快捷消息
 */
async function loadQuickMessagesFromStorage() {
    try {
        // ✅ 优先从 IndexedDB 加载
        if (state.storageMode !== 'localStorage') {
            const messages = await loadAllQuickMessages();
            state.quickMessages = messages || [];
            console.log('[loadQuickMessages] 从 IndexedDB 加载:', state.quickMessages.length);
            return;
        }

        // 降级：从 localStorage 加载
        const saved = localStorage.getItem('quickMessages');
        if (saved) {
            state.quickMessages = JSON.parse(saved);
            console.log('[loadQuickMessages] 从 localStorage 加载（降级模式）');
        } else {
            state.quickMessages = [];
        }
    } catch (error) {
        console.error('加载快捷消息失败:', error);
        state.quickMessages = [];
    }
}

/**
 * 保存所有快捷消息到存储
 */
async function saveQuickMessagesToStorage() {
    try {
        // ✅ 优先保存到 IndexedDB（逐个保存）
        if (state.storageMode !== 'localStorage') {
            for (const msg of state.quickMessages) {
                await saveQuickMessage(msg);
            }
            console.log('[saveQuickMessages] 已保存到 IndexedDB:', state.quickMessages.length);
        } else {
            // 降级：保存到 localStorage
            localStorage.setItem('quickMessages', JSON.stringify(state.quickMessages));
            console.log('[saveQuickMessages] 已保存到 localStorage（降级模式）');
        }
    } catch (error) {
        console.error('保存快捷消息失败:', error);
        // 降级处理
        localStorage.setItem('quickMessages', JSON.stringify(state.quickMessages));
        showNotification('保存快捷消息失败', 'error');
    }
}

/**
 * 创建快捷消息
 * @param {string} name - 消息名称
 * @param {string} content - 消息内容
 * @param {string} category - 分类（可选）
 * @returns {Object} 新建的快捷消息对象
 */
export function createQuickMessage(name, content, category = '常用') {
    const newMessage = {
        id: `qm_${Date.now()}`,
        name: name.trim(),
        content: content.trim(),
        category: category || '常用',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    state.quickMessages.push(newMessage);
    saveQuickMessagesToStorage();
    saveCurrentConfig(); // 同步到配置系统

    eventBus.emit('quickmsg:updated');
    showNotification(`已创建快捷消息 "${newMessage.name}"`, 'success');

    return newMessage;
}

/**
 * 更新快捷消息
 * @param {string} id - 消息 ID
 * @param {Object} updates - 更新的字段 { name?, content?, category? }
 * @returns {boolean} 是否更新成功
 */
export function updateQuickMessage(id, updates) {
    const index = state.quickMessages.findIndex(m => m.id === id);
    if (index === -1) {
        showNotification('快捷消息不存在', 'error');
        return false;
    }

    const message = state.quickMessages[index];

    if (updates.name !== undefined) {
        message.name = updates.name.trim();
    }
    if (updates.content !== undefined) {
        message.content = updates.content.trim();
    }
    if (updates.category !== undefined) {
        message.category = updates.category;
    }

    message.updatedAt = Date.now();

    saveQuickMessagesToStorage();
    saveCurrentConfig();

    eventBus.emit('quickmsg:updated');
    showNotification(`已更新快捷消息 "${message.name}"`, 'success');

    return true;
}

/**
 * 删除快捷消息
 * @param {string} id - 消息 ID
 * @returns {boolean} 是否删除成功
 */
export function deleteQuickMessage(id) {
    const index = state.quickMessages.findIndex(m => m.id === id);
    if (index === -1) {
        showNotification('快捷消息不存在', 'error');
        return false;
    }

    const message = state.quickMessages[index];
    state.quickMessages.splice(index, 1);

    saveQuickMessagesToStorage();
    saveCurrentConfig();

    eventBus.emit('quickmsg:updated');
    showNotification(`已删除快捷消息 "${message.name}"`, 'info');

    return true;
}

/**
 * 获取快捷消息
 * @param {string} id - 消息 ID
 * @returns {Object|null} 快捷消息对象
 */
export function getQuickMessage(id) {
    return state.quickMessages.find(m => m.id === id) || null;
}

/**
 * 获取所有快捷消息
 * @returns {Array} 快捷消息数组
 */
export function getAllQuickMessages() {
    return state.quickMessages;
}

/**
 * 发送快捷消息（填充到输入框）
 * @param {string} id - 消息 ID
 */
export function sendQuickMessage(id) {
    const message = getQuickMessage(id);
    if (!message) {
        showNotification('快捷消息不存在', 'error');
        return;
    }

    // 1. 填充输入框
    elements.userInput.value = message.content;

    // 2. 调整文本框高度（复用现有函数）
    import('../ui/resize.js').then(({ autoResizeTextarea }) => {
        if (autoResizeTextarea) {
            autoResizeTextarea();
        }
    });

    // 3. 聚焦输入框
    elements.userInput.focus();

    // 4. 关闭模态框
    eventBus.emit('quickmsg:modal-close-requested');

    showNotification(`已填充快捷消息 "${message.name}"`, 'info');
}
