/**
 * 工具调用历史管理模块
 * 记录、查询、导出工具调用历史
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { debouncedSaveSession } from '../state/sessions.js';

/**
 * 记录工具调用
 * @param {Object} record - 工具调用记录
 * @param {string} record.toolId - 工具ID
 * @param {string} record.toolName - 工具名称
 * @param {Object} record.args - 参数
 * @param {Object} record.result - 结果
 * @param {boolean} record.success - 是否成功
 * @param {number} record.duration - 执行时长（毫秒）
 * @param {string} record.error - 错误信息（如果失败）
 */
export function recordToolCall(record) {
    if (!state.toolHistoryEnabled) {
        return;
    }

    const historyEntry = {
        id: generateHistoryId(),
        timestamp: Date.now(),
        datetime: new Date().toISOString(),
        sessionId: state.currentSessionId,
        ...record
    };

    // 添加到历史记录
    state.toolCallHistory.unshift(historyEntry); // 最新的在前面

    // 限制历史记录数量
    if (state.toolCallHistory.length > state.maxToolHistorySize) {
        state.toolCallHistory = state.toolCallHistory.slice(0, state.maxToolHistorySize);
    }

    // 发布事件
    eventBus.emit('tool:history:added', { entry: historyEntry });

    // 保存到 localStorage
    saveToolHistory();

    console.log(`[ToolHistory] 记录工具调用: ${record.toolName}`, {
        success: record.success,
        duration: `${record.duration}ms`
    });
}

/**
 * 获取工具调用历史
 * @param {Object} options - 查询选项
 * @param {number} options.limit - 返回数量限制
 * @param {string} options.toolName - 按工具名称过滤
 * @param {boolean} options.success - 按成功/失败过滤
 * @param {string} options.sessionId - 按会话ID过滤
 * @param {number} options.since - 从指定时间戳之后的记录
 * @returns {Array} 历史记录数组
 */
export function getToolHistory(options = {}) {
    let history = [...state.toolCallHistory];

    // 应用过滤器
    if (options.toolName) {
        history = history.filter(entry => entry.toolName === options.toolName);
    }

    if (options.success !== undefined) {
        history = history.filter(entry => entry.success === options.success);
    }

    if (options.sessionId) {
        history = history.filter(entry => entry.sessionId === options.sessionId);
    }

    if (options.since) {
        history = history.filter(entry => entry.timestamp >= options.since);
    }

    // 限制返回数量
    if (options.limit) {
        history = history.slice(0, options.limit);
    }

    return history;
}

/**
 * 获取工具调用统计信息
 * @param {Object} options - 统计选项
 * @returns {Object} 统计信息
 */
export function getToolStats(options = {}) {
    const history = getToolHistory(options);

    const stats = {
        total: history.length,
        success: 0,
        failed: 0,
        avgDuration: 0,
        byTool: {},
        bySession: {},
        recentErrors: []
    };

    let totalDuration = 0;

    history.forEach(entry => {
        // 成功/失败统计
        if (entry.success) {
            stats.success++;
        } else {
            stats.failed++;
            if (stats.recentErrors.length < 10) {
                stats.recentErrors.push({
                    toolName: entry.toolName,
                    error: entry.error,
                    timestamp: entry.timestamp,
                    datetime: entry.datetime
                });
            }
        }

        // 执行时长统计
        if (entry.duration) {
            totalDuration += entry.duration;
        }

        // 按工具统计
        if (!stats.byTool[entry.toolName]) {
            stats.byTool[entry.toolName] = {
                total: 0,
                success: 0,
                failed: 0,
                avgDuration: 0,
                totalDuration: 0
            };
        }
        const toolStats = stats.byTool[entry.toolName];
        toolStats.total++;
        if (entry.success) {
            toolStats.success++;
        } else {
            toolStats.failed++;
        }
        if (entry.duration) {
            toolStats.totalDuration += entry.duration;
        }

        // 按会话统计
        if (entry.sessionId) {
            if (!stats.bySession[entry.sessionId]) {
                stats.bySession[entry.sessionId] = 0;
            }
            stats.bySession[entry.sessionId]++;
        }
    });

    // 计算平均时长
    if (history.length > 0) {
        stats.avgDuration = Math.round(totalDuration / history.length);
    }

    // 计算每个工具的平均时长
    Object.keys(stats.byTool).forEach(toolName => {
        const toolStats = stats.byTool[toolName];
        if (toolStats.total > 0) {
            toolStats.avgDuration = Math.round(toolStats.totalDuration / toolStats.total);
        }
        delete toolStats.totalDuration; // 删除中间计算字段
    });

    return stats;
}

/**
 * 清除工具调用历史
 * @param {Object} options - 清除选项
 * @param {string} options.toolName - 仅清除指定工具的历史
 * @param {string} options.sessionId - 仅清除指定会话的历史
 * @param {number} options.before - 清除指定时间戳之前的记录
 */
export function clearToolHistory(options = {}) {
    if (!options.toolName && !options.sessionId && !options.before) {
        // 清除所有历史
        state.toolCallHistory = [];
        console.log('[ToolHistory] 已清除所有工具调用历史');
    } else {
        // 有条件地清除
        const originalLength = state.toolCallHistory.length;

        state.toolCallHistory = state.toolCallHistory.filter(entry => {
            if (options.toolName && entry.toolName === options.toolName) {
                return false;
            }
            if (options.sessionId && entry.sessionId === options.sessionId) {
                return false;
            }
            if (options.before && entry.timestamp < options.before) {
                return false;
            }
            return true;
        });

        const removedCount = originalLength - state.toolCallHistory.length;
        console.log(`[ToolHistory] 已清除 ${removedCount} 条工具调用历史`);
    }

    // 保存到 localStorage
    saveToolHistory();

    // 发布事件
    eventBus.emit('tool:history:cleared', { options });
}

