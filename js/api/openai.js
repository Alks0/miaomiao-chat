/**
 * OpenAI API 请求处理器
 * 支持 OpenAI 兼容的 API 端点
 */

import { state } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, buildVerbosityConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages, getOpeningMessages } from '../utils/prefill.js';
import { processVariables } from '../utils/variables.js';
import { filterMessagesByCapabilities } from '../utils/message-filter.js';
import { getCurrentModelCapabilities, getCurrentProvider } from '../providers/manager.js';

/**
 * 发送 OpenAI 格式的请求
 * @param {string} endpoint - API 端点
 * @param {string} apiKey - API 密钥
 * @param {string} model - 模型名称
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<Response>} Fetch Response
 */
export async function sendOpenAIRequest(endpoint, apiKey, model, signal = null) {
    // 使用提供商的原始格式（OpenAI 或 OpenAI-Responses）
    const provider = getCurrentProvider();
    const format = provider?.apiFormat || 'openai';
    const isResponsesFormat = format === 'openai-responses';
    // 端点已在 UI 层正确补全，这里做兼容处理（旧配置可能仍是 /chat/completions）
    let apiEndpoint = endpoint;
    if (isResponsesFormat && !endpoint.includes('/responses')) {
        apiEndpoint = endpoint.replace('/chat/completions', '/responses');
    }

    // 构建消息数组（过滤掉错误消息，它们不应发送给 API）
    let messages = state.messages.filter(m => !m.isError);

    // 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        messages = filterMessagesByCapabilities(messages, capabilities);
        console.log('📋 [OpenAI] 消息已根据模型能力过滤:', {
            capabilities,
            originalCount: state.messages.length,
            filteredCount: messages.length
        });
    }

    // System Prompt 独立于预填充开关（总是生效）
    if (state.systemPrompt) {
        messages.unshift({
            role: 'system',
            content: processVariables(state.systemPrompt)
        });
    }

    // 开场对话插入到 System Prompt 之后、对话历史之前
    if (state.prefillEnabled) {
        const opening = getOpeningMessages();
        if (opening.length > 0) {
            // 找到 system 消息后的位置插入
            const systemIndex = messages.findIndex(m => m.role === 'system');
            const insertIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
            messages.splice(insertIndex, 0, ...opening);
        }
    }

    // 预填充消息追加到末尾（用户最新消息之后）
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages();
        messages.push(...prefill);
    }

    const requestBody = {
        model: model,
        stream: state.streamEnabled,
    };

    // 根据API格式选择消息参数名
    if (isResponsesFormat) {
        // Responses API 使用 input
        requestBody.input = messages;

        // 请求返回加密的推理内容（用于多轮对话保持思维链上下文）
        requestBody.include = ['reasoning.encrypted_content'];

        // 从消息历史中查找并传递 encrypted_content 签名
        // 类似 Gemini 的 thoughtSignature，需要传递给所有消息
        const encryptedContent = findEncryptedContentFromMessages(state.messages);
        if (encryptedContent) {
            // 将签名添加到每个非 system 消息中（Responses API 格式）
            requestBody.input = propagateEncryptedContent(messages, encryptedContent);
            console.log('[OpenAI] 传递 encrypted_content 签名到请求');
        }
    } else {
        // Chat Completions API 使用 messages
        requestBody.messages = messages;
    }

    // 添加自定义模型参数（两种格式共用 openai 参数）
    Object.assign(requestBody, buildModelParams('openai'));

    // 添加思维链配置（已在 params.js 中根据格式自动选择）
    const thinkingConfig = buildThinkingConfig(format, model);
    if (thinkingConfig) Object.assign(requestBody, thinkingConfig);

    // 添加输出详细度配置（所有格式都发送）
    const verbosityConfig = buildVerbosityConfig();
    if (verbosityConfig) Object.assign(requestBody, verbosityConfig);

    // 添加工具调用支持 (Function Calling)
    const tools = [];

    // Code Interpreter 工具
    if (state.codeExecutionEnabled) {
        tools.push({
            type: "code_interpreter"
        });
        console.log('[OpenAI] 📊 Code Interpreter 工具已启用');
    }

    // Web Search 工具
    if (state.webSearchEnabled) {
        tools.push({
            type: "function",
            function: {
                name: "web_search",
                description: "Search the web for current information",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query" }
                    },
                    required: ["query"]
                }
            }
        });
    }

    // 添加工具系统中的工具
    try {
        const { getToolsForAPI } = await import('../tools/manager.js');
        const systemTools = getToolsForAPI(format);
        tools.push(...systemTools);
    } catch (error) {
        console.warn('[OpenAI] 工具系统未加载:', error);
    }

    if (tools.length > 0) {
        if (state.xmlToolCallingEnabled) {
            // XML 模式：只注入 XML 到 system prompt，不使用原生 tools 字段
            const { injectToolsToOpenAI, getXMLInjectionStats } = await import('../tools/tool-injection.js');
            injectToolsToOpenAI(messages, tools);

            // 性能监控 - 记录 token 消耗
            const stats = getXMLInjectionStats(tools);
            console.log('[OpenAI] 📊 XML 模式启用，注入统计:', stats);
            if (stats.estimatedTokens > 2000) {
                console.warn('[OpenAI] ⚠️ XML 描述过长，预计消耗', stats.estimatedTokens, 'tokens');
            }
        } else {
            // 原生模式：使用标准 tools 字段
            requestBody.tools = tools;
            requestBody.tool_choice = "auto";
            if (!isResponsesFormat) {
                // parallel_tool_calls 仅 Chat Completions 支持
                requestBody.parallel_tool_calls = true;
            }
            console.log('[OpenAI] 📊 原生 tools 模式，工具数量:', tools.length);
        }
    }

    console.log(`Sending ${isResponsesFormat ? 'Responses API' : 'Chat Completions'} request:`, JSON.stringify(requestBody, null, 2));

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...getCustomHeadersObject(), // 合并自定义请求头
        },
        body: JSON.stringify(requestBody),
    };
    if (signal) options.signal = signal;
    return await fetch(apiEndpoint, options);
}

