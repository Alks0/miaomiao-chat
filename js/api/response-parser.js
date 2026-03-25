/**
 * API 响应解析器
 * 解析不同 API 格式的非流式响应
 */

import { parseMarkdownImages } from '../utils/markdown-image-parser.js';
import { extractXMLToolCalls } from '../tools/xml-formatter.js';
import { state } from '../core/state.js';
import { parseThinkTags } from '../stream/think-tag-parser.js';
import { isVideoMimeType, isVideoUrl } from '../utils/media.js';

/**
 * 解析 API 响应数据
 * @param {Object} data - API 响应数据
 * @param {string} format - API 格式 ('openai' | 'claude' | 'gemini' | 'openai-responses')
 * @returns {Object|null} 解析后的回复对象
 */
export function parseApiResponse(data, format = 'openai') {
    console.log('parseApiResponse data:', data, 'format:', format);

    switch (format) {
        case 'openclaw':
            // OpenClaw 返回 OpenAI 兼容格式，复用 OpenAI 解析
            return parseApiResponse(data, 'openai');

        case 'gemini': {
            // Gemini 格式
            if (data.error) return null;
            if (!data.candidates || data.candidates.length === 0) return null;

            const candidate = data.candidates[0];
            if (!candidate.content || !candidate.content.parts) return null;

            // ⭐ 1. 优先检测原生工具调用
            const toolCalls = [];
            for (let i = 0; i < candidate.content.parts.length; i++) {
                const part = candidate.content.parts[i];
                if (part.functionCall) {
                    toolCalls.push({
                        id: part.functionCall.id || `gemini_tc_${Date.now()}_${i}`,
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
                    // 解析 <think> 标签
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

            const contentParts = [];

            // 先添加思维链（如果有）
            if (thinkingContent) {
                contentParts.push({ type: 'thinking', text: thinkingContent });
            }

            for (const part of candidate.content.parts) {
                if (part.text && !part.thought) {
                    const { displayText: thinkParsedText } = parseThinkTags(part.text);
                    if (thinkParsedText) {
                        contentParts.push({ type: 'text', text: thinkParsedText });
                    }
                } else if (part.inlineData || part.inline_data) {
                    const inlineData = part.inlineData || part.inline_data;
                    const mimeType = inlineData.mimeType || inlineData.mime_type;
                    const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
                    const mediaType = isVideoMimeType(mimeType) ? 'video_url' : 'image_url';
                    contentParts.push({ type: mediaType, url: dataUrl, complete: true, mimeType });
                }
            }

            return {
                parts: candidate.content.parts,
                content: textContent,
                thinkingContent: thinkingContent || null,
                thoughtSignature: thoughtSignature,
                groundingMetadata: candidate.groundingMetadata,
                reasoningTokens: reasoningTokens || null,
                contentParts: contentParts.length > 0 ? contentParts : null,
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
                    const source = block.source;
                    if (source.type === 'base64') {
                        const dataUrl = `data:${source.media_type};base64,${source.data}`;
                        contentParts.push({ type: 'image_url', url: dataUrl, complete: true });
                    } else if (source.type === 'url') {
                        contentParts.push({ type: 'image_url', url: source.url, complete: true });
                    }
                } else if (block.type === 'video') {
                    const source = block.source || {};
                    if (source.type === 'base64' && source.data) {
                        const mimeType = source.media_type || source.mimeType || 'video/mp4';
                        const dataUrl = `data:${mimeType};base64,${source.data}`;
                        contentParts.push({ type: 'video_url', url: dataUrl, complete: true, mimeType });
                    } else if (source.type === 'url' && source.url) {
                        const mimeType = source.media_type || source.mimeType || '';
                        contentParts.push({ type: 'video_url', url: source.url, complete: true, mimeType });
                    }
                }
            });

            return {
                content: textContent,
                claudeContent: data.content,
                thinkingContent: thinkingContent || null,
                contentParts: contentParts.length > 0 ? contentParts : null,
            };
        }

        case 'openai-responses': {
            // OpenAI Responses API 格式
            // 响应结构: { output: [...], output_text: "..." }
            if (data.error) return null;

            // ⭐ 1. 优先检测工具调用（function_call 类型）
            if (data.output && Array.isArray(data.output)) {
                const toolCalls = [];
                for (const item of data.output) {
                    if (item.type === 'function_call') {
                        let parsedArgs;
                        if (typeof item.arguments === 'string') {
                            try {
                                parsedArgs = JSON.parse(item.arguments);
                            } catch (_e) {
                                console.warn('[response-parser] Responses API 工具参数解析失败:', _e);
                                parsedArgs = {};
                            }
                        } else {
                            parsedArgs = item.arguments || {};
                        }
                        toolCalls.push({
                            id: item.call_id || item.id || `resp_tc_${Date.now()}_${toolCalls.length}`,
                            name: item.name,
                            arguments: parsedArgs
                        });
                    }
                }

                if (toolCalls.length > 0) {
                    // 提取伴随的文本内容
                    let textContent = '';
                    for (const item of data.output) {
                        if (item.type === 'message') {
                            textContent += item.text || '';
                            if (Array.isArray(item.content)) {
                                for (const part of item.content) {
                                    if ((part.type === 'output_text' || part.type === 'text') && part.text) {
                                        textContent += part.text;
                                    }
                                }
                            }
                        }
                    }

                    console.log('[Response Parser] 检测到 Responses API 工具调用:', toolCalls.length);
                    return {
                        toolCalls: toolCalls,
                        content: textContent || '',
                        hasToolCalls: true
                    };
                }
            }

            // ⭐ 2. 检测 XML 工具调用
            if (state.xmlToolCallingEnabled && data.output_text) {
                const xmlToolCalls = extractXMLToolCalls(data.output_text);
                if (xmlToolCalls.length > 0) {
                    console.log('[Response Parser] 检测到 Responses API XML 工具调用:', xmlToolCalls.length);
                    return {
                        toolCalls: xmlToolCalls,
                        content: data.output_text,
                        hasToolCalls: true
                    };
                }
            }

            let textContent = '';
            let thinkingContent = '';
            let encryptedContent = null;
            const contentParts = [];

            // 1. 优先从 output[] 数组解析
            if (data.output && Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item.type === 'reasoning') {
                        // 推理/思维链内容
                        if (item.content) {
                            thinkingContent += item.content;
                            contentParts.push({ type: 'thinking', text: item.content });
                        }
                        // 提取 encrypted_content 签名（用于多轮对话）
                        if (item.encrypted_content) {
                            encryptedContent = item.encrypted_content;
                            console.log('[Response Parser] 提取到 encrypted_content 签名');
                        }
                    }
                    else if (item.type === 'message') {
                        // 消息内容
                        const messageText = item.text || '';
                        if (messageText) {
                            textContent += messageText;
                            contentParts.push({ type: 'text', text: messageText });
                        }
                        // 处理 content 数组
                        else if (Array.isArray(item.content)) {
                            for (const part of item.content) {
                                if (part.type === 'output_text' && part.text) {
                                    textContent += part.text;
                                    contentParts.push({ type: 'text', text: part.text });
                                } else if (part.type === 'text' && part.text) {
                                    textContent += part.text;
                                    contentParts.push({ type: 'text', text: part.text });
                                } else if (part.type === 'image_url' && part.image_url?.url) {
                                    const mediaUrl = part.image_url.url;
                                    const mediaType = isVideoUrl(mediaUrl, part.image_url?.mime_type || part.image_url?.mimeType) ? 'video_url' : 'image_url';
                                    contentParts.push({ type: mediaType, url: mediaUrl, complete: true, mimeType: part.image_url?.mime_type || part.image_url?.mimeType || '' });
                                } else if (part.type === 'video_url') {
                                    const mediaUrl = part.video_url?.url || part.url;
                                    if (mediaUrl) {
                                        contentParts.push({
                                            type: 'video_url',
                                            url: mediaUrl,
                                            complete: true,
                                            mimeType: part.mime_type || part.mimeType || part.video_url?.mime_type || part.video_url?.mimeType || ''
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 2. 兜底：使用 output_text 快捷字段
            if (!textContent && data.output_text) {
                textContent = data.output_text;
                contentParts.push({ type: 'text', text: textContent });
            }

            // 3. 如果没有任何内容，返回 null
            if (!textContent && !thinkingContent && contentParts.length === 0) {
                return null;
            }

            return {
                content: textContent,
                thinkingContent: thinkingContent || null,
                contentParts: contentParts.length > 0 ? contentParts : null,
                encryptedContent: encryptedContent,
            };
        }

        case 'openai':
        default: {
            // OpenAI 格式
            if (!data.choices || !data.choices[0]) return null;

            const message = data.choices[0].message;
            const finishReason = data.choices[0].finish_reason;
            console.log('OpenAI message:', message);

            // 检测原生 tool_calls（仅在非 XML 模式）
            if (message.tool_calls && finishReason === 'tool_calls' && !state.xmlToolCallingEnabled) {
                const toolCalls = message.tool_calls.map(tc => {
                    let parsedArgs;
                    if (typeof tc.function.arguments === 'string') {
                        try {
                            parsedArgs = JSON.parse(tc.function.arguments);
                        } catch (e) {
                            console.warn('[response-parser] 工具调用参数解析失败:', e);
                            parsedArgs = {};
                        }
                    } else {
                        parsedArgs = tc.function.arguments;
                    }
                    return {
                        id: tc.id,
                        name: tc.function.name,
                        arguments: parsedArgs
                    };
                });

                console.log('[Response Parser] 🔧 检测到 OpenAI 原生工具调用:', toolCalls.length);
                return {
                    toolCalls: toolCalls,
                    content: message.content || '',
                    hasToolCalls: true
                };
            }

            // 兜底：检测 XML <tool_use>
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

            // 用于累积提取的 <think> 内容
            let extractedThinkingContent = '';

            // 解析 content 数组（包含文本和图片）
            if (Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'text') {
                        // 先解析 <think> 标签
                        const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(part.text);
                        if (thinkContent) {
                            extractedThinkingContent += thinkContent;
                            contentParts.push({ type: 'thinking', text: thinkContent });
                        }

                        // 解析文本中的 markdown 图片格式
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
                        const mediaUrl = part.image_url.url;
                        const mediaType = isVideoUrl(mediaUrl, part.image_url?.mime_type || part.image_url?.mimeType) ? 'video_url' : 'image_url';
                        contentParts.push({
                            type: mediaType,
                            url: mediaUrl,
                            complete: true,
                            mimeType: part.image_url?.mime_type || part.image_url?.mimeType || ''
                        });
                    } else if (part.type === 'video_url') {
                        const mediaUrl = part.video_url?.url || part.url;
                        if (mediaUrl) {
                            contentParts.push({
                                type: 'video_url',
                                url: mediaUrl,
                                complete: true,
                                mimeType: part.mime_type || part.mimeType || part.video_url?.mime_type || part.video_url?.mimeType || ''
                            });
                        }
                    }
                }
            } else if (typeof content === 'string') {
                // 先解析 <think> 标签
                const { displayText: thinkParsedText, thinkingContent: thinkContent } = parseThinkTags(content);
                if (thinkContent) {
                    extractedThinkingContent += thinkContent;
                    contentParts.push({ type: 'thinking', text: thinkContent });
                }

                // 解析字符串中的 markdown 图片格式
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

            // 处理原生思维链（优先级高于 <think> 标签）
            const finalThinkingContent = message.reasoning || extractedThinkingContent || null;
            if (message.reasoning) {
                contentParts.unshift({ type: 'thinking', text: message.reasoning });
            }

            return {
                content: Array.isArray(content) ? textContent : (extractedThinkingContent ? textContent : content),
                thinkingContent: finalThinkingContent,
                contentParts: contentParts.length > 0 ? contentParts : null,
            };
        }
    }
}
