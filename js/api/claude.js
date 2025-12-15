/**
 * Claude API 请求处理器
 * 支持 Anthropic Claude Messages API
 */

import { state } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages } from '../utils/prefill.js';
import { processVariables } from '../utils/variables.js';
import { filterMessagesByCapabilities } from '../utils/message-filter.js';
import { getCurrentModelCapabilities } from '../providers/manager.js';
import { getOrCreateMappedId } from './format-converter.js';  // ✅ P0: ID 重映射

/**
 * 转换消息格式为 Claude 格式
 * @param {Array} messages - OpenAI 格式的消息数组
 * @returns {Array} Claude 格式的消息数组
 */
function convertToClaudeMessages(messages) {
    // Claude API 中 system 是顶级参数，messages 中只能有 user 和 assistant
    // 过滤掉 system 消息，避免被错误转换成 user
    return messages
        .filter(msg => msg.role !== 'system')
        .map(msg => {
            // ⭐ 处理工具调用消息（assistant with tool_calls）
            if (msg.role === 'assistant' && msg.tool_calls) {
                const content = [];

                // ✅ 修复：当启用 thinking 时，先添加 thinking block（必须在 tool_use 之前）
                if (state.thinkingEnabled && msg.thinkingContent) {
                    const thinkingBlock = {
                        type: 'thinking',
                        thinking: msg.thinkingContent
                    };
                    // ✅ 添加签名（如果有）
                    if (msg.thinkingSignature) {
                        thinkingBlock.signature = msg.thinkingSignature;
                    }
                    content.push(thinkingBlock);
                }

                // 添加 tool_use blocks
                msg.tool_calls.forEach(tc => {
                    // 解析 arguments（可能是字符串）
                    let input;
                    try {
                        input = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {
                        input = {};
                    }

                    // ✅ P0: ID 重映射（OpenAI → Claude）
                    const claudeId = getOrCreateMappedId(tc.id, 'claude');

                    content.push({
                        type: 'tool_use',
                        id: claudeId,
                        name: tc.function.name,
                        input: input
                    });
                });

                return {
                    role: 'assistant',
                    content: content
                };
            }

            // ⭐ 处理工具结果消息（role: 'tool'）
            if (msg.role === 'tool') {
                // ✅ P0: ID 重映射（OpenAI → Claude）
                const claudeId = getOrCreateMappedId(msg.tool_call_id, 'claude');

                return {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: claudeId,
                        content: msg.content  // Claude 要求是字符串
                    }]
                };
            }

            // Claude 只支持 user 和 assistant 两种角色
            const role = msg.role === 'assistant' ? 'assistant' : 'user';

            // 处理多模态内容
            if (Array.isArray(msg.content)) {
                const content = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text };
                    } else if (part.type === 'thinking') {
                        // Thinking blocks 应该跳过（Claude API 会自动处理）
                        // 根据官方文档：非工具场景会自动移除，工具场景需要保持原样
                        // 但由于我们的内部格式使用 OpenAI 风格，这里跳过即可
                        return null;
                    } else if (part.type === 'image_url') {
                        // 提取 base64 数据
                        const matches = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                        if (matches) {
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: matches[1],
                                    data: matches[2]
                                }
                            };
                        }
                    }
                    return null;
                }).filter(Boolean);

                return { role, content };
            }

            // ⭐ 处理纯文本 assistant 消息
            // 如果启用 thinking 且有 thinkingContent，需要转换为多模态格式
            if (role === 'assistant' && state.thinkingEnabled && msg.thinkingContent) {
                const content = [];

                // 添加 thinking block
                const thinkingBlock = {
                    type: 'thinking',
                    thinking: msg.thinkingContent
                };
                // ✅ 添加签名（如果有）
                if (msg.thinkingSignature) {
                    thinkingBlock.signature = msg.thinkingSignature;
                }
                content.push(thinkingBlock);

                // 添加文本内容（如果有）
                if (msg.content && msg.content.trim()) {
                    content.push({
                        type: 'text',
                        text: msg.content
                    });
                }

                return { role, content };
            }

            return { role, content: msg.content };
        });
}

/**
 * 发送 Claude 格式的请求
 * @param {string} endpoint - API 端点
 * @param {string} apiKey - API 密钥
 * @param {string} model - 模型名称
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<Response>} Fetch Response
 */
