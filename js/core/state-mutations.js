/**
 * 状态变更辅助函数
 * 提供安全的状态更新方法，避免直接突变 state 对象
 *
 * 设计原则：
 * 1. 所有数组操作返回新数组，不修改原数组
 * 2. 所有更新通过事件通知，便于调试和追踪
 * 3. 为未来的响应式系统升级做准备
 */

import { state } from './state.js';
import { eventBus } from './events.js';

/**
 * 从指定索引开始重建 messageIdMap
 * 用于删除消息后更新后续消息的索引
 * @param {number} fromIndex - 起始索引
 */
function rebuildMessageIdMapFromIndex(fromIndex) {
    if (!state.messageIdMap) return;

    // 始终从 OpenAI 格式（主存储）构建，避免格式耦合
    const messages = state.messages;

    // 更新从 fromIndex 开始的所有消息索引
    for (let i = fromIndex; i < messages.length; i++) {
        const msg = messages[i];
        const messageId = msg.id;
        if (messageId) {
            state.messageIdMap.set(messageId, i);
        }
    }
}

/**
 * 完全重建 messageIdMap
 * 用于会话恢复或格式转换时同步映射
 */
export function rebuildMessageIdMap() {
    if (!state.messageIdMap) {
        state.messageIdMap = new Map();
    } else {
        state.messageIdMap.clear();
    }

    // 始终从 OpenAI 格式（主存储）构建，避免格式耦合
    const messages = state.messages;

    messages.forEach((msg, index) => {
        const messageId = msg.id;
        if (messageId) {
            state.messageIdMap.set(messageId, index);
        }
    });

    console.log(`messageIdMap 重建完成，共 ${state.messageIdMap.size} 条消息`);
}

/**
 * 安全地向消息数组添加消息
 * 自动更新 messageIdMap
 * @param {Object} openaiMsg - OpenAI 格式消息
 * @param {Object} geminiMsg - Gemini 格式消息
 * @param {Object} claudeMsg - Claude 格式消息
 * @returns {number} 新消息的索引
 */
export function pushMessage(openaiMsg, geminiMsg, claudeMsg) {
    // ⚠️ 当前实现：直接修改（向后兼容）
    // 未来可升级为：state.messages = [...state.messages, openaiMsg]
    state.messages.push(openaiMsg);
    state.geminiContents.push(geminiMsg);
    state.claudeContents.push(claudeMsg);

    const index = state.messages.length - 1;

    // 更新 messageIdMap（如果消息有 ID）
    const messageId = openaiMsg.id || geminiMsg.id || claudeMsg.id;
    if (messageId && state.messageIdMap) {
        state.messageIdMap.set(messageId, index);
    }

    // 发出事件通知
    eventBus.emit('state:messages-pushed', {
        index,
        openaiMsg,
        geminiMsg,
        claudeMsg
    });

    return index;
}

/**
 * 安全地删除消息（通过索引）
 * 自动更新 messageIdMap，重新索引后续消息
 * @param {number} index - 消息索引
 */
export function removeMessageAt(index) {
    if (index < 0 || index >= state.messages.length) {
        console.warn(`Invalid message index: ${index}`);
        return;
    }

    // 保存被删除的消息（用于事件）
    const removedOpenai = state.messages[index];
    const removedGemini = state.geminiContents[index];
    const removedClaude = state.claudeContents[index];

    // 从 messageIdMap 中删除此消息
    const removedId = removedOpenai.id || removedGemini.id || removedClaude.id;
    if (removedId && state.messageIdMap) {
        state.messageIdMap.delete(removedId);
    }

    // ⚠️ 当前实现：直接修改（向后兼容）
    state.messages.splice(index, 1);
    state.geminiContents.splice(index, 1);
    state.claudeContents.splice(index, 1);

    // 重新索引后续消息（索引都减 1）
    if (state.messageIdMap) {
        rebuildMessageIdMapFromIndex(index);
    }

    // 发出事件通知
    eventBus.emit('state:message-removed', {
        index,
        removedOpenai,
        removedGemini,
        removedClaude
    });
}

/**
 * 安全地删除指定索引后的所有消息
 * 自动更新 messageIdMap
 * @param {number} fromIndex - 起始索引（保留该索引，删除之后的）
 */
