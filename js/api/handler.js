/**
 * API 处理器
 * 响应 API 请求事件，协调请求发送和响应处理
 */

import { state, elements } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { getSendFunction } from './factory.js';
import { getCurrentProvider } from '../providers/manager.js';
import { parseOpenAIStream } from '../stream/parser-openai.js';
import { parseClaudeStream } from '../stream/parser-claude.js';
import { parseGeminiStream } from '../stream/parser-gemini.js';
import { resetStreamStats, finalizeStreamStats, getCurrentStreamStatsData, appendStreamStats } from '../stream/stats.js';
import { saveErrorMessage, saveAssistantMessage } from '../messages/sync.js';
import { setCurrentMessageIndex } from '../messages/dom-sync.js';  // ✅ Bug 2 修复：导入索引设置函数
import { renderHumanizedError } from '../utils/errors.js';
import { renderFinalTextWithThinking, renderFinalContentWithThinking } from '../stream/helpers.js';
import { parseApiResponse } from './response-parser.js';
import { renderReplyWithSelector } from '../messages/renderer.js';
import { handleMultiStreamResponses } from '../stream/multi-stream.js';

/**
 * 获取当前端点（从提供商获取）
 * @returns {string} API 端点
 */
export function getCurrentEndpoint() {
    const provider = getCurrentProvider();

    console.log(`[getCurrentEndpoint] 获取到的提供商:`, {
        id: provider?.id,
        name: provider?.name,
        apiFormat: provider?.apiFormat,
        endpoint: provider?.endpoint,
        currentApiFormat: state.apiFormat
    });

    if (provider && provider.endpoint) {
        console.log(`[getCurrentEndpoint] 返回提供商端点: ${provider.endpoint}`);
        return provider.endpoint;
    }

    // 如果没有提供商或端点，返回默认端点
    const format = state.apiFormat;
    const defaultEndpoints = {
        openai: 'https://api.openai.com/v1/chat/completions',
        'openai-responses': 'https://api.openai.com/v1/responses',
        gemini: 'https://generativelanguage.googleapis.com',
        claude: 'https://api.anthropic.com/v1/messages',
    };

    const endpoint = defaultEndpoints[format] || '';
    console.log(`[getCurrentEndpoint] 使用默认端点 (${format}): ${endpoint}`);
    return endpoint;
}

/**
 * 获取当前 API 密钥（从提供商获取）
 * @returns {string} API 密钥
 */
export function getCurrentApiKey() {
    const provider = getCurrentProvider();
    return provider?.apiKey || '';
}

/**
 * 获取当前模型（三级fallback）
 * @returns {string} 模型名称
 */
export function getCurrentModel() {
    // 优先返回下拉列表选中的模型
    if (elements.modelSelect?.value) {
        return elements.modelSelect.value;
    }

    // 如果下拉列表为空，尝试从当前提供商的第一个模型获取
    const currentProvider = getCurrentProvider();
    if (currentProvider?.models && currentProvider.models.length > 0) {
        return currentProvider.models[0];
    }

    // 最后返回空字符串
    return '';
}

/**
 * 创建助手消息占位符
 * @returns {HTMLElement} 消息元素
 */
