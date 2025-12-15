/**
 * 工具调用消息兼容性模块
 * 确保工具调用消息与现有的编辑、删除功能兼容
 *
 * 处理的兼容性问题：
 * 1. 删除包含 tool_calls 的消息时，自动删除对应的工具结果消息
 * 2. 删除工具结果消息时，警告用户
 * 3. 防止编辑包含 tool_calls 的助手消息
 * 4. 为 role: 'tool' 消息提供正确的渲染
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { removeMessageAt } from '../core/state-mutations.js';

// ========== 消息删除兼容性 ==========

/**
 * 检查消息是否包含工具调用
 * @param {Object} message - 消息对象
 * @returns {boolean}
 */
export function hasToolCalls(message) {
    return message && message.tool_calls && message.tool_calls.length > 0;
}

/**
 * 检查消息是否是工具结果
 * @param {Object} message - 消息对象
 * @returns {boolean}
 */
export function isToolResult(message) {
    return message && message.role === 'tool';
}

/**
 * 查找与工具调用关联的所有工具结果消息
 * @param {number} assistantMessageIndex - 包含 tool_calls 的助手消息索引
 * @returns {Array<number>} 工具结果消息的索引列表
 */
export function findAssociatedToolResults(assistantMessageIndex) {
    const messages = state.messages;
    const assistantMessage = messages[assistantMessageIndex];

    if (!hasToolCalls(assistantMessage)) {
        return [];
    }

    // 提取所有 tool_call_id
    const toolCallIds = new Set(
        assistantMessage.tool_calls.map(tc => tc.id)
    );

    // 查找后续的工具结果消息
    const resultIndices = [];
    for (let i = assistantMessageIndex + 1; i < messages.length; i++) {
        const msg = messages[i];
        if (isToolResult(msg) && toolCallIds.has(msg.tool_call_id)) {
            resultIndices.push(i);
        }
        // 遇到下一条助手或用户消息时停止查找
        if (msg.role === 'assistant' || msg.role === 'user') {
            break;
        }
    }

    return resultIndices;
}

/**
 * 查找工具结果消息对应的助手消息
 * @param {number} toolResultIndex - 工具结果消息索引
 * @returns {number|null} 助手消息索引，如果未找到返回 null
 */
export function findAssociatedAssistantMessage(toolResultIndex) {
    const messages = state.messages;
    const toolResultMessage = messages[toolResultIndex];

    if (!isToolResult(toolResultMessage)) {
        return null;
    }

    const toolCallId = toolResultMessage.tool_call_id;

    // 向前查找包含此 tool_call_id 的助手消息
    for (let i = toolResultIndex - 1; i >= 0; i--) {
        const msg = messages[i];
        if (hasToolCalls(msg)) {
            const found = msg.tool_calls.some(tc => tc.id === toolCallId);
            if (found) {
                return i;
            }
        }
    }

    return null;
}

/**
 * 安全删除消息（兼容工具调用）
 * @param {number} index - 消息索引
 * @returns {Object} 删除结果 { success, deletedIndices, warnings }
 */
export function safeDeleteMessage(index) {
    const messages = state.messages;
    const message = messages[index];

    if (!message) {
        return {
            success: false,
            error: '消息不存在'
        };
    }

    const deletedIndices = [index];
    const warnings = [];

    // 情况1：删除包含 tool_calls 的助手消息
    if (hasToolCalls(message)) {
        const toolResultIndices = findAssociatedToolResults(index);

        if (toolResultIndices.length > 0) {
            warnings.push(
                `此消息包含 ${message.tool_calls.length} 个工具调用，` +
                `将同时删除 ${toolResultIndices.length} 条工具结果消息`
            );
            deletedIndices.push(...toolResultIndices);
        }
    }

    // 情况2：删除工具结果消息
    if (isToolResult(message)) {
        const assistantIndex = findAssociatedAssistantMessage(index);

        if (assistantIndex !== null) {
            warnings.push(
                '此消息是工具结果，删除后可能导致对话上下文不完整。' +
                '建议同时删除对应的助手消息。'
            );
        }
    }

    // 按降序删除（避免索引偏移）
    const sortedIndices = [...new Set(deletedIndices)].sort((a, b) => b - a);

    for (const idx of sortedIndices) {
        removeMessageAt(idx);
    }

    return {
        success: true,
        deletedIndices: sortedIndices,
        warnings
    };
}

// ========== 消息编辑兼容性 ==========

/**
 * 检查消息是否可编辑
 * @param {number} index - 消息索引
 * @returns {Object} { canEdit, reason }
 */
