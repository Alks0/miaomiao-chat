/**
 * 流式工具调用处理器
 * 处理 OpenAI 流式响应中的工具调用
 */

import { eventBus } from '../core/events.js';
import { executeTool } from '../tools/executor.js';
import { createToolCallUI, updateToolCallStatus } from '../ui/tool-display.js';
import { getOrCreateMappedId } from '../api/format-converter.js';  // ✅ P0: ID 转换
import { state } from '../core/state.js';  // ✅ 访问应用状态

/**
 * 工具调用累积器
 * 用于累积流式传输的工具调用参数
 */
class ToolCallAccumulator {
    constructor() {
        // Map<index, {id, name, arguments}>
        this.calls = new Map();
    }

    /**
     * 处理工具调用增量
     * @param {Array} toolCallsDeltas - 工具调用增量数组
     */
    processDelta(toolCallsDeltas) {
        if (!Array.isArray(toolCallsDeltas)) return;

        for (const delta of toolCallsDeltas) {
            const index = delta.index;

            if (!this.calls.has(index)) {
                // 初始化新的工具调用
                this.calls.set(index, {
                    id: delta.id || '',
                    type: delta.type || 'function',
                    name: '',
                    arguments: ''
                });
            }

            const call = this.calls.get(index);

            // 累积 ID
            if (delta.id) {
                call.id = delta.id;
            }

            // 累积函数名
            if (delta.function?.name) {
                call.name += delta.function.name;
            }

            // 累积参数（增量拼接）
            if (delta.function?.arguments) {
                call.arguments += delta.function.arguments;
            }
        }
    }

    /**
     * 获取所有完整的工具调用
     * @returns {Array} 工具调用列表
     */
    getCompletedCalls() {
        const completed = [];

        for (const [index, call] of this.calls.entries()) {
            if (call.name && call.arguments) {
                try {
                    // 解析参数 JSON
                    const args = JSON.parse(call.arguments);

                    completed.push({
                        id: call.id,
                        type: call.type,
                        name: call.name,
                        arguments: args
                    });
                } catch (error) {
                    console.error(`[ToolCallHandler] 工具调用 ${index} 参数解析失败:`, call.arguments);
                    console.error(error);
                }
            }
        }

        return completed;
    }

    /**
     * 清空累积器
     */
    clear() {
        this.calls.clear();
    }
}

/**
 * 执行工具调用并渲染 UI（并行执行版本）
 * @param {Array} toolCalls - 工具调用列表
 * @returns {Promise<Array>} 工具结果列表
 */
export async function executeToolCalls(toolCalls) {
    console.log(`[ToolCallHandler] 🔧 并行执行 ${toolCalls.length} 个工具调用`);

    // 🔄 创建撤销快照（在执行工具前）
    try {
        const { snapshotBeforeToolCall } = await import('../tools/undo.js');
        snapshotBeforeToolCall(toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
        })));
    } catch (err) {
        console.warn('[ToolCallHandler] 创建撤销快照失败:', err);
    }

    // 第一步：为所有工具创建 UI 并发布检测事件
    for (const toolCall of toolCalls) {
        const { id, name, arguments: args } = toolCall;

        console.log(`[ToolCallHandler] 准备执行工具: ${name}`, args);

        // 发布检测事件
        eventBus.emit('stream:tool-call-detected', {
            toolId: id,
            toolName: name,
            args
        });

        // 创建工具调用 UI
        createToolCallUI({
            id,
            name,
            args
        });
    }

    // 第二步：并行执行所有工具
    const executionPromises = toolCalls.map(async (toolCall) => {
        const { id, name, arguments: args } = toolCall;

        try {
            // 执行工具
            const result = await executeTool(name, args);

            // 更新 UI 为成功状态
            updateToolCallStatus(id, 'completed', { result });

            console.log(`[ToolCallHandler] ✅ 工具执行成功: ${name}`, result);

            // ✅ P0: 立即转换 ID 为当前格式,防止切换模型时不匹配
            const currentFormat = state.apiFormat || 'openai';
            const mappedId = getOrCreateMappedId(id, currentFormat);

            // 返回工具结果对象
            return {
                tool_call_id: mappedId,  // ✅ 使用转换后的 ID
                role: 'tool',
                content: JSON.stringify(result)
            };

        } catch (error) {
            console.error(`[ToolCallHandler] ❌ 工具执行失败: ${name}`, error);

            // 更新 UI 为失败状态
            updateToolCallStatus(id, 'failed', {
                error: error.message,
                errorCode: error.code,
                toolName: name,
                toolArgs: args
            });

            // ✅ P0: 失败时也转换 ID
            const currentFormat = state.apiFormat || 'openai';
            const mappedId = getOrCreateMappedId(id, currentFormat);

            // 即使失败也返回错误信息给 API
            // 明确告诉模型工具不可用，不要重试
            const errorMessage = error.message.includes('不存在') || error.message.includes('not found')
                ? `Tool "${name}" is not available or not registered. This tool cannot be used. Please respond to the user WITHOUT using this tool.`
                : `Tool execution failed: ${error.message}. This error cannot be fixed by retrying. Please respond to the user based on this error.`;

            return {
                tool_call_id: mappedId,  // ✅ 使用转换后的 ID
                role: 'tool',
                content: JSON.stringify({
                    error: errorMessage,
                    is_error: true
                })
            };
        }
    });

    // 第三步：等待所有工具执行完成
    const results = await Promise.all(executionPromises);

    // 发布工具结果已发送事件
    eventBus.emit('stream:tool-result-sent', {
        toolCount: toolCalls.length,
        results
    });

    console.log(`[ToolCallHandler] 🎉 所有工具执行完成: ${results.length}/${toolCalls.length}`);

    return results;
}