function createAssistantMessagePlaceholder() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'G';

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.setAttribute('role', 'toolbar');
    actionsDiv.setAttribute('aria-label', '消息操作');

    // 重试按钮
    const retryButton = document.createElement('button');
    retryButton.className = 'msg-action-btn retry-msg';
    retryButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 4v6h6"/>
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    </svg>`;
    retryButton.title = '重新生成';
    retryButton.setAttribute('aria-label', '重新生成回复');
    retryButton.onclick = () => eventBus.emit('message:retry-requested', { messageEl: messageDiv });
    actionsDiv.appendChild(retryButton);

    // 编辑按钮
    const editButton = document.createElement('button');
    editButton.className = 'msg-action-btn edit-msg';
    editButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`;
    editButton.title = '编辑';
    editButton.setAttribute('aria-label', '编辑消息');
    editButton.onclick = () => eventBus.emit('message:edit-requested', { messageEl: messageDiv });
    actionsDiv.appendChild(editButton);

    // 引用按钮
    const quoteButton = document.createElement('button');
    quoteButton.className = 'msg-action-btn quote-msg';
    quoteButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
    </svg>`;
    quoteButton.title = '引用';
    quoteButton.setAttribute('aria-label', '引用消息');
    quoteButton.onclick = () => eventBus.emit('message:quote-requested', { messageEl: messageDiv, role: 'assistant', content: '' });
    actionsDiv.appendChild(quoteButton);

    // 删除按钮
    const deleteButton = document.createElement('button');
    deleteButton.className = 'msg-action-btn delete-msg';
    deleteButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>`;
    deleteButton.title = '删除';
    deleteButton.setAttribute('aria-label', '删除消息');
    deleteButton.onclick = () => eventBus.emit('message:delete-requested', { messageEl: messageDiv });
    actionsDiv.appendChild(deleteButton);

    contentWrapper.appendChild(actionsDiv);

    messageDiv.appendChild(avatar);
    contentWrapper.appendChild(contentDiv);
    messageDiv.appendChild(contentWrapper);

    return messageDiv;
}

/**
 * 处理流式响应
 * @param {Response} response - Fetch Response
 * @param {AbortController} abortController - 取消控制器
 * @param {string} sessionId - 请求发起时的会话ID
 */
async function handleStreamResponse(response, abortController, sessionId) {
    const reader = response.body.getReader();

    try {
        // ✅ 使用提供商的原始 apiFormat 选择解析器（响应格式由提供商格式决定）
        const provider = getCurrentProvider();
        const responseFormat = provider?.apiFormat || 'openai';

        switch (responseFormat) {
            case 'claude':
                await parseClaudeStream(reader, sessionId);
                break;
            case 'gemini':
                await parseGeminiStream(reader, sessionId);
                break;
            case 'openai':
            case 'openai-responses':
            default:
                await parseOpenAIStream(reader, responseFormat, sessionId);
                break;
        }
    } catch (error) {
        // 检查是否是取消错误
        if (error.name === 'AbortError') {
            console.log('请求已被用户取消');
            throw error; // 重新抛出，让外层处理
        }
        throw error;
    }
}

/**
 * 处理非流式响应（支持多回复）
 * @param {Response} response - Fetch Response
 * @param {HTMLElement} assistantMessageEl - 助手消息元素
 * @param {string} sessionId - 请求发起时的会话ID
 */
