/**
 * Gemini 流解析器
 * 解析 Gemini SSE 流式响应
 */

import { recordFirstToken, recordTokens, finalizeStreamStats, getCurrentStreamStatsData, appendStreamStats } from './stats.js';
import { updateStreamingMessage, renderFinalTextWithThinking, renderFinalContentWithThinking, cleanupAllIncompleteImages } from './helpers.js';
import { saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // ✅ Bug 2 修复：导入索引设置函数
import { eventBus } from '../core/events.js';
import { renderHumanizedError } from '../utils/errors.js';
import { parseStreamingMarkdownImages } from '../utils/markdown-image-parser.js';

// ✅ 响应长度限制（防止内存溢出）
const MAX_RESPONSE_LENGTH = 200000; // 20万字符

/**
 * 解析 Gemini 流式响应
 * @param {ReadableStreamDefaultReader} reader - 流读取器
 * @param {string} sessionId - 会话ID
 */
export async function parseGeminiStream(reader, sessionId = null) {
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinkingContent = '';
    let thoughtSignature = null;
    let groundingMetadata = null;
    let contentParts = [];
    let totalReceived = 0; // ✅ 追踪总接收字符数
    let markdownBuffer = ''; // ✅ Markdown 图片缓冲区

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                // 跳过 SSE 注释行
                if (line.startsWith(':')) continue;

                try {
                    // 处理 SSE 格式 (data: {...}) 或纯 JSON
                    let jsonStr = line;
                    if (line.startsWith('data: ')) {
                        jsonStr = line.slice(6).trim();
                        if (jsonStr === '[DONE]') continue;
                    }

                    const parsed = JSON.parse(jsonStr);

                    // ✅ 检测流式响应中的错误（如 429 Too Many Requests）
                    if (parsed.error) {
                        const errorCode = parsed.error.code;
                        const errorMessage = parsed.error.message || 'Unknown error';
                        const errorStatus = parsed.error.status || '';

                        console.error(`❌ Gemini API 错误 (流式响应):`, parsed.error);

                        // 显示错误通知
                        let userMessage = '';
                        if (errorCode === 429) {
                            userMessage = `请求过多 (429)：${errorMessage}\n请稍后再试或检查配额限制`;
                        } else if (errorCode === 503) {
                            userMessage = `服务暂时不可用 (503)：${errorMessage}\n请稍后重试`;
                        } else if (errorCode === 500) {
                            userMessage = `服务器内部错误 (500)：${errorMessage}`;
                        } else {
                            userMessage = `API 错误 (${errorCode}): ${errorMessage}`;
                        }

                        eventBus.emit('ui:notification', {
                            message: userMessage,
                            type: 'error',
                            duration: 8000
                        });

                        // 取消流并清理
                        await reader.cancel();

                        // 如果已有部分内容，保存为错误消息
                        if (textContent || thinkingContent) {
                            finalizeGeminiStreamWithError(
                                textContent,
                                thinkingContent,
                                thoughtSignature,
                                groundingMetadata,
                                contentParts,
                                errorCode,
                                errorMessage,
                                errorStatus,
                                sessionId
                            );
                        }

                        return; // 退出流处理
                    }

                    const parts = parsed.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        // 提取 thoughtSignature
                        if (part.thoughtSignature) {
                            thoughtSignature = part.thoughtSignature;
                        }

                        if (part.thought) {
                            recordFirstToken();
                            recordTokens(part.text);
                            const thoughtText = part.text || '';
                            thinkingContent += thoughtText;  // 用于实时显示
                            totalReceived += thoughtText.length;

                            // ✅ 合并连续的 thinking parts（只有遇到图片才分段）
                            const lastPart = contentParts[contentParts.length - 1];
                            if (lastPart && lastPart.type === 'thinking') {
                                lastPart.text += thoughtText;
                            } else {
                                contentParts.push({ type: 'thinking', text: thoughtText });
                            }
                        } else if (part.text) {
                            recordFirstToken();
                            recordTokens(part.text);

                            // ✅ 解析 markdown 图片格式
                            const { parts: parsedParts, newBuffer } = parseStreamingMarkdownImages(part.text, markdownBuffer);
                            markdownBuffer = newBuffer;

                            for (const parsedPart of parsedParts) {
                                if (parsedPart.type === 'text') {
                                    textContent += parsedPart.text;  // 用于实时显示
                                    totalReceived += parsedPart.text.length;

                                    // 合并连续的文本部分
                                    const lastPart = contentParts[contentParts.length - 1];
                                    if (lastPart && lastPart.type === 'text') {
                                        lastPart.text += parsedPart.text;
                                    } else {
                                        contentParts.push({ type: 'text', text: parsedPart.text });
                                    }
                                } else if (parsedPart.type === 'image_url') {
                                    // 添加从 markdown 解析出的图片
                                    contentParts.push(parsedPart);
                                    totalReceived += parsedPart.url.length;
                                }
                            }
                        } else if (part.inlineData) {
                            // ✅ 图片独立成块，自动分段
                            const inlineData = part.inlineData;
                            const dataUrl = `data:${inlineData.mimeType};base64,${inlineData.data}`;
                            contentParts.push({ type: 'image_url', url: dataUrl, complete: true });
                            // ✅ 修复：计数 base64 数据长度（防止超长）
                            totalReceived += inlineData.data.length;
                        }
                    }

                    // ✅ 检查是否超过长度限制
                    if (totalReceived > MAX_RESPONSE_LENGTH) {
                        console.warn(`响应超长（${totalReceived} 字符），已强制截断`);
                        eventBus.emit('ui:notification', {
                            message: `响应过长（${totalReceived.toLocaleString()} 字符），已自动截断`,
                            type: 'warning'
                        });
                        await reader.cancel();
                        finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, groundingMetadata, contentParts, sessionId);
                        return;
                    }

                    // 检查顶层的 reasoning 字段（某些 SDK/代理返回格式）
                    if (parsed.reasoning) {
                        recordFirstToken();
                        const newReasoning = parsed.reasoning.slice(thinkingContent.length);
                        if (newReasoning) {
                            recordTokens(newReasoning);
                            thinkingContent += newReasoning;
                        }
                    }

                    // 检查 metadata 中的 reasoning 字段（Gemini 3 Pro Image）
                    if (parsed.metadata?.gemini?.reasoning) {
                        recordFirstToken();
                        const newReasoning = parsed.metadata.gemini.reasoning.slice(thinkingContent.length);
                        if (newReasoning) {
                            recordTokens(newReasoning);
                            thinkingContent += newReasoning;
                        }
                    }

                    // 搜索引用
                    if (parsed.candidates?.[0]?.groundingMetadata) {
                        groundingMetadata = parsed.candidates[0].groundingMetadata;
                    }

                    updateStreamingMessage(textContent, thinkingContent);

                } catch (e) {
                    console.warn('Gemini stream parse error:', e);
                }
            }
        }

        // 流结束，保存消息和签名
        finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, groundingMetadata, contentParts, sessionId);
    } finally {
        // ✅ 关键修复：释放 reader 锁，防止资源泄漏
        try {
            reader.releaseLock();
        } catch (e) {
            // Reader 可能已被释放或取消，忽略错误
            console.debug('Reader lock already released:', e);
        }
    }
}

