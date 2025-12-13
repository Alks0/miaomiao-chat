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

    // 预填充消息在前
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages();
        claudeMessages = [...prefill, ...claudeMessages];
    }

    // 构建请求体
    const requestBody = {
        model: model,
        messages: claudeMessages,
        stream: state.streamEnabled,
        ...buildModelParams('claude'), // 包含 max_tokens（默认 8192）及其他参数
    };

    // Claude 的 system 是顶层参数
    if (state.prefillEnabled && state.systemPrompt) {
        requestBody.system = processVariables(state.systemPrompt);
    }

    // 添加思维链配置 (Claude Extended Thinking)
    const claudeThinkingConfig = buildThinkingConfig('claude');
    if (claudeThinkingConfig) Object.assign(requestBody, claudeThinkingConfig);

    // 添加网络搜索工具
    if (state.webSearchEnabled) {
        requestBody.tools = [{
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5
        }];
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
