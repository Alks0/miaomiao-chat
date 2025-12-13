/**
 * API 响应解析器
 * 解析不同 API 格式的响应数据
 */

import { state } from '../core/state.js';

/**
 * 解析 API 响应
 * @param {Object} data - API 响应数据
 * @returns {Object|null} 解析后的回复对象
 */
export function parseApiResponse(data) {
    console.log('parseApiResponse data:', data);

    switch (state.apiFormat) {
        case 'gemini': {
            // Gemini 格式
            if (data.error) return null;
            if (!data.candidates || data.candidates.length === 0) return null;

            const candidate = data.candidates[0];
            if (!candidate.content || !candidate.content.parts) return null;

            // 提取 thoughtSignature（如果有）
            let thoughtSignature = null;
            let thinkingContent = '';
            let textContent = '';

            // 从 parts 中提取内容和 thoughtSignature
            for (const part of candidate.content.parts) {
                if (part.thoughtSignature) {
                    thoughtSignature = part.thoughtSignature;
                }
                if (part.thought) {
                    // Gemini 2.5/3 的思维链可能在 part.thought 为 true 时
                    thinkingContent += part.text || '';
                } else if (part.text) {
                    textContent += part.text;
                }
            }

            // 检查顶层的 reasoning 字段（某些 SDK/代理返回格式）
            if (data.reasoning && !thinkingContent) {
                thinkingContent = data.reasoning;
            }

            // 检查 metadata 中的 reasoning 字段（Gemini 3 Pro Image）
            if (data.metadata?.gemini?.reasoning && !thinkingContent) {
                thinkingContent = data.metadata.gemini.reasoning;
            }

            // 检查 usageMetadata 中的思维链 token 统计
            const reasoningTokens = data.usageMetadata?.thoughts_token_count ||
                                   data.usage?.completion_tokens_details?.reasoning_tokens;

            return {
                parts: candidate.content.parts,
                content: textContent,
                thinkingContent: thinkingContent || null,
                thoughtSignature: thoughtSignature,
                groundingMetadata: candidate.groundingMetadata,
                reasoningTokens: reasoningTokens || null,
            };
        }

        case 'claude': {
            // Claude 格式
            if (data.error) return null;
            if (!data.content || data.content.length === 0) return null;

            let textContent = '';
            let thinkingContent = '';

            data.content.forEach(block => {
                if (block.type === 'text') {
                    textContent += block.text;
                } else if (block.type === 'thinking') {
                    thinkingContent += block.thinking;
                }
            });

            return {
                content: textContent,
                claudeContent: data.content,
                thinkingContent: thinkingContent || null,
            };
        }

        case 'openai':
        default: {
            // OpenAI 格式
            if (!data.choices || !data.choices[0]) return null;

            const message = data.choices[0].message;
            console.log('OpenAI message:', message);

            // 处理不同的 content 格式
            let content = message.content;

            // 如果 content 为 null 但有其他字段（如 tool_calls），跳过
            if (content === null || content === undefined) {
                // 检查是否有图片在其他位置
                if (message.image) {
                    content = [{ type: 'image_url', image_url: { url: message.image } }];
                } else {
                    return null;
                }
            }

            return {
                content: content,
                thinkingContent: message.reasoning || null,
            };
        }
    }
}
