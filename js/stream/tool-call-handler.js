/**
 * 流式工具调用处理器
 * 处理 OpenAI 流式响应中的工具调用
 */

import { eventBus } from '../core/events.js';
import { executeTool } from '../tools/executor.js';
import { createToolCallUI, updateToolCallStatus } from '../ui/tool-display.js';
import { getOrCreateMappedId } from '../api/format-converter.js';  // ID 转换
import { state } from '../core/state.js';  // 访问应用状态
import { requestStateMachine } from '../core/request-state-machine.js';

/**
 * 处理工具返回的多媒体内容
 * 支持MCP标准格式和Claude Code Execution格式
 * @param {Object} result - 工具执行结果
 * @param {string} toolName - 工具名称
 * @returns {Promise<Object>} 增强后的结果
 */
async function enrichToolResultWithFiles(result, toolName) {
    const unwrapResultPayload = (rawResult) => {
        if (!rawResult || typeof rawResult !== 'object') return rawResult;
        if (Array.isArray(rawResult.content)) return rawResult;
        if (rawResult.result && typeof rawResult.result === 'object') return rawResult.result;
        if (Array.isArray(rawResult.result)) return { content: rawResult.result };
        return rawResult;
    };

    const attachConvertedContent = (rawResult, payload, converted) => {
        if (!rawResult || typeof rawResult !== 'object') {
            return { ...(payload || {}), ...(converted || {}) };
        }

        // MCP 客户端常见包裹结构: { success: true, result: {...} }
        if (rawResult.result && typeof rawResult.result === 'object') {
            return {
                ...rawResult,
                ...converted,
                result: {
                    ...rawResult.result,
                    ...converted
                }
            };
        }

        return {
            ...rawResult,
            ...converted
        };
    };

    const normalizedPayload = unwrapResultPayload(result);
    const persistVideoUrlIfNeeded = async (videoUrl, mimeType = '') => {
        if (!videoUrl || typeof videoUrl !== 'string') return videoUrl;
        if (!videoUrl.startsWith('data:video/')) return videoUrl;
        if (!(typeof window !== 'undefined' && window.electron?.ipcRenderer?.invoke)) return videoUrl;

        try {
            const storeResult = await window.electron.ipcRenderer.invoke('mcp:store-video', {
                dataUrl: videoUrl,
                mimeType
            });
            if (storeResult?.success && storeResult.fileUrl) {
                return storeResult.fileUrl;
            }
        } catch (error) {
            console.warn('[ToolCallHandler] 视频持久化失败，回退 Data URL:', error);
        }

        return videoUrl;
    };

    // 1. 优先处理 MCP 标准 content 数组格式（兼容包装结构）
    if (normalizedPayload && Array.isArray(normalizedPayload.content)) {
        const converted = {};
        const images = [];
        const videos = [];
        const texts = [];
        let hasContent = false;

        console.log(`[ToolCallHandler] 检测到 MCP content 数组格式，开始转换`);

        for (const item of normalizedPayload.content) {
            // 处理文本内容
            if (item.type === 'text' && item.text) {
                texts.push(item.text);
                hasContent = true;
                console.log(`[ToolCallHandler] 发现文本内容: ${item.text.substring(0, 50)}...`);
            }
            // 处理图片内容
            else if (item.type === 'image' && item.data) {
                const mimeType = item.mimeType || item.media_type || 'image/png';
                images.push({
                    type: 'image_url',
                    url: `data:${mimeType};base64,${item.data}`
                });
                hasContent = true;
                console.log(`[ToolCallHandler] 🖼️ 发现图片内容，MIME类型: ${mimeType}`);
            } else if (item.type === 'image' && item.url) {
                images.push({
                    type: 'image_url',
                    url: item.url
                });
                hasContent = true;
            }
            // 处理视频内容
            else if (item.type === 'video' && item.data) {
                const mimeType = item.mimeType || item.media_type || item.mime_type || 'video/mp4';
                const rawVideoUrl = `data:${mimeType};base64,${item.data}`;
                const persistedVideoUrl = await persistVideoUrlIfNeeded(rawVideoUrl, mimeType);
                videos.push({
                    type: 'video_url',
                    url: persistedVideoUrl,
                    mimeType
                });
                hasContent = true;
                console.log(`[ToolCallHandler] 🎬 发现视频内容，MIME类型: ${mimeType}`);
            } else if (item.type === 'video' && item.url) {
                const mimeType = item.mimeType || item.media_type || item.mime_type || '';
                const persistedVideoUrl = await persistVideoUrlIfNeeded(item.url, mimeType);
                videos.push({
                    type: 'video_url',
                    url: persistedVideoUrl,
                    mimeType
                });
                hasContent = true;
            }
        }

        // 如果成功转换了内容，返回转换后的结果
        if (hasContent) {
            // 处理文本
            if (texts.length > 0) {
                converted.text = texts.join('\n');
            }

            // 处理图片
            if (images.length === 1) {
                // 单张图片使用 image 字段（向后兼容）
                converted.image = images[0].url;
            } else if (images.length > 1) {
                // 多张图片使用 images 数组
                converted.images = images;
            }

            // 处理视频
            if (videos.length === 1) {
                converted.video = videos[0].url;
                converted.videos = videos;
            } else if (videos.length > 1) {
                converted.videos = videos;
            }

            console.log(`[ToolCallHandler] MCP 格式转换完成:`, {
                hasText: !!converted.text,
                hasImage: !!converted.image,
                imagesCount: images.length,
                videosCount: videos.length
            });

            // 保留原始结果的其他字段，并在 wrapper/result 两层都补充转换字段
            return attachConvertedContent(result, normalizedPayload, converted);
        }
    }

    // 2. 处理 Claude Code Execution 格式（保持原有逻辑）
    if (toolName && toolName.includes('code_execution')) {
        if (result && result.content && typeof result.content === 'object') {
            const content = result.content;

            // 检测 bash_code_execution_result 格式
            if (content.type === 'bash_code_execution_result' && Array.isArray(content.content)) {
                const images = [];

                for (const item of content.content) {
                    // 检测文件输出
                    if (item.type === 'file' && item.file_id) {
                        console.log(`[ToolCallHandler] 🖼️ 检测到 Code Execution 文件输出:`, item);

                        try {
                            // 下载文件
                            const fileData = await downloadClaudeFile(item.file_id);
                            if (fileData) {
                                images.push({
                                    type: 'image_url',
                                    url: `data:${item.file_type || 'image/png'};base64,${fileData}`,
                                    file_id: item.file_id
                                });
                                console.log(`[ToolCallHandler] 文件下载成功: ${item.file_id}`);
                            }
                        } catch (error) {
                            console.error(`[ToolCallHandler] ❌ 下载文件失败: ${item.file_id}`, error);
                        }
                    }
                }

                // 如果有图片，添加到结果中
                if (images.length > 0) {
                    return {
                        ...result,
                        images: images  // 添加图片数组
                    };
                }
            }
        }
    }

    // 3. 如果都不匹配，返回原始结果
    return result;
}

