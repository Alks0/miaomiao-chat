/**
 * OpenAI API 请求处理器
 * 支持 OpenAI 兼容的 API 端点
 */

import { state } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, buildVerbosityConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages } from '../utils/prefill.js';
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
    // ✅ 使用提供商的原始格式（OpenAI 或 OpenAI-Responses）
    const provider = getCurrentProvider();
    const format = provider?.apiFormat || 'openai';
    const isResponsesFormat = format === 'openai-responses';
    const apiEndpoint = isResponsesFormat && !endpoint.includes('/responses')
        ? endpoint.replace('/chat/completions', '/responses')
        : endpoint;

    // 构建消息数组（过滤掉错误消息，它们不应发送给 API）
    let messages = state.messages.filter(m => !m.isError);

    // ✅ 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        messages = filterMessagesByCapabilities(messages, capabilities);
        console.log('📋 [OpenAI] 消息已根据模型能力过滤:', {
            capabilities,
            originalCount: state.messages.length,
            filteredCount: messages.length
        });
    }

    // 预填充消息在前
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages();
        messages = [...prefill, ...messages];

        // System Prompt 最前面
        if (state.systemPrompt) {
            messages.unshift({
                role: 'system',
                content: processVariables(state.systemPrompt)
            });
        }
    }

    const requestBody = {
        model: model,
        stream: state.streamEnabled,
    };

    // 根据API格式选择消息参数名
    if (isResponsesFormat) {
        // Responses API 使用 input
        requestBody.input = messages;
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

    // 添加网络搜索工具 (Function Calling)
    if (state.webSearchEnabled) {
        requestBody.tools = [{
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
        }];
        requestBody.tool_choice = "auto";
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