/**
 * 导出工具调用历史
 * @param {string} format - 导出格式 ('json' | 'csv')
 * @returns {string} 导出的数据
 */
export function exportToolHistory(format = 'json') {
    const history = getToolHistory();

    if (format === 'json') {
        return JSON.stringify(history, null, 2);
    } else if (format === 'csv') {
        return convertToCSV(history);
    } else {
        throw new Error(`不支持的导出格式: ${format}`);
    }
}

/**
 * 导入工具调用历史
 * @param {string} data - 导入的数据（JSON 格式）
 * @param {Object} options - 导入选项
 * @param {boolean} options.merge - 是否合并到现有历史（默认 false，替换）
 */
export function importToolHistory(data, options = {}) {
    try {
        const imported = JSON.parse(data);

        if (!Array.isArray(imported)) {
            throw new Error('导入数据必须是数组格式');
        }

        if (options.merge) {
            // 合并到现有历史
            state.toolCallHistory = [...imported, ...state.toolCallHistory];

            // 限制数量
            if (state.toolCallHistory.length > state.maxToolHistorySize) {
                state.toolCallHistory = state.toolCallHistory.slice(0, state.maxToolHistorySize);
            }
        } else {
            // 替换现有历史
            state.toolCallHistory = imported;
        }

        // 保存到 localStorage
        saveToolHistory();

        console.log(`[ToolHistory] 已导入 ${imported.length} 条工具调用历史`);

        // 发布事件
        eventBus.emit('tool:history:imported', { count: imported.length, merge: options.merge });

        return imported.length;

    } catch (error) {
        console.error('[ToolHistory] 导入失败:', error);
        throw new Error(`导入工具历史失败: ${error.message}`);
    }
}

/**
 * 保存工具历史到 localStorage
 */
function saveToolHistory() {
    try {
        // 输入验证：确保 toolCallHistory 是数组
        if (!Array.isArray(state.toolCallHistory)) {
            console.error('[ToolHistory] ❌ toolCallHistory 不是数组，无法保存');
            state.toolCallHistory = []; // 重置为空数组
            return;
        }

        localStorage.setItem('toolCallHistory', JSON.stringify(state.toolCallHistory));
    } catch (error) {
        console.error('[ToolHistory] 保存历史失败:', error);
    }
}

/**
 * 从 localStorage 加载工具历史
 */
export function loadToolHistory() {
    try {
        const saved = localStorage.getItem('toolCallHistory');
        if (saved) {
            const parsed = JSON.parse(saved);

            // 输入验证：确保加载的数据是数组
            if (!Array.isArray(parsed)) {
                console.error('[ToolHistory] ❌ 加载的数据不是数组，已重置');
                state.toolCallHistory = [];
                return;
            }

            state.toolCallHistory = parsed;
            console.log(`[ToolHistory] 已加载 ${state.toolCallHistory.length} 条历史记录`);
        }
    } catch (error) {
        console.error('[ToolHistory] 加载历史失败:', error);
        state.toolCallHistory = [];
    }
}

/**
 * 生成历史记录 ID
 * @returns {string}
 */
function generateHistoryId() {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 转换为 CSV 格式
 * @param {Array} history - 历史记录
 * @returns {string}
 */
function convertToCSV(history) {
    if (history.length === 0) {
        return '';
    }

    // CSV 表头
    const headers = ['timestamp', 'datetime', 'toolName', 'success', 'duration', 'error', 'sessionId'];
    let csv = headers.join(',') + '\n';

    // CSV 数据行
    history.forEach(entry => {
        const row = [
            entry.timestamp,
            `"${entry.datetime}"`,
            `"${entry.toolName}"`,
            entry.success,
            entry.duration || '',
            entry.error ? `"${entry.error.replace(/"/g, '""')}"` : '',
            entry.sessionId || ''
        ];
        csv += row.join(',') + '\n';
    });

    return csv;
}

/**
 * 启用/禁用历史记录
 * @param {boolean} enabled - 是否启用
 */
export function setToolHistoryEnabled(enabled) {
    state.toolHistoryEnabled = enabled;
    console.log(`[ToolHistory] 历史记录已${enabled ? '启用' : '禁用'}`);

    // 保存配置
    debouncedSaveSession();

    // 发布事件
    eventBus.emit('tool:history:enabled-changed', { enabled });
}

/**
 * 设置最大历史记录数量
 * @param {number} maxSize - 最大数量
 */
export function setMaxToolHistorySize(maxSize) {
    state.maxToolHistorySize = maxSize;

    // 如果当前历史超过新的限制，裁剪
    if (state.toolCallHistory.length > maxSize) {
        state.toolCallHistory = state.toolCallHistory.slice(0, maxSize);
        saveToolHistory();
    }

    console.log(`[ToolHistory] 最大历史记录数已设为: ${maxSize}`);

    // 保存配置
    debouncedSaveSession();
}

console.log('[ToolHistory] 📚 工具调用历史管理模块已加载');