/**
 * 下载 Claude 文件
 * @param {string} fileId - 文件 ID
 * @returns {Promise<string>} Base64 编码的文件内容
 */
async function downloadClaudeFile(fileId) {
    // 从当前提供商获取 API key，而非硬编码 claude
    const { getCurrentProvider, getActiveApiKey } = await import('../providers/manager.js');
    const provider = getCurrentProvider();
    const apiKey = provider ? getActiveApiKey(provider.id) : state.apiKeys?.claude;
    if (!apiKey) {
        throw new Error('Claude API key not found');
    }

    try {
        const response = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'files-api-2025-04-14'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }

        // 读取文件内容为 ArrayBuffer
        const arrayBuffer = await response.arrayBuffer();

        // 转换为 base64
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        return base64;
    } catch (error) {
        console.error(`[downloadClaudeFile] 下载失败:`, error);
        throw error;
    }
}

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
            if (call.name) {
                let args;
                try {
                    // 空字符串或 null 时降级为空对象
                    args = (call.arguments != null && call.arguments !== '')
                        ? JSON.parse(call.arguments)
                        : {};
                } catch (error) {
                    console.error(`[ToolCallHandler] 工具调用 ${index} 参数解析失败:`, call.arguments);
                    console.error(error);
                    // 解析失败降级为空对象，不跳过工具调用
                    args = {};
                }

                completed.push({
                    id: call.id,
                    type: call.type,
                    name: call.name,
                    arguments: args
                });
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
        await createToolCallUI({
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
            // 使用工具名称查找执行，id 仅用于跟踪和结果回传
            const result = await executeTool(name, args);

            console.log(`[ToolCallHandler] 工具执行成功: ${name}`, result);

            // 检测并处理多媒体内容（图片、视频等）
            const enrichedResult = await enrichToolResultWithFiles(result, name);

            // 更新 UI 为成功状态（使用 enriched 结果以正确渲染图片）
            try {
                console.log(`[ToolCallHandler] 准备更新工具UI状态为completed: ${id}`);
                updateToolCallStatus(id, 'completed', { result: enrichedResult });
                console.log(`[ToolCallHandler] 工具UI状态更新完成`);
            } catch (uiError) {
                console.error(`[ToolCallHandler] ❌ 更新工具UI失败:`, uiError);
            }

            // 立即转换 ID 为当前格式,防止切换模型时不匹配
            const currentFormat = state.apiFormat || 'openai';
            const mappedId = getOrCreateMappedId(id, currentFormat);

            // 返回工具结果对象
            return {
                tool_call_id: mappedId,  // 使用转换后的 ID
                _originalId: id,  // ⭐ 保存原始 ID 用于匹配工具名称
                _toolName: name,  // ⭐ 直接保存工具名称，防止ID匹配失败
                role: 'tool',
                content: JSON.stringify(enrichedResult)
            };

        } catch (error) {
            console.error(`[ToolCallHandler] ❌ 工具执行失败: ${name}`, error);
            console.error(`[ToolCallHandler] 错误详情:`, {
                message: error.message,
                args: JSON.stringify(args, null, 2)
            });

            // 更新 UI 为失败状态
            updateToolCallStatus(id, 'failed', {
                error: error.message,
                errorCode: error.code,
                toolName: name,
                toolArgs: args
            });

            // 失败时也转换 ID
            const currentFormat = state.apiFormat || 'openai';
            const mappedId = getOrCreateMappedId(id, currentFormat);

            // 保存原始ID和工具名称
            const baseResult = {
                tool_call_id: mappedId,
                _originalId: id,
                _toolName: name,
                role: 'tool'
            };

            // 改进错误消息，明确告知不要重试
            let errorMessage;
            if (error.message.includes('Missing required parameter')) {
                // 参数缺失错误 - 明确是 schema 问题
                errorMessage = `Tool "${name}" call failed due to missing required parameter. ` +
                    `This is a parameter schema issue, not a temporary error. ` +
                    `Do NOT retry this tool call. Please respond to the user explaining the issue. ` +
                    `Error details: ${error.message}`;
            } else if (error.message.includes('不存在') || error.message.includes('not found') || error.message.includes('not available')) {
                // 工具不存在错误
                errorMessage = `Tool "${name}" is not available or not registered. ` +
                    `This tool cannot be used. Do NOT retry this tool. ` +
                    `Please respond to the user WITHOUT using this tool.`;
            } else {
                // 其他执行错误
                errorMessage = `Tool "${name}" execution failed: ${error.message}. ` +
                    `This error cannot be fixed by retrying with the same parameters. ` +
                    `Do NOT retry this tool call. Please respond to the user based on this error.`;
            }

            return {
                ...baseResult,
                content: JSON.stringify({
                    error: errorMessage,
                    is_error: true,
                    original_error: error.message,  // 保留原始错误便于调试
                    failed_args: args  // 保留失败的参数
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

    // 保存当前消息元素引用（在 finally 块清空之前）
    const assistantMessageEl = state.currentAssistantMessage?.closest('.message');
    if (assistantMessageEl) {
        console.log('[ToolCallHandler] 保存消息元素引用用于 continuation');
    }

    try {
        // 1. 执行所有工具调用
        const toolResults = await executeToolCalls(toolCalls);

        // 2. 根据 API 格式选择正确的消息构建器
        // 使用提供商的原始 apiFormat，而不是存储格式 state.apiFormat
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
            case 'gemini': {
                const geminiModule = await import('../api/gemini.js');
                buildToolResultMessages = geminiModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 Gemini 格式构建工具结果消息');
                break;
            }

            case 'claude': {
                const claudeModule = await import('../api/claude.js');
                buildToolResultMessages = claudeModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 Claude 格式构建工具结果消息');
                break;
            }

            case 'openai':
            case 'openai-responses':
            default: {
                const openaiModule = await import('../api/openai.js');
                buildToolResultMessages = openaiModule.buildToolResultMessages;
                console.log('[ToolCallHandler] 使用 OpenAI 格式构建工具结果消息');
                break;
            }
        }

        // 3. 构建新的消息数组（包含工具结果）
        const newMessages = buildToolResultMessages(toolCalls, toolResults);

        // 4. 发送新请求（包含工具结果）
        const { resendWithToolResults } = await import('../api/handler.js');
        await resendWithToolResults(newMessages, apiConfig, assistantMessageEl);

    } catch (error) {
        console.error('[ToolCallHandler] 工具调用流程失败:', error);

        // 清理工具调用标志，防止状态泄漏
        state.isToolCallPending = false;

        // 重置请求状态机，防止永久卡在 TOOL_CALLING 状态
        requestStateMachine.forceReset();

        eventBus.emit('ui:notification', {
            message: `工具调用失败: ${error.message}`,
            type: 'error'
        });

        // 强制重置按钮状态
        eventBus.emit('ui:reset-input-buttons');
    }
}

/**
 * 创建工具调用累积器实例
 * @returns {ToolCallAccumulator}
 */
export function createToolCallAccumulator() {
    return new ToolCallAccumulator();
}