export function canEditMessage(index) {
    const messages = state.messages;
    const message = messages[index];

    if (!message) {
        return {
            canEdit: false,
            reason: '消息不存在'
        };
    }

    // 不允许编辑包含 tool_calls 的助手消息
    if (message.role === 'assistant' && hasToolCalls(message)) {
        return {
            canEdit: false,
            reason: '包含工具调用的助手消息不可编辑，请删除后重新发送'
        };
    }

    // 不允许编辑工具结果消息
    if (isToolResult(message)) {
        return {
            canEdit: false,
            reason: '工具结果消息不可编辑'
        };
    }

    // 用户消息可编辑
    if (message.role === 'user') {
        return {
            canEdit: true
        };
    }

    // 其他助手消息可编辑
    if (message.role === 'assistant') {
        return {
            canEdit: true
        };
    }

    return {
        canEdit: false,
        reason: '此类型消息不可编辑'
    };
}

// ========== 消息渲染辅助 ==========

/**
 * 检查消息是否应该在 UI 中显示
 * @param {Object} message - 消息对象
 * @returns {boolean}
 */
export function shouldRenderMessage(message) {
    // 工具结果消息不单独显示（已在工具调用 UI 中显示）
    if (isToolResult(message)) {
        return false;
    }

    // 包含 tool_calls 但没有 content 的助手消息不单独显示
    if (message.role === 'assistant' && hasToolCalls(message)) {
        // 如果既有工具调用又有文本内容，则显示文本部分
        if (message.content && message.content.trim()) {
            return true;
        }
        return false;
    }

    return true;
}

/**
 * 获取用于渲染的消息列表（过滤工具消息）
 * @param {Array} messages - 原始消息列表
 * @returns {Array} 过滤后的消息列表
 */
export function getRenderableMessages(messages) {
    return messages.filter(shouldRenderMessage);
}

// ========== 辅助函数 ==========

/**
 * 从消息元素解析消息索引
 * @param {HTMLElement} messageEl - 消息DOM元素
 * @returns {number} 消息索引
 */
function resolveMessageIndex(messageEl) {
    // 方法1: 使用消息ID查找
    const messageId = messageEl.dataset?.messageId;
    if (messageId && state.messageIdMap && state.messageIdMap.has(messageId)) {
        return state.messageIdMap.get(messageId);
    }

    // 方法2: 使用 dataset.messageIndex
    const indexAttr = messageEl.dataset?.messageIndex;
    if (indexAttr !== undefined) {
        return parseInt(indexAttr, 10);
    }

    // 方法3: 使用 DOM 位置
    const messagesArea = document.getElementById('chat');
    if (messagesArea) {
        const nodes = Array.from(messagesArea.querySelectorAll('.message'));
        return nodes.indexOf(messageEl);
    }

    return -1;
}

// ========== 事件监听 ==========

// 初始化标志，防止重复注册事件监听器
let initialized = false;

/**
 * 初始化消息兼容性模块
 * 注册事件监听器（仅执行一次）
 */
export function initMessageCompat() {
    if (initialized) {
        console.warn('[MessageCompat] ⚠️ 模块已初始化，跳过重复注册');
        return;
    }

    initialized = true;

    // ✅ 注意：这些监听器用于提供警告和通知，不拦截原有流程
    // 实际的拦截逻辑在 editor.js 中实现

    // 监听删除消息事件（提供警告）
    eventBus.on('message:delete-requested', ({ messageEl }) => {
        const index = resolveMessageIndex(messageEl);
        if (index === -1) return;

        const message = state.messages[index];
        if (!message) return;

        // 检查是否有关联的工具调用或工具结果
        const warnings = [];

        if (hasToolCalls(message)) {
            const toolResultIndices = findAssociatedToolResults(index);
            if (toolResultIndices.length > 0) {
                warnings.push(
                    `此消息包含 ${message.tool_calls.length} 个工具调用，` +
                    `将同时删除 ${toolResultIndices.length} 条关联的工具结果消息`
                );
            }
        }

        if (isToolResult(message)) {
            const assistantIndex = findAssociatedAssistantMessage(index);
            if (assistantIndex !== null) {
                warnings.push(
                    '此消息是工具执行结果，删除后可能导致对话上下文不完整'
                );
            }
        }

        if (warnings.length > 0) {
            console.warn('[MessageCompat] 删除消息警告:', warnings.join('\n'));
            // 通过 UI 显示警告（不阻止删除，只是提醒）
            eventBus.emit('ui:notification', {
                message: warnings[0],
                type: 'warning',
                duration: 3000
            });
        }
    });

    // 监听编辑消息事件（检查是否可编辑）
    eventBus.on('message:edit-requested', ({ messageEl }) => {
        const index = resolveMessageIndex(messageEl);
        if (index === -1) return;

        const checkResult = canEditMessage(index);

        if (!checkResult.canEdit) {
            console.warn('[MessageCompat] 消息不可编辑:', checkResult.reason);
            eventBus.emit('ui:notification', {
                message: checkResult.reason,
                type: 'error',
                duration: 3000
            });
            // 发出阻止事件（但需要 editor.js 监听并响应）
            eventBus.emit('message:edit-blocked', { index, reason: checkResult.reason });
        }
    });

    console.log('[MessageCompat] 🔧 工具调用消息兼容性模块已加载');
}

// 自动初始化（模块加载时）
initMessageCompat();

