/**
 * Claude 流解析器
 * 解析 Claude SSE 流式响应
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
 * 解析 Claude 流式响应
 * @param {ReadableStreamDefaultReader} reader - 流读取器
 * @param {string} sessionId - 会话ID
 */
export async function parseClaudeStream(reader, sessionId = null) {
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinkingBlocks = [];  // 存储多个独立的思考块
    let currentThinkingBlock = '';  // 当前正在接收的思考块
    let currentBlockType = null;
    let blockIndex = 0;
    let totalReceived = 0; // ✅ 追踪总接收字符数
    let markdownBuffer = ''; // ✅ Markdown 图片缓冲区
    let contentParts = []; // ✅ 内容部分（用于支持图片）

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(line.slice(6));

                        // ✅ 检测流式响应中的错误（如 429 Too Many Requests）
                        if (event.type === 'error') {
                            const errorCode = event.error?.type || 'unknown';
                            const errorMessage = event.error?.message || 'Unknown error';

                            console.error(`❌ Claude API 错误 (流式响应):`, event.error);

                            // 显示错误通知
                            let userMessage = '';
                            if (errorCode === 'rate_limit_error' || errorCode === 429) {
                                userMessage = `请求过多 (429)：${errorMessage}\n请稍后再试`;
                            } else if (errorCode === 'overloaded_error' || errorCode === 529) {
                                userMessage = `服务过载 (529)：${errorMessage}\n请稍后重试`;
                            } else if (errorCode === 'api_error') {
                                userMessage = `API 错误：${errorMessage}`;
                            } else {
                                userMessage = `错误 (${errorCode}): ${errorMessage}`;
                            }

                            eventBus.emit('ui:notification', {
                                message: userMessage,
                                type: 'error',
                                duration: 8000
                            });

                            // 取消流并清理
                            await reader.cancel();

                            // 如果已有部分内容，保存为错误消息
                            const partialThinking = [...thinkingBlocks, currentThinkingBlock].filter(Boolean).join('\n\n---\n\n');
                            if (textContent || partialThinking || contentParts.length > 0) {
                                finalizeClaudeStreamWithError(textContent, partialThinking, contentParts, errorCode, errorMessage, sessionId);
                            }

                            return; // 退出流处理
                        }

                        switch (event.type) {
                            case 'content_block_start':
                                currentBlockType = event.content_block?.type;
                                blockIndex = event.index;
                                // 如果是新的思考块，初始化
                                if (currentBlockType === 'thinking') {
                                    currentThinkingBlock = '';
                                }
                                break;

                            case 'content_block_delta':
                                if (event.delta?.type === 'thinking_delta') {
                                    recordFirstToken();
                                    recordTokens(event.delta.thinking);
                                    currentThinkingBlock += event.delta.thinking;
                                    totalReceived += event.delta.thinking.length;
                                    // 实时更新显示（合并所有已完成的思考块 + 当前思考块）
                                    const allThinking = [...thinkingBlocks, currentThinkingBlock].join('\n\n---\n\n');
                                    updateStreamingMessage(textContent, allThinking);
                                } else if (event.delta?.type === 'text_delta') {
                                    recordFirstToken();
                                    recordTokens(event.delta.text);

                                    // ✅ 解析 markdown 图片格式
                                    const { parts, newBuffer } = parseStreamingMarkdownImages(event.delta.text, markdownBuffer);
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
                                            contentParts.push(part);
                                            totalReceived += part.url.length;
                                        }
                                    }

                                    const allThinking = thinkingBlocks.join('\n\n---\n\n');
                                    updateStreamingMessage(textContent, allThinking);
                                }

                                // ✅ 检查是否超过长度限制
                                if (totalReceived > MAX_RESPONSE_LENGTH) {
                                    console.warn(`响应超长（${totalReceived} 字符），已强制截断`);
                                    eventBus.emit('ui:notification', {
                                        message: `响应过长（${totalReceived.toLocaleString()} 字符），已自动截断`,
                                        type: 'warning'
                                    });
                                    await reader.cancel();
                                    const finalThinking = thinkingBlocks.join('\n\n---\n\n');
                                    finalizeClaudeStream(textContent, finalThinking, contentParts, sessionId);
                                    return;
                                }
                                break;

                            case 'content_block_stop':
                                // 如果当前块是思考块，将其保存到数组
                                if (currentBlockType === 'thinking' && currentThinkingBlock) {
                                    thinkingBlocks.push(currentThinkingBlock);
                                    currentThinkingBlock = '';
                                }
                                currentBlockType = null;
                                break;

                            case 'message_stop':
                                // 合并所有思考块（用分隔线分隔）
                                const finalThinking = thinkingBlocks.join('\n\n---\n\n');
                                finalizeClaudeStream(textContent, finalThinking, contentParts, sessionId);
                                return;
                        }
                    } catch (e) {
                        console.warn('Claude SSE parse error:', e);
                    }
                }
            }
        }

        // 流结束
        const finalThinking = thinkingBlocks.join('\n\n---\n\n');
        finalizeClaudeStream(textContent, finalThinking, contentParts, sessionId);
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
 * 完成 Claude 流处理
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} sessionId - 会话ID
 */
function finalizeClaudeStream(textContent, thinkingContent, contentParts, sessionId) {
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
 * ✅ 以错误状态完成 Claude 流处理
 * 用于处理流式响应中的 API 错误（如 429）
 * @param {string} textContent - 已接收的文本内容
 * @param {string} thinkingContent - 已接收的思维链内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} errorCode - 错误码
 * @param {string} errorMessage - 错误消息
 * @param {string} sessionId - 会话ID
 */
function finalizeClaudeStreamWithError(textContent, thinkingContent, contentParts, errorCode, errorMessage, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // ✅ 使用统一的错误渲染函数（包含折叠的技术详情）
    const errorObject = {
        type: errorCode,
        message: errorMessage
    };

    const errorHtml = renderHumanizedError(errorObject, null, true) +
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
        sessionId: sessionId, // 🔒 传递会话ID防止串消息
        errorHtml
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
