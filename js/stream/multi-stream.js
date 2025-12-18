/**
 * 流式多回复处理模块
 * 并行处理多个流式响应
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { recordFirstToken, recordTokens, finalizeStreamStats, getCurrentStreamStatsData, appendStreamStats } from './stats.js';
import { updateStreamingMessage } from './helpers.js';
import { saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // Bug 2 导入索引设置函数
import { renderReplyWithSelector } from '../messages/renderer.js';
import { renderHumanizedError } from '../utils/errors.js';
import { saveErrorMessage } from '../messages/sync.js';
import { getSendFunction } from '../api/factory.js';
import { getCurrentProvider } from '../providers/manager.js';

/**
 * 处理多个流式响应（并行）
 * @param {string} endpoint - API端点
 * @param {string} apiKey - API密钥
 * @param {string} model - 模型名称
 * @param {AbortController} abortController - 取消控制器
 * @param {HTMLElement} assistantMessageEl - 助手消息元素
 * @param {string} sessionId - 会话ID
 */
export async function handleMultiStreamResponses(endpoint, apiKey, model, abortController, assistantMessageEl, sessionId) {
    const replyCount = state.replyCount || 1;

    // 显示进度
    state.currentAssistantMessage.innerHTML = `<div class="multi-reply-progress">正在并行生成 ${replyCount} 个回复...</div>`;

    // 并行发送所有请求
    const promises = [];

    // 使用提供商的原始 apiFormat
    const provider = getCurrentProvider();
    const requestFormat = provider?.apiFormat || 'openai';
    const sendFn = getSendFunction(requestFormat);

    for (let i = 0; i < replyCount; i++) {
        promises.push(sendFn(endpoint, apiKey, model, abortController.signal));
    }

    // 等待所有请求返回响应对象
    const responseResults = await Promise.allSettled(promises);

    // 筛选成功的响应，同时收集错误信息
    const validResponses = [];
    const errorDetails = [];
    for (let i = 0; i < responseResults.length; i++) {
        const result = responseResults[i];
        if (result.status === 'fulfilled' && result.value.ok) {
            validResponses.push({ index: i, response: result.value });
        } else {
            // 收集错误详情
            if (result.status === 'rejected') {
                errorDetails.push({ index: i + 1, type: 'network', error: result.reason });
                console.error(`Response ${i + 1} failed:`, result.reason);
            } else {
                // 尝试解析响应体中的错误信息
                const response = result.value;
                try {
                    const errorData = await response.clone().json();
                    errorDetails.push({ index: i + 1, type: 'api', status: response.status, error: errorData });
                } catch (e) {
                    errorDetails.push({ index: i + 1, type: 'http', status: response.status, error: { message: `HTTP ${response.status}` } });
                }
                console.error(`Response ${i + 1} not ok:`, response.status);
            }
        }
    }

    if (validResponses.length === 0) {
        // 构建包含详细错误信息的错误对象
        const firstError = errorDetails[0];
        const errorObj = firstError?.error || { message: '未知错误' };
        const statusCode = firstError?.status || 0;

        // 添加所有错误的汇总信息（保留完整错误对象）
        if (errorDetails.length > 1) {
            errorObj.allErrors = errorDetails.map(e => ({
                request: e.index,
                status: e.status || (e.type === 'network' ? 'Network Error' : 'Unknown'),
                message: e.error?.error?.message || e.error?.message || String(e.error),
                // 保留完整的错误对象以便技术详情显示
                type: e.error?.error?.type || e.error?.type,
                code: e.error?.error?.code || e.error?.code,
                fullError: e.error  // 完整错误对象
            }));
        }

        state.currentAssistantMessage.innerHTML = renderHumanizedError(errorObj, statusCode);
        saveErrorMessage(errorObj, statusCode, renderHumanizedError);
        return;
    }

    // 更新进度
    state.currentAssistantMessage.innerHTML = `<div class="multi-reply-progress">正在接收 ${validResponses.length} 个回复的流式数据...</div>`;

    // 并行处理所有流，第一个流实时显示，其他流后台处理
    const streamPromises = validResponses.map((item, idx) => {
        return parseStreamToReply(item.response, idx === 0);
    });

    const streamResults = await Promise.allSettled(streamPromises);

    // 收集所有回复（成功或失败）
    const allReplies = [];
    const streamErrors = [];
    for (let i = 0; i < streamResults.length; i++) {
        const result = streamResults[i];
        if (result.status === 'fulfilled' && result.value) {
            allReplies.push(result.value);
        } else if (result.status === 'rejected') {
            // 解析错误信息
            const errorMessage = result.reason?.message || String(result.reason);
            const [errorType, ...messageParts] = errorMessage.split(':');
            const cleanMessage = messageParts.join(':').trim() || errorMessage;

            // 为失败的流创建错误回复对象
            allReplies.push({
                content: '',
                isError: true,
                errorType: errorType || 'stream_error',
                errorMessage: cleanMessage
            });

            streamErrors.push({
                index: i + 1,
                error: result.reason
            });
            console.error(`Stream ${i + 1} failed:`, result.reason);
        }
    }

    // 完成统计
    finalizeStreamStats();

    // 处理结果
    if (allReplies.length > 0) {
        state.currentReplies = allReplies;
        state.selectedReplyIndex = 0;

        const reply0 = allReplies[0];

        // 保存消息并获取索引
        const messageIndex = saveAssistantMessage({
            textContent: reply0.content || '',
            thinkingContent: reply0.thinkingContent,
            thoughtSignature: reply0.thoughtSignature,
            streamStats: getCurrentStreamStatsData(),
            allReplies: allReplies,
            selectedReplyIndex: 0,
            geminiParts: reply0.parts,
            sessionId: sessionId, // 🔒 传递会话ID防止串消息
        });

        // Bug 2 立即设置 dataset.messageIndex
        setCurrentMessageIndex(messageIndex);

        // 渲染回复选择器
        renderReplyWithSelector(allReplies, 0, assistantMessageEl);

        // 添加统计信息
        appendStreamStats();
    } else {
        // 所有流都失败了，显示详细错误信息
        let errorObj;
        if (streamErrors.length > 0) {
            // 使用第一个错误作为主错误
            const firstError = streamErrors[0].error;
            const errorMessage = firstError?.message || String(firstError);

            // 解析错误类型和消息
            const [errorType, ...messageParts] = errorMessage.split(':');
            const cleanMessage = messageParts.join(':').trim() || errorMessage;

            errorObj = {
                error: {
                    type: errorType || 'stream_error',
                    message: cleanMessage
                }
            };

            // 如果有多个错误，添加到allErrors数组（保留完整错误对象）
            if (streamErrors.length > 1) {
                errorObj.error.allErrors = streamErrors.map(e => {
                    const errorMessage = e.error?.message || String(e.error);
                    // 尝试从错误消息中提取类型和代码
                    const [errorType, ...messageParts] = errorMessage.split(':');
                    return {
                        stream: e.index,
                        message: messageParts.join(':').trim() || errorMessage,
                        type: errorType || e.error?.type,
                        code: e.error?.code,
                        fullError: e.error  // 完整错误对象
                    };
                });
            }
        } else {
            errorObj = { error: { type: 'empty_response', message: '没有收到有效回复' } };
        }

        state.currentAssistantMessage.innerHTML = renderHumanizedError(errorObj, 0);
        saveErrorMessage(errorObj, 0, renderHumanizedError);
    }
}

