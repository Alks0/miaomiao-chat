/**
 * Gemini 流解析器
 * 解析 Gemini SSE 流式响应
 */

import { recordFirstToken, recordTokens, recalculateStreamTokenCount, finalizeStreamStats, getCurrentStreamStatsData, getPartialStreamStatsData, appendStreamStats } from './stats.js';
import { updateStreamingMessage, renderFinalTextWithThinking, renderFinalContentWithThinking, cleanupAllIncompleteImages } from './helpers.js';
import { saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // Bug 2 导入索引设置函数
import { eventBus } from '../core/events.js';
import { renderHumanizedError } from '../utils/errors.js';
import { parseStreamingMarkdownImages } from '../utils/markdown-image-parser.js';
import { handleToolCallStream } from './tool-call-handler.js';
import { XMLStreamAccumulator } from '../tools/xml-formatter.js';  // XML 工具调用解析
import { state } from '../core/state.js';  // 访问 xmlToolCallingEnabled 配置
import { ThinkTagParser } from './think-tag-parser.js';  // <think> 标签解析器
import { requestStateMachine, RequestState } from '../core/request-state-machine.js';
import { isVideoMimeType } from '../utils/media.js';

// 响应长度限制（防止内存溢出）
const MAX_TEXT_RESPONSE_LENGTH = 200000;     // 纯文本响应：200KB
const MAX_IMAGE_RESPONSE_LENGTH = 60000000;  // 图片响应：60MB（支持 4K 图片）

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
    let _groundingMetadata = null;
    const contentParts = [];
    let totalReceived = 0; // 追踪总接收字符数
    let markdownBuffer = ''; // Markdown 图片缓冲区
    const toolCalls = []; // ⭐ 工具调用数组
    const xmlToolCallAccumulator = new XMLStreamAccumulator();  // XML 工具调用累积器
    let xmlParsingDisabled = false;  // XML 解析崩溃时禁用，回退到纯文本
    const thinkTagParser = new ThinkTagParser();  // <think> 标签解析器

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

                    // 检测流式响应中的错误（如 429 Too Many Requests）
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
                                _groundingMetadata,
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
                        // 提取 thoughtSignature（在检测工具调用前）
                        if (part.thoughtSignature) {
                            thoughtSignature = part.thoughtSignature;
                            console.log('[Gemini] 🧠 检测到 thoughtSignature');
                        }

                        // ⭐ 检测工具调用 (Gemini 格式，仅在非 XML 模式)
                        if (part.functionCall && !state.xmlToolCallingEnabled) {
                            const fc = part.functionCall;
                            toolCalls.push({
                                id: fc.id || `gemini_tc_${Date.now()}_${toolCalls.length}`,
                                name: fc.name,
                                arguments: fc.args,  // 已经是对象，不需要 JSON.parse
                                // 保存 thoughtSignature（如果存在）
                                thoughtSignature: thoughtSignature || null
                            });
                            console.log('[Gemini] 检测到原生工具调用:', {
                                name: fc.name,
                                hasThoughtSignature: !!thoughtSignature
                            });
                            continue;  // 工具调用不需要渲染
                        }

                        if (part.thought) {
                            recordFirstToken();
                            recordTokens(part.text);
                            const thoughtText = part.text || '';
                            thinkingContent += thoughtText;  // 用于实时显示
                            totalReceived += thoughtText.length;

                            // 合并连续的 thinking parts（只有遇到图片才分段）
                            const lastPart = contentParts[contentParts.length - 1];
                            if (lastPart && lastPart.type === 'thinking') {
                                lastPart.text += thoughtText;
                            } else {
                                contentParts.push({ type: 'thinking', text: thoughtText });
                            }
                        } else if (part.text) {
                            recordFirstToken();
                            recordTokens(part.text);

                            // 优先处理 XML 检测（仅在 XML 模式）
                            let deltaText = part.text;
                            if (state.xmlToolCallingEnabled) {
                                try {
                                    const result = xmlToolCallAccumulator.processDelta(part.text);
                                    const { hasToolCalls: hasXML, displayText, error } = result;

                                    if (error) {
                                        console.error('[Gemini Parser] ⚠️ XML 解析错误:', error);
                                        // 回退：将当前内容当作普通文本处理
                                    } else if (hasXML) {
                                        // 更新展示文本（去除 XML 标签）
                                        deltaText = displayText.substring(textContent.length);
                                        console.log('[Gemini Parser] 🔧 检测到 XML 工具调用');
                                    }
                                } catch (xmlError) {
                                    // 顶层错误保护 - XML 解析崩溃时不影响正常流式输出
                                    console.error('[Gemini Parser] ❌ XML 累积器异常:', xmlError);
                                    // 禁用 XML 模式，回退到纯文本
                                    xmlParsingDisabled = true;
                                }
                            }

                            // 解析 <think> 标签
                            const { displayText: thinkParsedText, thinkingDelta } = thinkTagParser.processDelta(deltaText);
                            if (thinkingDelta) {
                                thinkingContent += thinkingDelta;
                                totalReceived += thinkingDelta.length;

                                // 合并连续的 thinking parts
                                const lastThinkPart = contentParts[contentParts.length - 1];
                                if (lastThinkPart && lastThinkPart.type === 'thinking') {
                                    lastThinkPart.text += thinkingDelta;
                                } else {
                                    contentParts.push({ type: 'thinking', text: thinkingDelta });
                                }
                            }

                            // 解析 markdown 图片格式（使用 <think> 解析后的文本）
                            const { parts: parsedParts, newBuffer } = parseStreamingMarkdownImages(thinkParsedText, markdownBuffer);
                            markdownBuffer = newBuffer;

                            for (const parsedPart of parsedParts) {
                                if (parsedPart.type === 'text') {
                                    // 过滤掉图片占位符（避免显示 [Image #1] 等）
                                    let textToAdd = parsedPart.text;
                                    const hasMediaParts = contentParts.some(p => p.type === 'image_url' || p.type === 'video_url');
                                    if (hasMediaParts) {
                                        textToAdd = textToAdd.replace(/\[Image #\d+\]/g, '').trim();
                                    }

                                    if (textToAdd) {
                                        textContent += textToAdd;  // 用于实时显示
                                        totalReceived += textToAdd.length;

                                        // 合并连续的文本部分
                                        const lastPart = contentParts[contentParts.length - 1];
                                        if (lastPart && lastPart.type === 'text') {
                                            lastPart.text += textToAdd;
                                        } else {
                                            contentParts.push({ type: 'text', text: textToAdd });
                                        }
                                    }
                                } else if (parsedPart.type === 'image_url') {
                                    // 添加从 markdown 解析出的图片
                                    contentParts.push(parsedPart);
                                    totalReceived += parsedPart.url.length;
                                }
                            }
                        } else if (part.inlineData || part.inline_data) {
                            // 图片独立成块，自动分段
                            const inlineData = part.inlineData || part.inline_data;
                            const mimeType = inlineData.mimeType || inlineData.mime_type || '';

                            // 检查数据格式：跳过文件名格式的图片
                            if (typeof inlineData.data === 'string' && inlineData.data.length < 200 && !inlineData.data.includes('/')) {
                                // 这可能是文件名（如 "final_circled_girls.jpg"）而不是 base64 数据
                                console.error('[Gemini] ❌ Code Execution 返回的是文件名而非 base64 数据!');
                                console.error('[Gemini] 📋 完整的 part 数据:', part);
                                console.error('[Gemini] 💡 这通常是后端代理服务器的问题，请联系代理服务商修复');

                                // 添加一个提示文本
                                const warningText = `\n❌ 无法显示图片 "${inlineData.data}"（后端返回了文件名而不是图片数据，请联系代理服务商修复）\n`;
                                textContent += warningText;
                                contentParts.push({ type: 'text', text: warningText });
                            } else {
                                // 正常的 base64 数据
                                const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
                                const mediaType = isVideoMimeType(mimeType) ? 'video_url' : 'image_url';
                                contentParts.push({ type: mediaType, url: dataUrl, complete: true, mimeType });
                                // 计数 base64 数据长度（防止超长）
                                totalReceived += inlineData.data.length;
                            }
                        }
                    }

                    // 智能截断检查（区分文本和图片响应）
                    const hasMedia = contentParts.some(p => p.type === 'image_url' || p.type === 'video_url');
                    const mediaDataSize = contentParts
                        .filter(p => p.type === 'image_url' || p.type === 'video_url')
                        .reduce((sum, p) => sum + (p.url ? p.url.length : 0), 0);
                    const textDataSize = totalReceived - mediaDataSize;

                    const limit = hasMedia ? MAX_IMAGE_RESPONSE_LENGTH : MAX_TEXT_RESPONSE_LENGTH;
                    const exceeded = totalReceived > limit;

                    if (exceeded) {
                        if (hasMedia && textDataSize <= MAX_TEXT_RESPONSE_LENGTH) {
                            // 图片生成完成，这是正常情况，不显示警告
                            console.log(`媒体生成完成（媒体 ${(mediaDataSize/1024/1024).toFixed(1)}MB + 文本 ${textDataSize.toLocaleString()} 字符）`);
                        } else {
                            // 真正的超长响应
                            console.warn(`响应超长（${totalReceived.toLocaleString()} 字符），已强制截断`);
                            eventBus.emit('ui:notification', {
                                message: `响应过长（${totalReceived.toLocaleString()} 字符），已自动截断`,
                                type: 'warning'
                            });
                        }
                        await reader.cancel();
                        // 截断前刷新 <think> 解析器缓冲区
                        const { displayText: truncDisplayText, thinkingDelta: truncThinkingDelta } = thinkTagParser.flush();
                        if (truncThinkingDelta) {
                            thinkingContent += truncThinkingDelta;
                            const lastThinkPart = contentParts[contentParts.length - 1];
                            if (lastThinkPart && lastThinkPart.type === 'thinking') {
                                lastThinkPart.text += truncThinkingDelta;
                            } else {
                                contentParts.push({ type: 'thinking', text: truncThinkingDelta });
                            }
                        }
                        if (truncDisplayText) {
                            textContent += truncDisplayText;
                            const lastPart = contentParts[contentParts.length - 1];
                            if (lastPart && lastPart.type === 'text') {
                                lastPart.text += truncDisplayText;
                            } else {
                                contentParts.push({ type: 'text', text: truncDisplayText });
                            }
                        }
                        finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, _groundingMetadata, contentParts, sessionId);
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
                        _groundingMetadata = parsed.candidates[0].groundingMetadata;
                    }

                    updateStreamingMessage(textContent, thinkingContent);

                } catch (_e) {
                    console.warn('Gemini stream parse error:', _e);
                }
            }
        }

        // ⭐ 流结束，检查是否有工具调用
        let finalToolCalls = [];

        if (state.xmlToolCallingEnabled && !xmlParsingDisabled) {
            // XML 模式：使用 XML 工具调用
            const xmlCalls = xmlToolCallAccumulator.getCompletedCalls();
            if (xmlCalls.length > 0) {
                // 为 XML 工具调用添加 thoughtSignature（Gemini 2.5+ thinking 模式要求）
                finalToolCalls = xmlCalls.map(tc => ({
                    ...tc,
                    thoughtSignature: thoughtSignature || null
                }));
                console.log(`[Gemini] 流结束，检测到 ${xmlCalls.length} 个 XML 工具调用, hasThoughtSignature: ${!!thoughtSignature}`);
            }
        } else {
            // 原生模式：使用原生工具调用
            if (toolCalls.length > 0) {
                finalToolCalls = toolCalls;
                console.log(`[Gemini] 流结束，检测到 ${finalToolCalls.length} 个原生工具调用`);
            }
        }

        // 执行工具调用（如果有）
        if (finalToolCalls.length > 0) {
            console.log('[Gemini] 检测到工具调用:', {
                toolCallsCount: finalToolCalls.length,
                toolNames: finalToolCalls.map(tc => tc.name).join(', ')
            });
                // 注意：工具调用时不结束统计，让统计在 continuation 完成后才最终确定
                // finalizeStreamStats() 会在 continuation 完成时调用

                // 关键先渲染思维链到 DOM，然后再保存消息
                if (contentParts.length > 0) {
                    renderFinalContentWithThinking(contentParts, thinkingContent);
                } else if (textContent || thinkingContent) {
                    renderFinalTextWithThinking(textContent, thinkingContent);
                }

                // 工具调用时不添加统计 HTML，等 continuation 完成后再添加
                // appendStreamStats() 会在 continuation 完成时调用

                // 保存助手消息（包含工具调用）- 保存部分统计（TTFT 和当前 token 数）
                const messageIndex = saveAssistantMessage({
                    textContent: textContent || '(调用工具)',
                    thinkingContent,
                    thoughtSignature,
                    contentParts,
                    toolCalls: finalToolCalls,
                    streamStats: getPartialStreamStatsData(),  // 保存部分统计，供 continuation 聚合
                    sessionId
                });

                // 设置消息索引
                setCurrentMessageIndex(messageIndex);

                // 转换到工具调用状态
                requestStateMachine.transition(RequestState.TOOL_CALLING);
                state.isToolCallPending = true; // 向后兼容

            // 执行工具调用（异步）
            handleToolCallStream(finalToolCalls, {
                endpoint: state.endpoint,
                apiKey: state.apiKey,
                model: state.model
            }).catch(error => {
                console.error('[Parser] 工具调用流程失败:', error);
            });

            return; // 退出流处理
        }

        // 流结束前刷新 <think> 解析器缓冲区
        const { displayText: finalDisplayText, thinkingDelta: finalThinkingDelta } = thinkTagParser.flush();
        if (finalThinkingDelta) {
            thinkingContent += finalThinkingDelta;
            const lastThinkPart = contentParts[contentParts.length - 1];
            if (lastThinkPart && lastThinkPart.type === 'thinking') {
                lastThinkPart.text += finalThinkingDelta;
            } else {
                contentParts.push({ type: 'thinking', text: finalThinkingDelta });
            }
        }
        if (finalDisplayText) {
            textContent += finalDisplayText;
            const lastPart = contentParts[contentParts.length - 1];
            if (lastPart && lastPart.type === 'text') {
                lastPart.text += finalDisplayText;
            } else {
                contentParts.push({ type: 'text', text: finalDisplayText });
            }
        }

        // 流结束，保存消息和签名
        finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, _groundingMetadata, contentParts, sessionId);
    } finally {
        // 关键释放 reader 锁，防止资源泄漏
        try {
            reader.releaseLock();
        } catch (_e) {
            // Reader 可能已被释放或取消，忽略错误
            console.debug('Reader lock already released:', _e);
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
function finalizeGeminiStream(textContent, thinkingContent, thoughtSignature, _groundingMetadata, contentParts, sessionId) {
    // 流结束，清除工具调用pending标志（如果没有新的工具调用）
    // 这样handler的finally块才能正确清理loading状态
    if (state.isToolCallPending) {
        console.log('[Gemini] 流结束，重置 isToolCallPending 标志');
        state.isToolCallPending = false;
    }

    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // 渲染最终内容
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent, _groundingMetadata);
    } else {
        renderFinalTextWithThinking(textContent, thinkingContent, _groundingMetadata);
    }

    // 兜底：按最终内容重算 token（避免工具调用后正文漏计数）
    recalculateStreamTokenCount({ textContent, thinkingContent, contentParts });

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

    // Bug 2 立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);
}