async function handleNonStreamResponse(response, assistantMessageEl, sessionId) {
    const replyCount = state.replyCount || 1;
    let allReplies = [];
    let requestErrors = []; // 收集错误信息

    // 如果是多回复模式，显示进度提示
    if (replyCount > 1) {
        if (state.currentAssistantMessage) {
            state.currentAssistantMessage.innerHTML = `<div class="multi-reply-progress">正在生成 ${replyCount} 个回复中...</div>`;
        }
    }

    // ✅ 获取提供商的原始格式（用于解析响应）
    const provider = getCurrentProvider();
    const responseFormat = provider?.apiFormat || 'openai';

    try {
        // 处理第一个响应
        const data = await response.json();
        console.log('API Response 1:', data);

        // 检查第一个响应是否是错误
        if (data.error) {
            const err = data.error;
            requestErrors.push({
                index: 1,
                error: err
            });
            // 为失败的请求创建错误回复对象
            allReplies.push({
                content: '',
                isError: true,
                errorType: err.type || err.code || 'request_error',
                errorMessage: err.message || 'Unknown error'
            });
        } else {
            const reply = parseApiResponse(data, responseFormat);
            if (reply) {
                // ⭐ 检测工具调用
                if (reply.hasToolCalls && reply.toolCalls) {
                    console.log('[NonStream] 检测到工具调用:', reply.toolCalls);

                    // 保存助手消息（包含工具调用）
                    const messageIndex = saveAssistantMessage({
                        textContent: reply.content || '(调用工具)',
                        toolCalls: reply.toolCalls,
                        streamStats: getCurrentStreamStatsData(),
                        sessionId: sessionId
                    });

                    setCurrentMessageIndex(messageIndex);

                    // 执行工具调用
                    const { handleToolCallStream } = await import('../stream/tool-call-handler.js');
                    await handleToolCallStream(reply.toolCalls, {
                        endpoint: getCurrentEndpoint(),
                        apiKey: getCurrentApiKey(),
                        model: getCurrentModel()
                    });

                    return; // 退出非流式处理
                }

                allReplies.push(reply);
            }
        }

        // 如果需要多个回复，并行发送额外的请求
        if (replyCount > 1) {
            const endpoint = getCurrentEndpoint();
            const apiKey = getCurrentApiKey();
            const model = getCurrentModel();

            // ✅ 使用提供商的原始 apiFormat
            const sendFn = getSendFunction(responseFormat);

            const promises = [];
            for (let i = 1; i < replyCount; i++) {
                promises.push(
                    sendFn(endpoint, apiKey, model, state.currentAbortController?.signal)
                        .then(res => res.json())
                        .catch(err => {
                            console.error(`Request ${i + 1} failed:`, err);
                            // 保留完整的错误对象
                            return {
                                error: {
                                    message: err.message || String(err),
                                    type: err.type || err.name || 'network_error',
                                    code: err.code,
                                    fullError: err  // 完整错误对象
                                }
                            };
                        })
                );
            }

            const results = await Promise.allSettled(promises);
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === 'fulfilled' && result.value) {
                    // 检查响应是否包含错误
                    if (result.value.error) {
                        const err = result.value.error;
                        requestErrors.push({
                            index: i + 2,
                            error: err
                        });
                        // 为失败的请求创建错误回复对象
                        allReplies.push({
                            content: '',
                            isError: true,
                            errorType: err.type || err.code || 'request_error',
                            errorMessage: err.message || 'Unknown error'
                        });
                    } else {
                        const reply = parseApiResponse(result.value, responseFormat);
                        if (reply) {
                            allReplies.push(reply);
                        }
                    }
                } else if (result.status === 'rejected') {
                    const errorMsg = result.reason?.message || String(result.reason);
                    // 保留完整的错误对象
                    const fullError = {
                        message: errorMsg,
                        type: result.reason?.type || result.reason?.name || 'network_error',
                        code: result.reason?.code,
                        fullError: result.reason  // 完整错误对象
                    };
                    requestErrors.push({
                        index: i + 2,
                        error: fullError
                    });
                    // 为失败的请求创建错误回复对象
                    allReplies.push({
                        content: '',
                        isError: true,
                        errorType: fullError.type,
                        errorMessage: errorMsg
                    });
                }
            }
        }

        // 渲染和保存
        if (allReplies.length > 0) {
            state.currentReplies = allReplies;
            state.selectedReplyIndex = 0;

            // 完成统计（非流式模式只有总时间）
            finalizeStreamStats();

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
                contentParts: reply0.contentParts, // ✅ 保存 contentParts（用于图片渲染）
                sessionId: sessionId, // 🔒 传递会话ID防止串消息
            });

            // ✅ Bug 2 修复：立即设置 dataset.messageIndex
            setCurrentMessageIndex(messageIndex);

            // 渲染回复
            if (allReplies.length > 1) {
                renderReplyWithSelector(allReplies, 0, assistantMessageEl);
            } else {
                // 单回复模式：检查是否是错误回复
                if (reply0.isError) {
                    const errorObj = {
                        error: {
                            type: reply0.errorType,
                            message: reply0.errorMessage
                        }
                    };
                    const errorHtml = renderHumanizedError(errorObj, null, true);
                    if (state.currentAssistantMessage) {
                        state.currentAssistantMessage.innerHTML = errorHtml;
                    }
                } else {
                    // ✅ 如果有 contentParts（包含图片），使用 renderFinalContentWithThinking
                    if (reply0.contentParts && reply0.contentParts.length > 0) {
                        renderFinalContentWithThinking(reply0.contentParts, reply0.thinkingContent, reply0.groundingMetadata);
                    } else {
                        renderFinalTextWithThinking(reply0.content || '', reply0.thinkingContent, reply0.groundingMetadata);
                    }
                }
            }

            // 添加统计信息
            appendStreamStats();
        } else {
            // 所有请求都失败了，抛出包含详细错误信息的异常
            if (requestErrors.length > 0) {
                const firstError = requestErrors[0].error;
                const errorObj = {
                    error: {
                        type: firstError.type || 'request_failed',
                        message: firstError.message || 'All requests failed'
                    }
                };

                // 如果有多个错误，添加详情（保留完整错误对象）
                if (requestErrors.length > 1) {
                    errorObj.error.allErrors = requestErrors.map(e => ({
                        request: e.index,
                        message: e.error.message || String(e.error),
                        type: e.error.type,
                        code: e.error.code,
                        fullError: e.error.fullError || e.error  // 完整错误对象
                    }));
                }

                throw errorObj;
            } else {
                throw new Error('No valid replies received');
            }
        }

    } catch (error) {
        console.error('Non-stream response parsing error:', error);
        throw error;
    }
}


