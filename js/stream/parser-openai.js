/**
 * OpenAI 流解析器
 * 解析 OpenAI SSE 流式响应
 */

import { recordFirstToken, recordTokens, finalizeStreamStats, getCurrentStreamStatsData, appendStreamStats } from './stats.js';
import { updateStreamingMessage, renderFinalTextWithThinking, renderFinalContentWithThinking, cleanupAllIncompleteImages, handleContentArray } from './helpers.js';
import { saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // ✅ Bug 2 修复：导入索引设置函数
import { eventBus } from '../core/events.js';
import { renderHumanizedError } from '../utils/errors.js';
import { parseStreamingMarkdownImages, mergeTextParts } from '../utils/markdown-image-parser.js';

// ✅ 响应长度限制（防止内存溢出）
const MAX_RESPONSE_LENGTH = 200000; // 20万字符

/**
 * 解析 OpenAI 流式响应
 * @param {ReadableStreamDefaultReader} reader - 流读取器
 * @param {string} format - API 格式 ('openai'|'openai-responses')
 */
export async function parseOpenAIStream(reader, format = 'openai', sessionId = null) {
    // 检测是否是 Responses API 格式
    const isResponsesFormat = format === 'openai-responses';
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinkingContent = '';
    let contentParts = [];
    let totalReceived = 0; // ✅ 追踪总接收字符数
    let markdownBuffer = ''; // ✅ Markdown 图片缓冲区（用于暂存不完整的图片）

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId);
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        // ✅ 检测流式响应中的错误（如 429 Too Many Requests）
                        if (parsed.error) {
                            const errorCode = parsed.error.code || parsed.error.type;
                            const errorMessage = parsed.error.message || 'Unknown error';

                            console.error(`❌ OpenAI API 错误 (流式响应):`, parsed.error);

                            // 显示错误通知
                            let userMessage = '';
                            if (errorCode === 429 || errorCode === 'rate_limit_exceeded') {
                                userMessage = `请求过多 (429)：${errorMessage}\n请稍后再试`;
                            } else if (errorCode === 503) {
                                userMessage = `服务暂时不可用 (503)：${errorMessage}`;
                            } else if (errorCode === 500 || errorCode === 'server_error') {
                                userMessage = `服务器内部错误：${errorMessage}`;
                            } else {
                                userMessage = `API 错误: ${errorMessage}`;
                            }

                            eventBus.emit('ui:notification', {
                                message: userMessage,
                                type: 'error',
                                duration: 8000
                            });

                            // 取消流并清理
                            await reader.cancel();

                            // 如果已有部分内容，保存为错误消息
                            if (textContent || thinkingContent || contentParts.length > 0) {
                                finalizeOpenAIStreamWithError(textContent, thinkingContent, contentParts, errorCode, errorMessage, sessionId);
                            }

                            return; // 退出流处理
                        }

                        // Responses API 格式：解析 output[] 数组
                        if (isResponsesFormat && parsed.output && Array.isArray(parsed.output)) {
                            for (const item of parsed.output) {
                                if (item.type === 'reasoning' && item.content) {
                                    // 推理内容
                                    recordFirstToken();
                                    recordTokens(item.content);
                                    thinkingContent += item.content;
                                    totalReceived += item.content.length;

                                    // ✅ 合并连续的 thinking parts（只有遇到图片才分段）
                                    const lastPart = contentParts[contentParts.length - 1];
                                    if (lastPart && lastPart.type === 'thinking') {
                                        lastPart.text += item.content;
                                    } else {
                                        contentParts.push({ type: 'thinking', text: item.content });
                                    }
                                    updateStreamingMessage(textContent, thinkingContent);
                                }
                                else if (item.type === 'message') {
                                    // 消息内容（可能是 text 或 content 数组）
                                    const messageText = item.text || item.content?.[0]?.text || '';
                                    if (messageText) {
                                        recordFirstToken();
                                        recordTokens(messageText);
                                        textContent += messageText;
                                        totalReceived += messageText.length;

                                        // ✅ 合并连续的 text parts（只有遇到图片才分段）
                                        const lastPart = contentParts[contentParts.length - 1];
                                        if (lastPart && lastPart.type === 'text') {
                                            lastPart.text += messageText;
                                        } else {
                                            contentParts.push({ type: 'text', text: messageText });
                                        }
                                        updateStreamingMessage(textContent, thinkingContent);
                                    }
                                    // 处理 content 数组（如果有）
                                    else if (Array.isArray(item.content)) {
                                        recordFirstToken();
                                        const addedLength = await handleContentArray(item.content, contentParts);
                                        totalReceived += addedLength; // ✅ 修复：计数图片长度
                                    }
                                }
                            }

                            // 快捷访问（如果有）
                            if (parsed.output_text && !textContent) {
                                textContent = parsed.output_text;
                                totalReceived += textContent.length;
                                updateStreamingMessage(textContent, thinkingContent);
                            }
                        }
                        // Chat Completions API 格式：解析 choices[] 数组
                        else {
                            const delta = parsed.choices?.[0]?.delta;

                            if (delta) {
                                // 处理 reasoning_content (OpenAI o1/o3/o4 思维链)
                                // ✅ 注意：reasoning_content 通常在 content 之前，所以先处理
                                if (delta.reasoning_content) {
                                    recordFirstToken();
                                    recordTokens(delta.reasoning_content);
                                    thinkingContent += delta.reasoning_content;
                                    totalReceived += delta.reasoning_content.length;

                                    // ✅ 合并连续的 thinking parts（只有遇到图片才分段）
                                    const lastPart = contentParts[contentParts.length - 1];
                                    if (lastPart && lastPart.type === 'thinking') {
                                        lastPart.text += delta.reasoning_content;
                                    } else {
                                        contentParts.push({ type: 'thinking', text: delta.reasoning_content });
                                    }
                                    updateStreamingMessage(textContent, thinkingContent);
                                }
                                // 处理文本内容
                                if (typeof delta.content === 'string') {
                                    recordFirstToken();
                                    recordTokens(delta.content);

                                    // ✅ 解析 markdown 图片格式: ![image](data:image/jpeg;base64,...)
                                    const { parts, newBuffer } = parseStreamingMarkdownImages(delta.content, markdownBuffer);
                                    markdownBuffer = newBuffer;

                                    for (const part of parts) {
                                        if (part.type === 'text') {
                                            textContent += part.text;
                                            totalReceived += part.text.length;

                                            // 合并连续的文本部分
                                            const lastPart = contentParts[contentParts.length - 1];
                                            if (lastPart && lastPart.type === 'text') {
                                                lastPart.text += part.text;
                                            } else {
                                                contentParts.push({ type: 'text', text: part.text });
                                            }
                                        } else if (part.type === 'image_url') {
                                            // 添加图片部分
                                            contentParts.push(part);
                                            totalReceived += part.url.length;
                                        }
                                    }

                                    updateStreamingMessage(textContent, thinkingContent);
                                }
                                // 处理 content 数组（包含图片）
                                else if (Array.isArray(delta.content)) {
                                    recordFirstToken();
                                    const addedLength = await handleContentArray(delta.content, contentParts);
                                    totalReceived += addedLength; // ✅ 修复：计数图片长度
                                }
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
                            finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId);
                            return;
                        }
                    } catch (e) {
                        console.warn('OpenAI SSE parse error:', e);
                    }
                }
            }
        }

        // 流结束
        finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId);
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
 * 完成 OpenAI 流处理
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} sessionId - 会话ID
 */
function finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // 渲染最终内容
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent);
    } else if (textContent || thinkingContent) {
        renderFinalTextWithThinking(textContent, thinkingContent);
    }

    // 添加统计信息
    appendStreamStats();

    // 使用统一函数保存消息到所有三种格式并获取索引
    const messageIndex = saveAssistantMessage({
        textContent,
        thinkingContent,
        contentParts,
        streamStats: getCurrentStreamStatsData(),
        sessionId: sessionId, // 🔒 传递会话ID防止串消息
    });

    // ✅ Bug 2 修复：立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);
}

/**
 * ✅ 以错误状态完成 OpenAI 流处理
 * 用于处理流式响应中的 API 错误（如 429）
 * @param {string} textContent - 已接收的文本内容
 * @param {string} thinkingContent - 已接收的思维链内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string|number} errorCode - 错误码
 * @param {string} errorMessage - 错误消息
 * @param {string} sessionId - 会话ID
 */
function finalizeOpenAIStreamWithError(textContent, thinkingContent, contentParts, errorCode, errorMessage, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // ✅ 使用统一的错误渲染函数（包含折叠的技术详情）
    const errorObject = {
        code: errorCode,
        message: errorMessage,
        type: errorCode // OpenAI 有时使用 type 字段
    };

    const errorHtml = renderHumanizedError(errorObject, errorCode, true) +
        `<div style="margin-top: 8px; padding: 8px; background: rgba(255, 140, 0, 0.1); border-left: 3px solid var(--md-coral); font-size: 12px;">
            💾 已保存部分接收的内容
        </div>`;

    const finalText = textContent + '\n\n' + errorMessage;

    // 渲染内容（包含部分内容和错误）
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent);
    } else if (textContent || thinkingContent) {
        renderFinalTextWithThinking(textContent, thinkingContent);
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
