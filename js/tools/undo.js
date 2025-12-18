/**
 * 工具调用撤销系统
 * 允许用户撤销最近的工具调用，恢复到调用前的消息状态
 *
 * 发布事件:
 * - tool:undo:created { undoId, snapshot }
 * - tool:undo:executed { undoId, success }
 * - tool:undo:cleared
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { renderSessionMessages } from '../messages/restore.js';

// ========== 状态管理 ==========

// 撤销栈（最近的在最前面）
const undoStack = [];
const MAX_UNDO_STACK_SIZE = 10;

// 当前是否可撤销
let canUndo = false;

// ========== 快照管理 ==========

/**
 * 创建消息状态快照
 * @param {Object} metadata - 快照元数据
 * @returns {Object} 快照对象
 */
export function createSnapshot(metadata = {}) {
    const snapshot = {
        id: generateUndoId(),
        timestamp: Date.now(),
        datetime: new Date().toISOString(),

        // 保存消息状态（深拷贝）
        messages: JSON.parse(JSON.stringify(state.messages)),
        geminiContents: JSON.parse(JSON.stringify(state.geminiContents)),
        claudeContents: JSON.parse(JSON.stringify(state.claudeContents)),

        // 保存 UI 状态
        currentAssistantMessage: state.currentAssistantMessage,

        // 元数据
        metadata: {
            sessionId: state.currentSessionId,
            messageCount: state.messages.length,
            ...metadata
        }
    };

    // 推入撤销栈
    undoStack.unshift(snapshot);

    // 限制栈大小
    if (undoStack.length > MAX_UNDO_STACK_SIZE) {
        undoStack.pop();
    }

    canUndo = true;

    console.log('[Undo] 📸 创建快照:', snapshot.id, metadata);

    eventBus.emit('tool:undo:created', {
        undoId: snapshot.id,
        snapshot: {
            id: snapshot.id,
            timestamp: snapshot.timestamp,
            messageCount: snapshot.metadata.messageCount
        }
    });

    return snapshot;
}

/**
 * 执行撤销操作
 * @returns {Object|null} 撤销结果
 */
export function undo() {
    if (!canUndo || undoStack.length === 0) {
        console.warn('[Undo] ⚠️ 没有可撤销的操作');
        return null;
    }

    const snapshot = undoStack.shift();

    console.log('[Undo] ⏪ 执行撤销:', snapshot.id);

    try {
        // 恢复消息状态
        state.messages = JSON.parse(JSON.stringify(snapshot.messages));
        state.geminiContents = JSON.parse(JSON.stringify(snapshot.geminiContents));
        state.claudeContents = JSON.parse(JSON.stringify(snapshot.claudeContents));
        state.currentAssistantMessage = snapshot.currentAssistantMessage;

        // 重新渲染消息列表
        renderSessionMessages();

        // 更新可撤销状态
        canUndo = undoStack.length > 0;

        console.log('[Undo] 撤销成功，已恢复到:', snapshot.datetime);

        eventBus.emit('tool:undo:executed', {
            undoId: snapshot.id,
            success: true,
            restoredMessageCount: snapshot.messages.length
        });

        return {
            success: true,
            snapshot: {
                id: snapshot.id,
                timestamp: snapshot.timestamp,
                messageCount: snapshot.messages.length
            }
        };

    } catch (error) {
        console.error('[Undo] ❌ 撤销失败:', error);

        // 失败时，将快照放回栈顶
        undoStack.unshift(snapshot);

        eventBus.emit('tool:undo:executed', {
            undoId: snapshot.id,
            success: false,
            error: error.message
        });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 清除撤销栈
 */
export function clearUndoStack() {
    undoStack.length = 0;
    canUndo = false;

    console.log('[Undo] 🗑️ 撤销栈已清空');

    eventBus.emit('tool:undo:cleared');
}

/**
 * 获取撤销栈信息
 * @returns {Object} 撤销栈状态
 */
export function getUndoStackInfo() {
    return {
        canUndo,
        stackSize: undoStack.length,
        maxStackSize: MAX_UNDO_STACK_SIZE,
        snapshots: undoStack.map(s => ({
            id: s.id,
            timestamp: s.timestamp,
            datetime: s.datetime,
            messageCount: s.metadata.messageCount,
            sessionId: s.metadata.sessionId
        }))
    };
}

/**
 * 撤销到指定快照
 * @param {string} snapshotId - 快照 ID
 * @returns {Object|null} 撤销结果
 */
export function undoToSnapshot(snapshotId) {
    const index = undoStack.findIndex(s => s.id === snapshotId);

    if (index === -1) {
        console.warn('[Undo] ⚠️ 快照不存在:', snapshotId);
        return null;
    }

    // 移除目标快照之前的所有快照
    const removed = undoStack.splice(0, index);

    console.log(`[Undo] ⏪ 撤销到快照 ${snapshotId}，移除了 ${removed.length} 个后续快照`);

    // 执行撤销
    return undo();
}

/**
 * 检查是否可以撤销
 * @returns {boolean}
 */
export function canUndoNow() {
    return canUndo && undoStack.length > 0;
}

/**
 * 生成撤销 ID
 * @returns {string}
 */
function generateUndoId() {
    return `undo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ========== 工具调用集成 ==========

/**
 * 在工具调用前创建快照
 * @param {Array} toolCalls - 工具调用列表
 * @returns {Object} 快照对象
 */
export function snapshotBeforeToolCall(toolCalls) {
    const toolNames = toolCalls.map(tc => {
        const funcCall = tc.function || tc;
        return funcCall.name || 'unknown';
    }).join(', ');

    return createSnapshot({
        type: 'tool_call',
        toolNames,
        toolCount: toolCalls.length,
        reason: `工具调用前快照: ${toolNames}`
    });
}

/**
 * 撤销最近的工具调用
 * @returns {Object|null}
 */
export function undoLastToolCall() {
    // 查找最近的工具调用快照
    const toolCallSnapshot = undoStack.find(s => s.metadata.type === 'tool_call');

    if (!toolCallSnapshot) {
        console.warn('[Undo] ⚠️ 没有找到工具调用快照');
        return null;
    }

    return undoToSnapshot(toolCallSnapshot.id);
}

// ========== 初始化 ==========

console.log('[Undo] ⏪ 工具调用撤销系统已加载');