export async function sendClaudeRequest(endpoint, apiKey, model, signal = null) {
    // 转换消息格式为 Claude Messages API（过滤掉错误消息）
    let messages = state.messages.filter(m => !m.isError);

    // ✅ 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        messages = filterMessagesByCapabilities(messages, capabilities);
        console.log('📋 [Claude] 消息已根据模型能力过滤:', {
            capabilities,
            filteredCount: messages.length
        });
    }

    // 转换为 Claude 格式（使用过滤后的消息）
    let claudeMessages = convertToClaudeMessages(messages);

    // ✅ 预填充消息追加到末尾（用户最新消息之后）
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages();
        claudeMessages = [...claudeMessages, ...prefill];
    }

    // 构建请求体
    const requestBody = {
        model: model,
        messages: claudeMessages,
        stream: state.streamEnabled,
        ...buildModelParams('claude'), // 包含 max_tokens（默认 8192）及其他参数
    };

    // ✅ Claude 的 system 是顶层参数（独立于预填充开关）
    if (state.systemPrompt) {
        requestBody.system = processVariables(state.systemPrompt);
    }

    // 添加思维链配置 (Claude Extended Thinking)
    const claudeThinkingConfig = buildThinkingConfig('claude');
    if (claudeThinkingConfig) Object.assign(requestBody, claudeThinkingConfig);

    // ⭐ 添加工具调用支持 (Tool Use)
    const tools = [];

    // 保留原有的 web_search（用户要求保持不变）
    if (state.webSearchEnabled) {
        tools.push({
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5
        });
    }

    // 添加工具系统中的工具
    try {
        const { getToolsForAPI } = await import('../tools/manager.js');
        const systemTools = getToolsForAPI('claude');
        tools.push(...systemTools);
    } catch (error) {
        console.warn('[Claude] 工具系统未加载:', error);
    }

    if (tools.length > 0) {
        if (state.xmlToolCallingEnabled) {
            // ✅ XML 模式：只注入 XML 到 system 参数，不使用原生 tools 字段
            const { injectToolsToClaude, getXMLInjectionStats } = await import('../tools/tool-injection.js');
            injectToolsToClaude(requestBody, tools);

            // ✅ P1: 性能监控
            const stats = getXMLInjectionStats(tools);
            console.log('[Claude] 📊 XML 模式启用，注入统计:', stats);
        } else {
            // ✅ 原生模式：使用标准 tools 字段
            requestBody.tools = tools;
            console.log('[Claude] 📊 原生 tools 模式，工具数量:', tools.length);
        }
    }

    console.log('Sending Claude request:', JSON.stringify(requestBody, null, 2));

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            ...getCustomHeadersObject(), // 合并自定义请求头
        },
        body: JSON.stringify(requestBody),
    };
    if (signal) options.signal = signal;

    return await fetch(endpoint, options);
}

/**
 * 构建 Claude 工具结果消息（OpenAI 格式）
 * 注意：返回 OpenAI 格式的消息，由 convertToClaudeMessages 在发送时转换为 Claude 格式
 * @param {Array} toolCalls - 工具调用列表 [{id, name, arguments}]
 * @param {Array} toolResults - 工具结果列表 [{role: 'tool', content, tool_call_id}]
 * @returns {Array} OpenAI 格式的消息数组（存储在 state.messages 中）
 */
export function buildToolResultMessages(toolCalls, toolResults) {
    // ✅ 与 OpenAI/Gemini 保持一致：返回 OpenAI 格式
    // convertToClaudeMessages 会将这些消息转换为 Claude 格式
    const messages = [
        // 1. 添加助手消息（包含工具调用）- OpenAI 格式
        {
            role: 'assistant',
            tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments)
                }
            }))
        },
        // 2. 添加工具结果消息 - OpenAI 格式（附加工具名称用于 Claude 转换）
        ...toolResults.map(result => {
            // 查找对应的工具调用以获取名称
            const toolCall = toolCalls.find(tc => tc.id === result.tool_call_id);
            return {
                ...result,
                _toolName: toolCall?.name  // ⭐ 附加工具名称（Claude 转换时可能需要）
            };
        })
    ];

    return messages;
}
