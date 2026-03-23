/**
 * OpenAI 流解析器
 * 解析 OpenAI SSE 流式响应
 */

import { recordFirstToken, recordTokens, recalculateStreamTokenCount, finalizeStreamStats, getCurrentStreamStatsData, getPartialStreamStatsData, appendStreamStats } from './stats.js';
import { updateStreamingMessage, renderFinalTextWithThinking, renderFinalContentWithThinking, cleanupAllIncompleteImages, handleContentArray } from './helpers.js';
import { saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // Bug 2 导入索引设置函数
import { eventBus } from '../core/events.js';
import { renderHumanizedError } from '../utils/errors.js';
import { parseStreamingMarkdownImages, mergeTextParts } from '../utils/markdown-image-parser.js';
import { createToolCallAccumulator, handleToolCallStream } from './tool-call-handler.js';
import { XMLStreamAccumulator } from '../tools/xml-formatter.js';  // XML 工具调用解析
import { state } from '../core/state.js';  // 访问 xmlToolCallingEnabled 配置
import { ThinkTagParser } from './think-tag-parser.js';  // <think> 标签解析器
import { requestStateMachine, RequestState } from '../core/request-state-machine.js';

// 响应长度限制（防止内存溢出）
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
    const contentParts = [];
    let totalReceived = 0; // 追踪总接收字符数
    let markdownBuffer = ''; // Markdown 图片缓冲区（用于暂存不完整的图片）

    // ⭐ 工具调用支持
    const toolCallAccumulator = createToolCallAccumulator();
    const xmlToolCallAccumulator = new XMLStreamAccumulator();  // XML 工具调用累积器
    let hasToolCalls = false;
    let hasNativeToolCalls = false;  // 标记是否检测到原生格式

    // <think> 标签解析器（用于 DeepSeek 等模型）
    const thinkTagParser = new ThinkTagParser();

    // Responses API 的 encrypted_content 签名（用于多轮对话保持思维链上下文）
    let encryptedContent = null;

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
                        finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId, encryptedContent);
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        // 检测流式响应中的错误（如 429 Too Many Requests）
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

                        // Responses API 格式：基于事件类型处理流式响应
                        // 事件类型包括：response.output_text.delta, response.completed 等
                        if (isResponsesFormat && parsed.type) {
                            switch (parsed.type) {
                                case 'response.output_text.delta':
                                    // 文本增量事件
                                    if (parsed.delta) {
                                        recordFirstToken();
                                        recordTokens(parsed.delta);
                                        textContent += parsed.delta;
                                        totalReceived += parsed.delta.length;

                                        // 合并连续的 text parts
                                        const lastTextPart = contentParts[contentParts.length - 1];
                                        if (lastTextPart && lastTextPart.type === 'text') {
                                            lastTextPart.text += parsed.delta;
                                        } else {
                                            contentParts.push({ type: 'text', text: parsed.delta });
                                        }
                                        updateStreamingMessage(textContent, thinkingContent);
                                    }
                                    break;

                                case 'response.reasoning.delta':
                                case 'response.reasoning_summary.delta':
                                    // 推理/思考增量事件
                                    if (parsed.delta) {
                                        recordFirstToken();
                                        recordTokens(parsed.delta);
                                        thinkingContent += parsed.delta;
                                        totalReceived += parsed.delta.length;

                                        // 合并连续的 thinking parts
                                        const lastThinkPart = contentParts[contentParts.length - 1];
                                        if (lastThinkPart && lastThinkPart.type === 'thinking') {
                                            lastThinkPart.text += parsed.delta;
                                        } else {
                                            contentParts.push({ type: 'thinking', text: parsed.delta });
                                        }
                                        updateStreamingMessage(textContent, thinkingContent);
                                    }
                                    break;

                                case 'response.completed':
                                case 'response.done':
                                    // 响应完成事件 - 提取最终内容（如果之前没有收到增量）
                                    if (parsed.response?.output_text && !textContent) {
                                        textContent = parsed.response.output_text;
                                        totalReceived += textContent.length;
                                        recordFirstToken();
                                        recordTokens(textContent);
                                        contentParts.push({ type: 'text', text: textContent });
                                        updateStreamingMessage(textContent, thinkingContent);
                                    }
                                    // 提取 encrypted_content 签名（用于多轮对话）
                                    if (parsed.response?.output) {
                                        for (const item of parsed.response.output) {
                                            if (item.type === 'reasoning' && item.encrypted_content) {
                                                encryptedContent = item.encrypted_content;
                                                console.log('[Parser] 提取到 encrypted_content 签名');
                                            }
                                        }
                                    }
                                    break;

                                // 其他事件类型（如 response.created, response.in_progress 等）暂时忽略
                                default:
                                    console.debug('[Parser] Responses API 事件:', parsed.type);
                                    break;
                            }
                        }
                        // Responses API 格式：兜底 - 部分代理只返回 output_text（没有 type 字段）
                        else if (isResponsesFormat && parsed.output_text && (!parsed.output || !Array.isArray(parsed.output)) && !textContent) {
                            textContent = parsed.output_text;
                            totalReceived += textContent.length;

                            // 统计：output_text 也要计入 tokens（否则工具调用后的正文会"停止计数"）
                            recordFirstToken();
                            recordTokens(textContent);

                            // 同步到 contentParts（仅当还没有任何文本 part 时，避免重复）
                            const hasTextPart = contentParts.some(p => p.type === 'text' && p.text);
                            if (!hasTextPart && textContent) {
                                contentParts.push({ type: 'text', text: textContent });
                            }

                            updateStreamingMessage(textContent, thinkingContent);
                        }
                        // Responses API 格式：兜底 - 解析 output[] 数组（非流式或某些代理）
                        else if (isResponsesFormat && parsed.output && Array.isArray(parsed.output)) {
                            for (const item of parsed.output) {
                                if (item.type === 'reasoning' && item.content) {
                                    // 推理内容
                                    recordFirstToken();
                                    recordTokens(item.content);
                                    thinkingContent += item.content;
                                    totalReceived += item.content.length;

                                    // 合并连续的 thinking parts（只有遇到图片才分段）
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

                                        // 合并连续的 text parts（只有遇到图片才分段）
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

                                        // 统计：content 数组里的文本也要计入 tokens
                                        const textFromParts = item.content
                                            .filter(p => typeof p?.text === 'string' && p.text)
                                            .map(p => p.text)
                                            .join('');
                                        if (textFromParts) {
                                            recordTokens(textFromParts);
                                            textContent += textFromParts;
                                            updateStreamingMessage(textContent, thinkingContent);
                                        }

                                        const addedLength = await handleContentArray(item.content, contentParts);
                                        totalReceived += addedLength; // 计数图片长度
                                    }
                                }
                            }

                            // 快捷访问（如果有）
                            if (parsed.output_text && !textContent) {
                                textContent = parsed.output_text;
                                totalReceived += textContent.length;

                                // 统计：output_text 也要计入 tokens（否则 tokens 会停留在工具调用前）
                                recordFirstToken();
                                recordTokens(textContent);

                                // 同步到 contentParts（仅当还没有任何文本 part 时，避免重复）
                                const hasTextPart = contentParts.some(p => p.type === 'text' && p.text);
                                if (!hasTextPart && textContent) {
                                    contentParts.push({ type: 'text', text: textContent });
                                }

                                updateStreamingMessage(textContent, thinkingContent);
                            }
                        }
                        // Chat Completions API 格式：解析 choices[] 数组
                        else {
                            const delta = parsed.choices?.[0]?.delta;
                            const finishReason = parsed.choices?.[0]?.finish_reason;

                            // 1. 检测原生 tool_calls（仅在非 XML 模式）
                            if (delta?.tool_calls && !state.xmlToolCallingEnabled) {
                                hasToolCalls = true;
                                hasNativeToolCalls = true;  // 标记为原生格式
                                toolCallAccumulator.processDelta(delta.tool_calls);
                                console.log('[Parser] 检测到原生工具调用增量:', delta.tool_calls);
                            }

                            // 先处理 delta.content（检测 XML 工具调用），再检查 finishReason
                            // 保存 XML 解析结果供后续使用（避免重复调用 processDelta）
                            let xmlParseResult = null;
                            if (delta && typeof delta.content === 'string' && state.xmlToolCallingEnabled) {
                                try {
                                    xmlParseResult = xmlToolCallAccumulator.processDelta(delta.content);
                                    const { hasToolCalls: hasXML, error } = xmlParseResult;

                                    if (error) {
                                        console.error('[Parser] ⚠️ XML 解析错误:', error);
                                    } else if (hasXML) {
                                        hasToolCalls = true;
                                        console.log('[Parser] 🔧 检测到 XML 工具调用');
                                    }
                                } catch (xmlError) {
                                    console.error('[Parser] ❌ XML 累积器异常:', xmlError);
                                    xmlParseResult = null;
                                }
                            }

                            // 工具调用完成处理（现在在 XML 检测之后）
                            if (finishReason === 'tool_calls' || (finishReason === 'stop' && hasToolCalls)) {
                                console.log('[Parser] 工具调用完成，准备执行...');

                                // 获取完整的工具调用列表
                                let toolCalls;
                                if (state.xmlToolCallingEnabled) {
                                    // XML 模式：使用 XML 工具调用
                                    toolCalls = xmlToolCallAccumulator.getCompletedCalls();
                                    console.log('[Parser] 🔧 使用 XML 工具调用:', toolCalls.length);
                                } else {
                                    // 原生模式：使用原生工具调用
                                    toolCalls = toolCallAccumulator.getCompletedCalls();
                                    console.log('[Parser] 🔧 使用原生工具调用:', toolCalls.length);
                                }

                                if (toolCalls.length > 0) {
                                    console.log('[OpenAI] 检测到工具调用:', {
                                        toolCallsCount: toolCalls.length,
                                        toolNames: toolCalls.map(tc => tc.name).join(', ')
                                    });
                                        // 注意：工具调用时不结束统计，让统计在 continuation 完成后才最终确定
                                        // finalizeStreamStats() 会在 continuation 完成时调用

                                        // 渲染内容
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
                                            contentParts,
                                            toolCalls, // 保存工具调用信息
                                            streamStats: getPartialStreamStatsData(),  // 保存部分统计，供 continuation 聚合
                                            sessionId
                                        });

                                        setCurrentMessageIndex(messageIndex);

                                        // 转换到工具调用状态
                                        requestStateMachine.transition(RequestState.TOOL_CALLING);
                                        state.isToolCallPending = true; // 向后兼容

                                        // 执行工具调用流程（异步，不阻塞）
                                        handleToolCallStream(toolCalls, {
                                            endpoint: state.endpoint,
                                            apiKey: state.apiKey,
                                            model: state.model
                                        }).catch(_error => {
                                            console.error('[Parser] 工具调用流程失败:', _error);
                                        });

                                    // 提前退出流解析（工具调用完成）
                                    return;
                                }
                            }

                            if (delta) {
                                // 处理 reasoning_content (OpenAI o1/o3/o4 思维链)
                                // 注意：reasoning_content 通常在 content 之前，所以先处理
                                if (delta.reasoning_content) {
                                    recordFirstToken();
                                    recordTokens(delta.reasoning_content);
                                    thinkingContent += delta.reasoning_content;
                                    totalReceived += delta.reasoning_content.length;

                                    // 合并连续的 thinking parts（只有遇到图片才分段）
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

                                    // 使用前面保存的 XML 解析结果（避免重复调用 processDelta）
                                    let contentToProcess = delta.content;
                                    if (state.xmlToolCallingEnabled && xmlParseResult) {
                                        const { displayText } = xmlParseResult;
                                        // 使用去除 XML 标签后的文本
                                        contentToProcess = displayText.substring(textContent.length); // 只取新增部分
                                    }

                                    // 解析 <think> 标签（DeepSeek 等模型的思考内容）
                                    const { displayText: thinkParsedText, thinkingDelta } = thinkTagParser.processDelta(contentToProcess);

                                    // 处理提取的思考内容
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

                                    // 解析 markdown 图片格式: ![image](data:image/jpeg;base64,...)
                                    // 使用 <think> 解析后的显示文本
                                    const { parts, newBuffer } = parseStreamingMarkdownImages(thinkParsedText, markdownBuffer);
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
                                    totalReceived += addedLength; // 计数图片长度
                                }
                            }
                        }

                        // 检查是否超过长度限制
                        if (totalReceived > MAX_RESPONSE_LENGTH) {
                            console.warn(`响应超长（${totalReceived} 字符），已强制截断`);
                            eventBus.emit('ui:notification', {
                                message: `响应过长（${totalReceived.toLocaleString()} 字符），已自动截断`,
                                type: 'warning'
                            });
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
                            finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId, encryptedContent);
                            return;
                        }
                    } catch (_e) {
                        console.warn('OpenAI SSE parse error:', _e);
                    }
                }
            }
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

        // 流结束
        finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId, encryptedContent);
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
 * 完成 OpenAI 流处理
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} sessionId - 会话ID
 * @param {string} encryptedContent - Responses API 的 encrypted_content 签名
 */