/**
 * 完成 Gemini 流处理
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 * @param {string} thoughtSignature - 思维签名
 * @param {Object} groundingMetadata - 搜索结果元数据
 * @param {Array} contentParts - 内容部分数组
 * @param {string} sessionId - 会话ID
 */
function finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, groundingMetadata, contentParts, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // 渲染最终内容
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent, groundingMetadata);
    } else {
        renderFinalTextWithThinking(textContent, thinkingContent, groundingMetadata);
    }

    // 添加统计信息
    appendStreamStats();

    // 使用统一函数保存消息到所有三种格式并获取索引
    const messageIndex = saveAssistantMessage({
        textContent,
        thinkingContent,
        thoughtSignature,
        contentParts,
        streamStats: getCurrentStreamStatsData(),
        sessionId: sessionId, // 🔒 传递会话ID防止串消息
    });

    // ✅ Bug 2 修复：立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);
}

/**
 * ✅ 以错误状态完成 Gemini 流处理
 * 用于处理流式响应中的 API 错误（如 429）
 * @param {string} textContent - 已接收的文本内容
 * @param {string} thinkingContent - 已接收的思维链内容
 * @param {string} thoughtSignature - 思维签名
 * @param {Object} groundingMetadata - 搜索结果元数据
 * @param {Array} contentParts - 内容部分数组
 * @param {number} errorCode - 错误码
 * @param {string} errorMessage - 错误消息
 * @param {string} errorStatus - 错误状态
 * @param {string} sessionId - 会话ID
 */
function finalizeGeminiStreamWithError(textContent, thinkingContent, thoughtSignature, groundingMetadata, contentParts, errorCode, errorMessage, errorStatus, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // ✅ 使用统一的错误渲染函数（包含折叠的技术详情）
    const errorObject = {
        code: errorCode,
        message: errorMessage,
        status: errorStatus
    };

    const errorHtml = renderHumanizedError(errorObject, errorCode, true) +
        `<div style="margin-top: 8px; padding: 8px; background: rgba(255, 140, 0, 0.1); border-left: 3px solid var(--md-coral); font-size: 12px;">
            💾 已保存部分接收的内容
        </div>`;

    const finalText = textContent + '\n\n' + errorMessage;

    // 渲染内容（包含部分内容和错误）
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent, groundingMetadata);
    } else {
        renderFinalTextWithThinking(textContent, thinkingContent, groundingMetadata);
    }

    // 在消息末尾插入错误提示
    const currentMsg = document.querySelector('.message.assistant:last-child');
    if (currentMsg) {
        const contentDiv = currentMsg.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.insertAdjacentHTML('beforeend', errorHtml);
        }
    }

    // 添加统计信息
    appendStreamStats();

    // 保存消息（标记为错误）并获取索引
    const messageIndex = saveAssistantMessage({
        textContent: finalText,
        thinkingContent,
        thoughtSignature,
        contentParts,
        streamStats: getCurrentStreamStatsData(),
        isError: true,
        errorData: {
            code: errorCode,
            message: errorMessage
        },
        errorHtml,
        sessionId: sessionId, // 🔒 传递会话ID防止串消息
    });

    // ✅ Bug 2 修复：立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);

    // 触发 UI 状态重置
    eventBus.emit('stream:error', {
        errorCode,
        errorMessage,
        partialContent: textContent
    });
}