/**
 * 以错误状态完成 Gemini 流处理
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
function finalizeGeminiStreamWithError(textContent, thinkingContent, thoughtSignature, _groundingMetadata, contentParts, errorCode, errorMessage, _errorStatus, sessionId) {
    // 完成统计
    finalizeStreamStats();

    // 清理所有未完成的图片缓冲区
    cleanupAllIncompleteImages(contentParts);

    // 使用统一的错误渲染函数（包含折叠的技术详情）
    const errorObject = {
        code: errorCode,
        message: errorMessage,
        status: _errorStatus
    };

    const errorHtml = renderHumanizedError(errorObject, errorCode, true) +
        `<div style="margin-top: 8px; padding: 8px; background: rgba(255, 140, 0, 0.1); border-left: 3px solid var(--md-coral); font-size: 12px;">
            💾 已保存部分接收的内容
        </div>`;

    const finalText = textContent + '\n\n' + errorMessage;

    // 渲染内容（包含部分内容和错误）
    if (contentParts.length > 0) {
        renderFinalContentWithThinking(contentParts, thinkingContent, _groundingMetadata);
    } else {
        renderFinalTextWithThinking(textContent, thinkingContent, _groundingMetadata);
    }

    // 在消息末尾插入错误提示
    const currentMsg = document.querySelector('.message.assistant:last-child');
    if (currentMsg) {
        const contentDiv = currentMsg.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.insertAdjacentHTML('beforeend', errorHtml);
        }
    }

    // 兜底：按最终内容重算 token（避免工具调用后正文漏计数）
    recalculateStreamTokenCount({ textContent: finalText, thinkingContent, contentParts });

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

    // Bug 2 立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);

    // 触发 UI 状态重置
    eventBus.emit('stream:error', {
        errorCode,
        errorMessage,
        partialContent: textContent
    });

    // 强制清理工具调用标志（防止状态泄漏）
    if (state.isToolCallPending) {
        console.log('[Parser-Gemini] 错误状态下强制清理 isToolCallPending');
        state.isToolCallPending = false;
    }
}