function finalizeOpenAIStream(textContent, thinkingContent, contentParts, sessionId, encryptedContent = null) {
    // 流结束，清除工具调用pending标志（如果没有新的工具调用）
    // 这样handler的finally块才能正确清理loading状态
    if (state.isToolCallPending) {
        console.log('[OpenAI] 流结束，重置 isToolCallPending 标志');
        state.isToolCallPending = false;
    }

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

    // 兜底：按最终内容重算 token（避免工具调用后正文漏计数）
    recalculateStreamTokenCount({ textContent, thinkingContent, contentParts });

    // 添加统计信息
    appendStreamStats();

    // 使用统一函数保存消息到所有三种格式并获取索引
    const messageIndex = saveAssistantMessage({
        textContent,
        thinkingContent,
        contentParts,
        streamStats: getCurrentStreamStatsData(),
        sessionId: sessionId, // 🔒 传递会话ID防止串消息
        encryptedContent: encryptedContent,
    });

    // Bug 2 立即设置 dataset.messageIndex
    setCurrentMessageIndex(messageIndex);
}

/**
 * 以错误状态完成 OpenAI 流处理
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

    // 使用统一的错误渲染函数（包含折叠的技术详情）
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

    // 兜底：按最终内容重算 token（避免工具调用后正文漏计数）
    recalculateStreamTokenCount({ textContent: finalText, thinkingContent, contentParts });

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
        console.log('[Parser-OpenAI] 错误状态下强制清理 isToolCallPending');
        state.isToolCallPending = false;
    }
}
