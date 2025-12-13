/**
 * API 响应解析器
 * 解析不同 API 格式的非流式响应
 */

import { parseMarkdownImages } from '../utils/markdown-image-parser.js';

/**
 * 解析 API 响应数据
 * @param {Object} data - API 响应数据
 * @param {string} format - API 格式 ('openai' | 'claude' | 'gemini' | 'openai-responses')
 * @returns {Object|null} 解析后的回复对象
 */
export function parseApiResponse(data, format = 'openai') {
    console.log('parseApiResponse data:', data, 'format:', format);

    switch (format) {
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

            // ✅ 修复: 添加 contentParts 字段用于渲染图片
            const contentParts = [];
            for (const part of candidate.content.parts) {
                if (part.text && !part.thought) {
                    contentParts.push({ type: 'text', text: part.text });
                } else if (part.inlineData || part.inline_data) {
                    const inlineData = part.inlineData || part.inline_data;
                    const mimeType = inlineData.mimeType || inlineData.mime_type;
                    const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
                    contentParts.push({ type: 'image_url', url: dataUrl, complete: true });
                }
            }

            return {
                parts: candidate.content.parts,
                content: textContent,
                thinkingContent: thinkingContent || null,
                thoughtSignature: thoughtSignature,
                groundingMetadata: candidate.groundingMetadata,
                reasoningTokens: reasoningTokens || null,
                contentParts: contentParts.length > 0 ? contentParts : null, // ✅ 新增字段
            };
        }

        case 'claude': {
            // Claude 格式
            if (data.error) return null;
            if (!data.content || data.content.length === 0) return null;

            let textContent = '';
            let thinkingContent = '';
            const contentParts = [];

            data.content.forEach(block => {
                if (block.type === 'text') {
                    textContent += block.text;
                    contentParts.push({ type: 'text', text: block.text });
                } else if (block.type === 'thinking') {
                    thinkingContent += block.thinking;
                    contentParts.push({ type: 'thinking', text: block.thinking });
                } else if (block.type === 'image') {
                    // ✅ Claude 格式的图片
                    const source = block.source;
                    if (source.type === 'base64') {
                        const dataUrl = `data:${source.media_type};base64,${source.data}`;
                        contentParts.push({ type: 'image_url', url: dataUrl, complete: true });
                    } else if (source.type === 'url') {
                        contentParts.push({ type: 'image_url', url: source.url, complete: true });
                    }
                }
            });

            return {
                content: textContent,
                claudeContent: data.content,
                thinkingContent: thinkingContent || null,
                contentParts: contentParts.length > 0 ? contentParts : null, // ✅ 新增字段
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
            const contentParts = [];
            let textContent = '';

            // 如果 content 为 null 但有其他字段（如 tool_calls），跳过
            if (content === null || content === undefined) {
                // 检查是否有图片在其他位置
                if (message.image) {
                    content = [{ type: 'image_url', image_url: { url: message.image } }];
                } else {
                    return null;
                }
            }

            // ✅ 解析 content 数组（包含文本和图片）
            if (Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'text') {
                        // ✅ 解析文本中的 markdown 图片格式
                        const parsedParts = parseMarkdownImages(part.text);
                        for (const parsed of parsedParts) {
                            if (parsed.type === 'text') {
                                textContent += parsed.text;
                                contentParts.push(parsed);
                            } else if (parsed.type === 'image_url') {
                                contentParts.push(parsed);
                            }
                        }
                    } else if (part.type === 'image_url' && part.image_url?.url) {
                        contentParts.push({ type: 'image_url', url: part.image_url.url, complete: true });
                    }
                }
            } else if (typeof content === 'string') {
                // ✅ 解析字符串中的 markdown 图片格式
                const parsedParts = parseMarkdownImages(content);
                for (const part of parsedParts) {
                    if (part.type === 'text') {
                        textContent += part.text;
                        contentParts.push(part);
                    } else if (part.type === 'image_url') {
                        contentParts.push(part);
                    }
                }
            }

            // ✅ 处理思维链
            if (message.reasoning) {
                contentParts.unshift({ type: 'thinking', text: message.reasoning });
            }

            return {
                content: Array.isArray(content) ? textContent : content,
                thinkingContent: message.reasoning || null,
                contentParts: contentParts.length > 0 ? contentParts : null, // ✅ 新增字段
            };
        }
    }
}