/**
 * 处理工具调用流（完整流程）
 * @param {Array} toolCalls - 工具调用列表
 * @param {Object} apiConfig - API 配置
 * @returns {Promise<void>}
 */
export async function handleToolCallStream(toolCalls, apiConfig) {
    console.log('[ToolCallHandler] 🚀 开始工具调用流程');

    // ✅ 保存当前消息元素引用（在 finally 块清空之前）
    const assistantMessageEl = state.currentAssistantMessage?.closest('.message');
    if (assistantMessageEl) {
        console.log('[ToolCallHandler] 保存消息元素引用用于 continuation');
    }

    try {
        // 1. 执行所有工具调用
        const toolResults = await executeToolCalls(toolCalls);

        // 2. 根据 API 格式选择正确的消息构建器
        // ✅ 修复：使用提供商的原始 apiFormat，而不是存储格式 state.apiFormat
        // 因为请求需要发送到提供商的原始格式，而 state.apiFormat 只是存储格式
        const { getCurrentProvider } = await import('../providers/manager.js');
        const provider = getCurrentProvider();
        const requestFormat = provider?.apiFormat || state.apiFormat || 'openai';
        let buildToolResultMessages;

        console.log('[ToolCallHandler] 格式选择:', {
            providerFormat: provider?.apiFormat,
            stateFormat: state.apiFormat,
            using: requestFormat
        });

        switch (requestFormat) {
            case 'gemini':
                const geminiModule = await import('../api/gemini.js');
                buildToolResultMessages = geminiModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 Gemini 格式构建工具结果消息');
                break;

            case 'claude':
                const claudeModule = await import('../api/claude.js');
                buildToolResultMessages = claudeModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 Claude 格式构建工具结果消息');
                break;

            case 'openai':
            case 'openai-responses':
            default:
                const openaiModule = await import('../api/openai.js');
                buildToolResultMessages = openaiModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 OpenAI 格式构建工具结果消息');
                break;
        }

        // 3. 构建新的消息数组（包含工具结果）
        const newMessages = buildToolResultMessages(toolCalls, toolResults);

        // 4. 发送新请求（包含工具结果）
        const { resendWithToolResults } = await import('../api/handler.js');
        await resendWithToolResults(newMessages, apiConfig, assistantMessageEl);

    } catch (error) {
        console.error('[ToolCallHandler] 工具调用流程失败:', error);

        eventBus.emit('ui:notification', {
            message: `工具调用失败: ${error.message}`,
            type: 'error'
        });
    }
}

/**
 * 创建工具调用累积器实例
 * @returns {ToolCallAccumulator}
 */
export function createToolCallAccumulator() {
    return new ToolCallAccumulator();
}