/**
 * 发送到 API
 */
async function sendToAPI() {
    state.isLoading = true;
    elements.sendButton.disabled = true;

    // ✅ 显示取消按钮，隐藏发送按钮
    if (elements.cancelRequestButton) {
        elements.cancelRequestButton.style.display = 'inline-flex';
    }
    if (elements.sendButton) {
        elements.sendButton.style.display = 'none';
    }

    const endpoint = getCurrentEndpoint();
    const apiKey = getCurrentApiKey();
    const model = getCurrentModel();

    // ✅ 添加关键日志
    console.log('[sendToAPI] 请求参数:', {
        endpoint: endpoint,
        model: model,
        apiFormat: state.apiFormat,
        currentProviderId: state.currentProviderId,
        selectedModel: state.selectedModel,
        hasApiKey: !!apiKey
    });

    // ✅ 创建 AbortController 用于取消请求
    const abortController = new AbortController();
    state.currentAbortController = abortController;

    // ✅ 记录当前会话 ID（用于后台生成）
    const sessionId = state.currentSessionId;

    // ✅ 设置请求超时
    const timeoutId = setTimeout(() => {
        abortController.abort();
        console.warn(`请求超时（${state.requestTimeout}ms），已自动取消`);
    }, state.requestTimeout);

    // 移除欢迎消息（如果存在）
    const welcomeMessage = elements.messagesArea.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    // 创建助手消息占位符（或复用现有的工具调用continuation）
    let assistantMessageEl;
    let isContinuationMode = false;  // ✅ 保存 continuation 状态用于后续判断
    if (state.isToolCallContinuation && state.toolCallContinuationElement) {
        // ✅ 工具调用后的continuation - 复用保存的消息元素
        isContinuationMode = true;
        assistantMessageEl = state.toolCallContinuationElement;
        state.currentAssistantMessage = assistantMessageEl.querySelector('.message-content');
        console.log('[Handler] 复用工具调用后的消息元素');

        // 在现有内容后添加加载提示（不删除工具调用UI）
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'thinking-dots continuation-loading';
        loadingIndicator.innerHTML = '<span></span><span></span><span></span>';
        state.currentAssistantMessage.appendChild(loadingIndicator);

        // ✅ 添加持久标记：标识这是 continuation 模式
        // 这个标记不会被流式渲染移除，用于 finalRender 检测
        state.currentAssistantMessage.dataset.isContinuation = 'true';

        // ✅ 设置 state 标志用于 saveAssistantMessage 检测
        state.isSavingContinuation = true;

        // 重置continuation标志和引用
        state.isToolCallContinuation = false;
        state.toolCallContinuationElement = null;
    } else {
        // 创建新的消息元素
        assistantMessageEl = createAssistantMessagePlaceholder();
        elements.messagesArea.appendChild(assistantMessageEl);
        state.currentAssistantMessage = assistantMessageEl.querySelector('.message-content');
    }

    // ✅ 初始化流统计（continuation 模式下不重置，让统计继续累积）
    if (!isContinuationMode) {
        resetStreamStats();
    } else {
        console.log('[Handler] Continuation 模式，保留原有统计数据');
    }

    try {
        // ✅ 流式多回复模式
        if (state.streamEnabled && state.replyCount > 1) {
            clearTimeout(timeoutId); // 清除单请求超时
            await handleMultiStreamResponses(endpoint, apiKey, model, abortController, assistantMessageEl, sessionId);
            return;
        }

        // 单回复模式（流式或非流式）
        // ✅ 使用提供商的原始 apiFormat，而不是切换后的格式
        const provider = getCurrentProvider();
        const requestFormat = provider?.apiFormat || 'openai';
        console.log('🔧 [sendToAPI] 使用提供商原始格式:', requestFormat, '(provider:', provider?.name, ')');

        const sendFn = getSendFunction(requestFormat);
        const response = await sendFn(endpoint, apiKey, model, abortController.signal);

        // ✅ 清除超时定时器（请求成功）
        clearTimeout(timeoutId);

        if (!response.ok) {
            // 处理错误响应
            try {
                const errorData = await response.json();
                state.currentAssistantMessage.innerHTML = renderHumanizedError(errorData, response.status);
                const messageIndex = saveErrorMessage(errorData, response.status, renderHumanizedError);
                // ✅ Bug 2 修复：立即设置 dataset.messageIndex
                setCurrentMessageIndex(messageIndex);
            } catch (e) {
                const errorData = { error: { message: `HTTP ${response.status}` } };
                state.currentAssistantMessage.innerHTML = renderHumanizedError(errorData, response.status);
                const messageIndex = saveErrorMessage(errorData, response.status, renderHumanizedError);
                // ✅ Bug 2 修复：立即设置 dataset.messageIndex
                setCurrentMessageIndex(messageIndex);
            }
            return;
        }

        // 处理流式响应或非流式响应
        if (state.streamEnabled) {
            await handleStreamResponse(response, abortController, sessionId);
        } else {
            await handleNonStreamResponse(response, assistantMessageEl, sessionId);
        }

    } catch (error) {
        // ✅ 清除超时定时器（发生错误）
        clearTimeout(timeoutId);

        console.error('Error:', error);

        // ✅ 检查是否是取消错误
        if (error.name === 'AbortError') {
            if (state.currentAssistantMessage) {
                state.currentAssistantMessage.innerHTML = '<div class="error-message">[!] 请求已取消</div>';
            }
            eventBus.emit('ui:notification', { message: '请求已取消', type: 'info' });
        } else {
            if (state.currentAssistantMessage) {
                state.currentAssistantMessage.innerHTML = renderHumanizedError(error);
                const messageIndex = saveErrorMessage(error, null, renderHumanizedError);
                // ✅ Bug 2 修复：立即设置 dataset.messageIndex
                setCurrentMessageIndex(messageIndex);
            }
        }
    } finally {
        // ✅ 从后台任务中移除（如果存在）
        if (sessionId && state.backgroundTasks.has(sessionId)) {
            state.backgroundTasks.delete(sessionId);
            eventBus.emit('sessions:updated', { sessions: state.sessions });
        }

        // ✅ 只有当前会话还是这个会话时，才重置状态
        // ⚠️ 但如果有工具调用进行中，跳过重置（等待 continuation 完成）
        if (state.currentSessionId === sessionId && !state.isToolCallPending) {
            state.isLoading = false;
            state.isSending = false;
            elements.sendButton.disabled = false;
            state.currentAssistantMessage = null;
            state.currentAbortController = null;

            // ✅ 恢复按钮状态：隐藏取消按钮，显示发送按钮
            if (elements.cancelRequestButton) {
                elements.cancelRequestButton.style.display = 'none';
            }
            if (elements.sendButton) {
                elements.sendButton.style.display = 'inline-flex';
            }
        } else if (state.isToolCallPending) {
            console.log('[Handler] 工具调用进行中，保持 loading 状态');
        } else {
            // ✅ 如果是后台会话完成，也要清理可能遗留的发送锁
            console.log(`[handler.js] 后台会话 ${sessionId} 的请求已完成（当前会话: ${state.currentSessionId}）`);

            // 如果发送锁还在，说明可能是切换会话后遗留的，安全释放
            if (state.isSending) {
                console.log('[handler.js] 检测到遗留的 isSending 锁，强制释放');
                state.isSending = false;
                if (state.sendLockTimeout) {
                    clearTimeout(state.sendLockTimeout);
                    state.sendLockTimeout = null;
                }
            }
        }
    }
}