export function removeMessagesAfter(fromIndex) {
    if (fromIndex < 0) {
        console.warn(`Invalid fromIndex: ${fromIndex}`);
        return;
    }

    const originalLength = state.messages.length;
    const removeCount = Math.max(0, originalLength - fromIndex - 1);

    if (removeCount === 0) return;

    // 从 messageIdMap 中删除被移除的消息
    if (state.messageIdMap) {
        const messages = state.messages;
        for (let i = fromIndex + 1; i < messages.length; i++) {
            const msg = messages[i];
            const messageId = msg.id;
            if (messageId) {
                state.messageIdMap.delete(messageId);
            }
        }
    }

    // ⚠️ 当前实现：直接修改（向后兼容）
    state.messages = state.messages.slice(0, fromIndex + 1);
    state.geminiContents = state.geminiContents.slice(0, fromIndex + 1);
    state.claudeContents = state.claudeContents.slice(0, fromIndex + 1);

    // 发出事件通知
    eventBus.emit('state:messages-removed-after', {
        fromIndex,
        removeCount,
        newLength: state.messages.length
    });
}

/**
 * 安全地更新消息内容
 * @param {number} index - 消息索引
 * @param {Object} updates - 更新内容 { openai?, gemini?, claude? }
 */
export function updateMessageAt(index, updates) {
    if (index < 0 || index >= state.messages.length) {
        console.warn(`Invalid message index: ${index}`);
        return;
    }

    const oldOpenai = state.messages[index];
    const oldGemini = state.geminiContents[index];
    const oldClaude = state.claudeContents[index];

    // ⚠️ 当前实现：直接修改（向后兼容）
    if (updates.openai) {
        state.messages[index] = { ...oldOpenai, ...updates.openai };
    }
    if (updates.gemini) {
        state.geminiContents[index] = { ...oldGemini, ...updates.gemini };
    }
    if (updates.claude) {
        state.claudeContents[index] = { ...oldClaude, ...updates.claude };
    }

    // 发出事件通知
    eventBus.emit('state:message-updated', {
        index,
        oldOpenai,
        oldGemini,
        oldClaude,
        newOpenai: state.messages[index],
        newGemini: state.geminiContents[index],
        newClaude: state.claudeContents[index]
    });
}

/**
 * 安全地替换整个消息数组
 * 自动重建 messageIdMap
 * @param {Array} messages - OpenAI 格式消息数组
 * @param {Array} geminiContents - Gemini 格式消息数组
 * @param {Array} claudeContents - Claude 格式消息数组
 */
export function replaceAllMessages(messages, geminiContents, claudeContents) {
    const oldLength = state.messages.length;

    // 使用数组副本（不可变更新）
    state.messages = [...messages];
    state.geminiContents = [...geminiContents];
    state.claudeContents = [...claudeContents];

    // 重建 messageIdMap
    rebuildMessageIdMap();

    // 发出事件通知
    eventBus.emit('state:messages-replaced', {
        oldLength,
        newLength: state.messages.length
    });
}

/**
 * 安全地更新状态属性
 * @param {string} key - 属性名
 * @param {*} value - 新值
 */
export function setState(key, value) {
    const oldValue = state[key];

    // ⚠️ 当前实现：直接修改（向后兼容）
    state[key] = value;

    // 发出事件通知
    eventBus.emit('state:property-changed', {
        key,
        oldValue,
        newValue: value
    });

    // 发出特定属性的事件
    eventBus.emit(`state:${key}`, {
        oldValue,
        newValue: value
    });
}

/**
 * 调试：打印状态变更统计
 */
export function logStateMutations() {
    const stats = {
        messagesPushed: 0,
        messagesRemoved: 0,
        messagesUpdated: 0,
        propertiesChanged: 0
    };

    const handlers = {
        'state:messages-pushed': () => stats.messagesPushed++,
        'state:message-removed': () => stats.messagesRemoved++,
        'state:message-updated': () => stats.messagesUpdated++,
        'state:property-changed': () => stats.propertiesChanged++
    };

    Object.entries(handlers).forEach(([event, handler]) => {
        eventBus.on(event, handler);
    });

    // 返回取消监听函数
    return () => {
        Object.entries(handlers).forEach(([event, handler]) => {
            eventBus.off(event, handler);
        });
        console.log('📊 State Mutations Statistics:', stats);
    };
}

/**
 * 未来升级路径：启用完全不可变更新
 *
 * 启用方法：
 * 1. 将所有 state.xxx = value 改为使用 Proxy
 * 2. 监听所有状态变化并发出事件
 * 3. 实现时间旅行调试功能
 *
 * 示例代码（已在 state.js 中准备，但被注释）：
 * import { ReactiveState } from './state.js';
 * export const reactiveState = new ReactiveState(state);
 */