/**
 * 解析单个流并返回回复对象
 * @param {Response} response - Fetch Response
 * @param {boolean} showRealtime - 是否实时显示
 * @returns {Promise<Object>} 回复对象
 */
async function parseStreamToReply(response, showRealtime = false) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let thinkingContent = '';
    let thoughtSignature = null;
    let groundingMetadata = null;
    const contentParts = [];

    switch (state.apiFormat) {
        case 'gemini':
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || line.startsWith(':')) continue;

                    try {
                        let jsonStr = line;
                        if (line.startsWith('data: ')) {
                            jsonStr = line.slice(6).trim();
                            if (jsonStr === '[DONE]') continue;
                        }

                        const parsed = JSON.parse(jsonStr);

                        // 检测Gemini错误响应
                        if (parsed.error) {
                            const errorCode = parsed.error.code || 'unknown';
                            const errorMessage = parsed.error.message || 'Unknown error';
                            console.error(`❌ Gemini API error in multi-stream:`, parsed.error);

                            // 抛出错误，让外层Promise.allSettled捕获
                            throw new Error(`${errorCode}: ${errorMessage}`);
                        }

                        const parts = parsed.candidates?.[0]?.content?.parts || [];

                        for (const part of parts) {
                            if (part.thoughtSignature) {
                                thoughtSignature = part.thoughtSignature;
                            }
                            if (part.thought) {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(part.text);
                                }
                                thinkingContent += part.text || '';
                            } else if (part.text) {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(part.text);
                                }
                                textContent += part.text;
                            } else if (part.inlineData) {
                                const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                                contentParts.push({
                                    type: 'image_url',
                                    url: dataUrl,
                                    complete: true,
                                    inlineData: part.inlineData
                                });
                            }
                        }

                        if (parsed.candidates?.[0]?.groundingMetadata) {
                            groundingMetadata = parsed.candidates[0].groundingMetadata;
                        }

                        // 实时显示第一个流
                        if (showRealtime) {
                            updateStreamingMessage(textContent, thinkingContent);
                        }
                    } catch (e) {
                        console.warn('Gemini stream parse error:', e);
                        // 如果是API错误，重新抛出
                        if (e.message.includes(':')) {
                            throw e;
                        }
                    }
                }
            }

            return {
                content: textContent,
                parts: buildGeminiReplyParts(textContent, contentParts),
                thinkingContent: thinkingContent || null,
                thoughtSignature: thoughtSignature,
                groundingMetadata: groundingMetadata
            };

        case 'claude':
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);

                        // 检测错误事件
                        if (parsed.type === 'error') {
                            const errorCode = parsed.error?.type || 'unknown';
                            const errorMessage = parsed.error?.message || 'Unknown error';
                            console.error(`❌ Claude API error in multi-stream:`, parsed.error);

                            // 抛出错误，让外层Promise.allSettled捕获
                            throw new Error(`${errorCode}: ${errorMessage}`);
                        }

                        if (parsed.type === 'content_block_delta') {
                            const delta = parsed.delta;
                            if (delta?.type === 'text_delta') {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(delta.text);
                                }
                                textContent += delta.text;
                                if (showRealtime) updateStreamingMessage(textContent, thinkingContent);
                            } else if (delta?.type === 'thinking_delta') {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(delta.thinking);
                                }
                                thinkingContent += delta.thinking;
                                if (showRealtime) updateStreamingMessage(textContent, thinkingContent);
                            }
                        }
                    } catch (e) {
                        console.warn('Claude stream parse error:', e);
                        // 如果是API错误，重新抛出
                        if (e.message.includes(':')) {
                            throw e;
                        }
                    }
                }
            }

            return {
                content: textContent,
                thinkingContent: thinkingContent || null
            };

        case 'openai':
        default:
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') break;

                    try {
                        const parsed = JSON.parse(data);

                        // 检测OpenAI错误响应
                        if (parsed.error) {
                            const errorCode = parsed.error.code || parsed.error.type || 'unknown';
                            const errorMessage = parsed.error.message || 'Unknown error';
                            console.error(`❌ OpenAI API error in multi-stream:`, parsed.error);

                            // 抛出错误，让外层Promise.allSettled捕获
                            throw new Error(`${errorCode}: ${errorMessage}`);
                        }

                        const delta = parsed.choices?.[0]?.delta;

                        if (delta) {
                            if (typeof delta.content === 'string') {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(delta.content);
                                }
                                textContent += delta.content;
                                if (showRealtime) updateStreamingMessage(textContent, thinkingContent);
                            }
                            if (delta.reasoning_content) {
                                if (showRealtime) {
                                    recordFirstToken();
                                    recordTokens(delta.reasoning_content);
                                }
                                thinkingContent += delta.reasoning_content;
                                if (showRealtime) updateStreamingMessage(textContent, thinkingContent);
                            }
                        }
                    } catch (e) {
                        console.warn('OpenAI stream parse error:', e);
                        // 如果是API错误，重新抛出
                        if (e.message.includes(':')) {
                            throw e;
                        }
                    }
                }
            }

            return {
                content: textContent,
                thinkingContent: thinkingContent || null
            };
    }
}

/**
 * 构建 Gemini 回复的 parts
 * @param {string} textContent - 文本内容
 * @param {Array} contentParts - 内容部分
 * @returns {Array} Gemini parts 数组
 */
function buildGeminiReplyParts(textContent, contentParts) {
    const parts = [];
    if (textContent) parts.push({ text: textContent });
    contentParts.forEach(p => {
        if (p.inlineData) parts.push({ inlineData: p.inlineData });
    });
    return parts;
}