/**
 * 构建工具结果消息数组
 * @param {Array} toolCalls - 工具调用列表
 * @param {Array} toolResults - 工具结果列表
 * @returns {Array} 包含工具结果的消息数组
 */
export function buildToolResultMessages(toolCalls, toolResults) {
    // XML 模式：使用 XML 格式而不是原生 tool_calls
    if (state.xmlToolCallingEnabled) {
        // 构建 XML 格式的工具调用文本
        let toolCallXML = '';
        for (const tc of toolCalls) {
            toolCallXML += `<tool_use>\n  <name>${tc.name}</name>\n  <arguments>${JSON.stringify(tc.arguments)}</arguments>\n</tool_use>\n`;
        }

        // 构建 XML 格式的工具结果
        let toolResultXML = '';
        for (let i = 0; i < toolResults.length; i++) {
            const result = toolResults[i];
            const toolCall = toolCalls[i] || toolCalls.find(tc => tc.id === result.tool_call_id);
            const toolName = toolCall?.name || 'unknown';
            toolResultXML += `<tool_use_result>\n  <name>${toolName}</name>\n  <result>${result.content}</result>\n</tool_use_result>\n`;
        }

        return [
            // 1. assistant 消息：包含 XML 工具调用
            {
                role: 'assistant',
                content: toolCallXML.trim()
            },
            // 2. user 消息：包含 XML 工具结果
            {
                role: 'user',
                content: toolResultXML.trim()
            }
        ];
    }

    // 检查是否使用 Responses API 格式
    const provider = getCurrentProvider();
    const isResponsesFormat = provider?.apiFormat === 'openai-responses';

    // Responses API 格式
    if (isResponsesFormat) {
        const messages = [];

        // 1. 追加每个 function_call 对象（模型的工具调用请求）
        for (const tc of toolCalls) {
            messages.push({
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: tc.name,
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
            });
        }

        // 2. 追加每个 function_call_output（工具执行结果）
        for (const result of toolResults) {
            let outputStr;
            try {
                // 尝试解析以检测多模态内容
                const parsed = JSON.parse(result.content);
                // 纯文本结果直接用字符串
                outputStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
            } catch {
                outputStr = result.content;
            }

            messages.push({
                type: 'function_call_output',
                call_id: result.tool_call_id,
                output: outputStr
            });
        }

        return messages;
    }

    // 原生 Chat Completions API 模式：使用 tool_calls 格式（仅文本）
    const messages = [
        // 添加助手消息（包含工具调用）
        {
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments)
                }
            }))
        },
        // 2. 添加工具结果消息（Chat Completions API 仅支持纯文本）
        ...toolResults
    ];

    return messages;
}

/**
 * 从消息历史中查找 encrypted_content 签名
 * 优先使用最新的签名（类似 Gemini 的 thoughtSignature）
 * @param {Array} messages - 消息数组
 * @returns {string|null} encrypted_content 签名
 */
function findEncryptedContentFromMessages(messages) {
    if (!messages || messages.length === 0) return null;

    // 从后向前查找，优先使用最新的签名
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.encryptedContent) {
            return msg.encryptedContent;
        }
    }

    return null;
}

/**
 * 将 encrypted_content 签名传播到所有消息
 * Responses API 格式：在 assistant 消息中添加 reasoning 字段
 * @param {Array} messages - 消息数组
 * @param {string} encryptedContent - 加密的推理内容
 * @returns {Array} 更新后的消息数组
 */
function propagateEncryptedContent(messages, encryptedContent) {
    if (!encryptedContent) return messages;

    return messages.map(msg => {
        // 只在 assistant 消息中添加签名（模型的回复）
        if (msg.role === 'assistant') {
            return {
                ...msg,
                // Responses API 格式：reasoning 包含 encrypted_content
                reasoning: {
                    encrypted_content: encryptedContent
                }
            };
        }
        return msg;
    });
}