/**
 * 取消当前请求
 */
export function cancelCurrentRequest() {
    if (state.currentAbortController) {
        state.currentAbortController.abort();
        console.log('已取消当前请求');
        return true;
    }
    console.warn('没有正在进行的请求可以取消');
    return false;
}

/**
 * ⭐ 发送包含工具结果的请求（工具调用第二轮）
 * @param {Array} toolResultMessages - 工具结果消息
 * @param {Object} apiConfig - API 配置
 * @param {HTMLElement} assistantMessageEl - 要复用的助手消息元素
 */
export async function resendWithToolResults(toolResultMessages, apiConfig, assistantMessageEl = null) {
    console.log('[Handler] 🔄 发送工具结果消息...');

    // ✅ 保存当前会话 ID
    const sessionId = state.currentSessionId;

    // ✅ 修复：不过滤错误消息，保持索引一致性
    // 合并原有消息和工具结果
    const newMessages = [
        ...state.messages,  // 不过滤，保持索引一致
        ...toolResultMessages
    ];

    // ✅ 记录原消息数组的引用
    const originalMessages = state.messages;

    // 临时覆盖 state.messages（仅用于此次请求）
    state.messages = newMessages;

    // ✅ 标记这是工具调用的continuation，复用现有消息元素
    state.isToolCallContinuation = true;
    state.toolCallContinuationElement = assistantMessageEl;

    try {
        // 发送请求
        await sendToAPI();

        console.log('[Handler] ✅ Continuation 请求完成');
    } finally {
        // ✅ 修复：将 continuation 的更新同步回原消息数组
        // saveAssistantMessage 在 continuation 模式下会更新 newMessages 中的消息
        // 由于浅拷贝，原数组中的对象也会被更新
        // 但我们需要确保原数组引用被恢复
        state.messages = originalMessages;

        // ✅ 清除工具调用标志
        state.isToolCallPending = false;

        // ✅ 修复：重置按钮状态（因为 sendToAPI 的 finally 跳过了重置）
        if (state.currentSessionId === sessionId) {
            state.isLoading = false;
            state.isSending = false;
            elements.sendButton.disabled = false;
            state.currentAssistantMessage = null;
            state.currentAbortController = null;

            // 恢复按钮显示
            if (elements.cancelRequestButton) {
                elements.cancelRequestButton.style.display = 'none';
            }
            if (elements.sendButton) {
                elements.sendButton.style.display = 'inline-flex';
            }

            console.log('[Handler] ✅ Continuation 完成，按钮状态已重置');
        }
    }
}

/**
 * 初始化 API 处理器
 */
export function initAPIHandler() {
    // 监听发送请求事件
    eventBus.on('api:send-requested', () => {
        sendToAPI();
    });

    // 监听重新发送请求事件（retry功能）
    eventBus.on('api:resend-requested', () => {
        sendToAPI();
    });

    // ✅ 监听取消请求事件
    eventBus.on('api:cancel-requested', () => {
        cancelCurrentRequest();
    });

    console.log('API handler initialized');
}
