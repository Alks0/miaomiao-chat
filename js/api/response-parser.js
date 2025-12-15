/**
 * API 响应解析器
 * 解析不同 API 格式的非流式响应
 */

import { parseMarkdownImages } from '../utils/markdown-image-parser.js';
import { extractXMLToolCalls } from '../tools/xml-formatter.js';  // ✅ XML 工具调用解析
import { state } from '../core/state.js';  // ✅ 访问 xmlToolCallingEnabled 配置
import { parseThinkTags } from '../stream/think-tag-parser.js';  // ✅ <think> 标签解析器

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

            // ⭐ 1. 优先检测原生工具调用
            const toolCalls = [];
            for (const part of candidate.content.parts) {
                if (part.functionCall) {
                    toolCalls.push({
                        id: part.functionCall.id || null,
                        name: part.functionCall.name,
                        arguments: part.functionCall.args
                    });
                }
            }

            // 如果有原生工具调用，返回工具调用结果
            if (toolCalls.length > 0) {
                return {
                    toolCalls: toolCalls,
                    content: '',
                    hasToolCalls: true
                };
            }

            // ⭐ 2. 兜底：检测 XML <tool_use>
            if (state.xmlToolCallingEnabled) {
                // 提取所有文本部分
                let allText = '';
                for (const part of candidate.content.parts) {
                    if (part.text) {
                        allText += part.text;
                    }
                }

                if (allText) {
                    const xmlToolCalls = extractXMLToolCalls(allText);
                    if (xmlToolCalls.length > 0) {
                        console.log('[Response Parser] 🔧 检测到 Gemini XML 工具调用:', xmlToolCalls.length);
                        return {
                            toolCalls: xmlToolCalls,
                            content: allText,
                            hasToolCalls: true
                        };
                    }
                }
            }

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
                    // ✅ 解析 <think> 标签
                    const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(part.text);
                    if (thinkContent) {
                        thinkingContent += thinkContent;
                    }
                    textContent += thinkParsedText;
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

            // ✅ 先添加思维链（如果有）
            if (thinkingContent) {
                contentParts.push({ type: 'thinking', text: thinkingContent });
            }

            for (const part of candidate.content.parts) {
                if (part.text && !part.thought) {
                    // ✅ 解析 <think> 标签后的文本
                    const { displayText: thinkParsedText } = parseThinkTags(part.text);
                    if (thinkParsedText) {
                        contentParts.push({ type: 'text', text: thinkParsedText });
                    }
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

            // ⭐ 1. 优先检测原生工具调用
            const toolCalls = [];
            for (const block of data.content) {
                if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        name: block.name,
                        arguments: block.input
                    });
                }
            }

            // 如果有原生工具调用且 stop_reason 是 tool_use，返回工具调用结果
            if (toolCalls.length > 0 && data.stop_reason === 'tool_use') {
                // 提取文本内容（Claude 可能同时返回文本和工具调用）
                let textContent = '';
                for (const block of data.content) {
                    if (block.type === 'text') {
                        textContent += block.text;
                    }
                }

                return {
                    toolCalls: toolCalls,
                    content: textContent || '',
                    hasToolCalls: true
                };
            }

            // ⭐ 2. 兜底：检测 XML <tool_use>
            if (state.xmlToolCallingEnabled && toolCalls.length === 0) {
                // 提取所有文本块
                let allText = '';
                for (const block of data.content) {
                    if (block.type === 'text') {
                        allText += block.text;
                    }
                }

                if (allText) {
                    const xmlToolCalls = extractXMLToolCalls(allText);
                    if (xmlToolCalls.length > 0) {
                        console.log('[Response Parser] 🔧 检测到 Claude XML 工具调用:', xmlToolCalls.length);
                        return {
                            toolCalls: xmlToolCalls,
                            content: allText,
                            hasToolCalls: true
                        };
                    }
                }
            }

            let textContent = '';
            let thinkingContent = '';
            const contentParts = [];

            data.content.forEach(block => {
                if (block.type === 'text') {
                    // ✅ 解析 <think> 标签
                    const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(block.text);
                    if (thinkContent) {
                        thinkingContent += thinkContent;
                        contentParts.push({ type: 'thinking', text: thinkContent });
                    }
                    textContent += thinkParsedText;
                    if (thinkParsedText) {
                        contentParts.push({ type: 'text', text: thinkParsedText });
                    }
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
            const finishReason = data.choices[0].finish_reason;
            console.log('OpenAI message:', message);

            // ✅ 1. 检测原生 tool_calls（仅在非 XML 模式）
            if (message.tool_calls && finishReason === 'tool_calls' && !state.xmlToolCallingEnabled) {
                const toolCalls = message.tool_calls.map(tc => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments
                }));

                console.log('[Response Parser] 🔧 检测到 OpenAI 原生工具调用:', toolCalls.length);
                return {
                    toolCalls: toolCalls,
                    content: message.content || '',
                    hasToolCalls: true
                };
            }

            // ✅ 2. 兜底：检测 XML <tool_use>
            if (state.xmlToolCallingEnabled && message.content && typeof message.content === 'string') {
                const xmlToolCalls = extractXMLToolCalls(message.content);

                if (xmlToolCalls.length > 0) {
                    console.log('[Response Parser] 🔧 检测到 XML 工具调用:', xmlToolCalls.length);
                    return {
                        toolCalls: xmlToolCalls,
                        content: message.content,
                        hasToolCalls: true
                    };
                }
            }

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

            // ✅ 用于累积提取的 <think> 内容
            let extractedThinkingContent = '';

            // ✅ 解析 content 数组（包含文本和图片）
            if (Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'text') {
                        // ✅ 先解析 <think> 标签
                        const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(part.text);
                        if (thinkContent) {
                            extractedThinkingContent += thinkContent;
                            contentParts.push({ type: 'thinking', text: thinkContent });
                        }

                        // ✅ 解析文本中的 markdown 图片格式
                        const parsedParts = parseMarkdownImages(thinkParsedText);
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
                // ✅ 先解析 <think> 标签
                const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(content);
                if (thinkContent) {
                    extractedThinkingContent += thinkContent;
                    contentParts.push({ type: 'thinking', text: thinkContent });
                }

                // ✅ 解析字符串中的 markdown 图片格式
                const parsedParts = parseMarkdownImages(thinkParsedText);
                for (const part of parsedParts) {
                    if (part.type === 'text') {
                        textContent += part.text;
                        contentParts.push(part);
                    } else if (part.type === 'image_url') {
                        contentParts.push(part);
                    }
                }
            }

            // ✅ 处理原生思维链（优先级高于 <think> 标签）
            const finalThinkingContent = message.reasoning || extractedThinkingContent || null;
            if (message.reasoning) {
                contentParts.unshift({ type: 'thinking', text: message.reasoning });
            }

            return {
                content: Array.isArray(content) ? textContent : (extractedThinkingContent ? textContent : content),
                thinkingContent: finalThinkingContent,
                contentParts: contentParts.length > 0 ? contentParts : null, // ✅ 新增字段
            };
        }
    }
}
