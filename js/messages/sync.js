/**
 * 消息同步模块
 * 负责在 OpenAI、Gemini、Claude 三种格式之间同步消息
 * 关键：通过 EventBus 通知会话保存，避免循环依赖
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { toOpenAIMessage, toGeminiMessage, toClaudeMessage } from './converters.js';
import { generateMessageId } from '../utils/helpers.js';
import { pushMessage, rebuildMessageIdMap } from '../core/state-mutations.js';
import { getCurrentProvider, getModelDisplayName } from '../providers/manager.js';

/**
 * 简单的字符串 hash 函数（用于图片去重）
 * @param {string} str - 输入字符串
 * @returns {string} hash 值
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}

/**
 * 同步添加消息到所有三种格式
 * @param {string} role - 角色
 * @param {string} content - 内容
 * @param {Array<string>} images - 图片数组
 * @returns {number} 消息索引
 */
export function syncPushMessage(role, content, images = null) {
    state.messages.push(toOpenAIMessage(role, content, images));
    state.geminiContents.push(toGeminiMessage(role, content, images));
    state.claudeContents.push(toClaudeMessage(role, content, images));

    // 发出事件通知消息已添加
    eventBus.emit('messages:changed', {
        action: 'user_added',
        index: state.messages.length - 1
    });

    return state.messages.length - 1; // 返回索引
}

/**
 * 统一的助手消息保存函数
 * 无论什么模式（流式/非流式、单回复/多回复）都通过这个函数保存
 * @param {Object} options - 消息选项
 * @param {string} options.sessionId - 可选：请求发起时的会话ID，用于防止消息串到其他会话
 * @param {boolean} options.isContinuation - 可选：是否是工具调用的 continuation
 */
export function saveAssistantMessage(options) {
    const {
        textContent = '',
        thinkingContent = null,
        thinkingSignature = null,  // Claude thinking block 签名
        thoughtSignature = null,
        groundingMetadata = null,
        streamStats = null,
        allReplies = null,
        selectedReplyIndex = 0,
        contentParts = [],
        geminiParts = null,  // 用于 Gemini 流式处理，保留原始 parts
        sessionId = null,    // 🔒 请求发起时的会话ID
        isContinuation = false,  // 是否是工具调用的 continuation
        toolCalls = null,  // 工具调用信息（用于会话恢复时重建工具UI）
        encryptedContent = null,  // OpenAI Responses API 的 encrypted_content 签名
    } = options;

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 🏷️ 记录当前使用的模型和提供商信息
    const provider = getCurrentProvider();
    const modelId = state.selectedModel || '';
    const modelName = getModelDisplayName(modelId, provider); // 使用友好显示名称而不是模型 ID
    const providerName = provider?.name || 'Unknown';

    // 图片去重：移除重复的图片URL（修复code execution重复图片问题）
    // 在构建消息之前进行去重，确保所有格式的消息都不包含重复图片
    const seenImageUrls = new Set();
    const deduplicatedContentParts = contentParts.filter(p => {
        if (p.type === 'image_url' && p.url) {
            // 使用完整 URL 的 hash 作为去重依据
            const urlKey = simpleHash(p.url);
            if (seenImageUrls.has(urlKey)) {
                console.log('[saveAssistantMessage] 检测到重复图片，已去重');
                return false; // 过滤掉重复图片
            }
            seenImageUrls.add(urlKey);
        }
        return true;
    });

    // 使用去重后的contentParts替换原始的
    const finalContentParts = deduplicatedContentParts;

    // 检测是否有图片
    const hasImages = finalContentParts.some(p => p.type === 'image_url' && p.complete);

    // 1. 构建 OpenAI 格式（使用去重后的contentParts）
    const openaiMsg = buildOpenAIAssistantMessage({
        messageId, textContent, contentParts: finalContentParts, hasImages, thinkingContent, thinkingSignature,
        thoughtSignature, streamStats, allReplies, selectedReplyIndex, modelName, providerName,
        toolCalls,  // 传递工具调用信息
        encryptedContent
    });

    // 2. 构建 Gemini 格式（使用去重后的contentParts）
    const geminiMsg = buildGeminiAssistantMessage({
        messageId, textContent, contentParts: finalContentParts, hasImages, thoughtSignature,
        streamStats, allReplies, selectedReplyIndex, geminiParts, modelName, providerName,
        toolCalls,
        encryptedContent
    });

    // 3. 构建 Claude 格式（使用去重后的contentParts）
    const claudeMsg = buildClaudeAssistantMessage({
        messageId, textContent, contentParts: finalContentParts, hasImages, thinkingContent, thinkingSignature,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName,
        toolCalls,
        encryptedContent
    });

    // 🔒 检查会话是否已切换（防止消息串到其他会话）
    if (sessionId && sessionId !== state.currentSessionId) {
        console.warn(`⚠️ 检测到会话已切换（${sessionId} → ${state.currentSessionId}），将消息保存到原会话`);

        // 找到原会话并保存到后台
        const targetSession = state.sessions.find(s => s.id === sessionId);
        if (targetSession) {
            targetSession.messages.push(openaiMsg);
            targetSession.geminiContents.push(geminiMsg);
            targetSession.claudeContents.push(claudeMsg);
            targetSession.updatedAt = Date.now();

            // 保存到数据库
            import('../state/storage.js').then(({ saveSessionToDB }) => {
                saveSessionToDB(targetSession).catch(e => {
                    console.error('保存后台会话失败:', e);
                });
            });

            console.log(`消息已保存到后台会话: ${targetSession.name}`);
            eventBus.emit('ui:notification', {
                message: `消息已保存到会话"${targetSession.name}"`,
                type: 'info'
            });
        } else {
            console.error(`❌ 未找到会话 ${sessionId}，消息丢失！`);
        }
        return; // 不保存到当前会话
    }

    // Continuation 模式：更新上一条助手消息而不是创建新的
    // 可以通过参数传入，或者检查 state.isSavingContinuation 标志
    const shouldMerge = isContinuation || state.isSavingContinuation;

    // 清除标志（使用后立即清除）
    if (state.isSavingContinuation) {
        state.isSavingContinuation = false;
    }

    if (shouldMerge) {
        // Continuation 模式：优先使用 DOM 的 messageIndex，避免 tool_calls helper 消息截胡更新目标
        let lastAssistantIndex = -1;

        const domMessageEl = state.currentAssistantMessage?.closest?.('.message');
        const domIndexStr = domMessageEl?.dataset?.messageIndex;
        if (domIndexStr !== undefined) {
            const domIdx = parseInt(domIndexStr, 10);
            if (!Number.isNaN(domIdx) &&
                domIdx >= 0 &&
                domIdx < state.messages.length &&
                state.messages[domIdx]?.role === 'assistant') {
                lastAssistantIndex = domIdx;
            }
        }

        // Fallback：从后向前找最后一条“真实”assistant 消息（跳过仅用于 API continuation 的 tool_calls 占位消息）
        if (lastAssistantIndex < 0) {
            for (let i = state.messages.length - 1; i >= 0; i--) {
                const msg = state.messages[i];
                if (!msg || msg.role !== 'assistant') continue;

                const hasContentParts = Array.isArray(msg.contentParts) && msg.contentParts.length > 0;
                const hasThinking = !!msg.thinkingContent || !!msg.thinkingSignature || !!msg.thoughtSignature;
                const hasStreamStats = !!msg.streamStats;
                const hasReplies = Array.isArray(msg.allReplies) && msg.allReplies.length > 0;

                const hasTextContent = typeof msg.content === 'string'
                    ? msg.content.trim().length > 0
                    : Array.isArray(msg.content)
                        ? msg.content.some(p => p?.type === 'text' && (p.text || '').trim().length > 0)
                        : false;

                const isToolCallsOnly = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 &&
                    !hasTextContent && !hasContentParts && !hasThinking && !hasStreamStats && !hasReplies;

                if (isToolCallsOnly) continue;

                lastAssistantIndex = i;
                break;
            }
        }

        if (lastAssistantIndex >= 0) {
            console.log(`[saveAssistantMessage] Continuation 模式：更新消息 #${lastAssistantIndex}`);

            const prevOpenai = state.messages[lastAssistantIndex];
            const prevGemini = state.geminiContents[lastAssistantIndex];
            const prevClaude = state.claudeContents[lastAssistantIndex];

            // 合并 thinkingContent
            const mergedThinking = [prevOpenai.thinkingContent, thinkingContent]
                .filter(Boolean)
                .join('\n\n---\n\n');

            // 合并签名（不同格式使用不同策略）
            let mergedThoughtSignature = prevOpenai.thoughtSignature;
            let mergedThinkingSignature = prevOpenai.thinkingSignature;
            let mergedEncryptedContent = prevOpenai.encryptedContent;

            // Gemini: 使用最新的 thoughtSignature（API要求）
            if (thoughtSignature) {
                mergedThoughtSignature = thoughtSignature;
                console.log('[Sync] 更新 thoughtSignature (Gemini)');
            }

            // Claude: 合并多个 thinkingSignature
            if (thinkingSignature) {
                if (prevOpenai.thinkingSignature) {
                    // 如果之前已有签名，合并它们
                    mergedThinkingSignature = [prevOpenai.thinkingSignature, thinkingSignature]
                        .join('\n\n---\n\n');
                    console.log('[Sync] 合并 thinkingSignature (Claude)');
                } else {
                    mergedThinkingSignature = thinkingSignature;
                }
            }

            // OpenAI: 使用最新的 encryptedContent
            if (encryptedContent) {
                mergedEncryptedContent = encryptedContent;
                console.log('[Sync] 更新 encryptedContent (OpenAI Responses)');
            }

            // 合并 textContent（原有的 + 新的）
            const prevText = typeof prevOpenai.content === 'string'
                ? prevOpenai.content
                : (prevOpenai.content?.find(p => p.type === 'text')?.text || '');
            const mergedText = prevText === '(调用工具)'
                ? textContent
                : [prevText, textContent].filter(Boolean).join('\n\n');

            // 合并 contentParts，正确处理占位符和空 contentParts
            const prevContentParts = prevOpenai.contentParts || [];

            // 检查原有内容是否包含占位符
            const hasPlaceholder = prevContentParts.some(p =>
                p.type === 'text' && p.text === '(调用工具)'
            );

            let mergedContentParts;

            // 关键检查新 contentParts 是否为空
            if (contentParts.length > 0) {
                if (hasPlaceholder) {
                    // 替换模式：过滤掉占位符，然后追加新内容
                    mergedContentParts = prevContentParts
                        .filter(p => !(p.type === 'text' && p.text === '(调用工具)'))
                        .concat(contentParts);
                } else {
                    // 追加模式：正常追加新内容
                    mergedContentParts = [...prevContentParts, ...contentParts];
                }
            } else {
                // 新 contentParts 为空时，保留原有内容（去掉占位符）
                // 但如果有 textContent，则用 textContent 创建新的 contentParts
                if (textContent && textContent !== '(调用工具)') {
                    mergedContentParts = prevContentParts
                        .filter(p => !(p.type === 'text' && p.text === '(调用工具)'));
                    // 添加新的文本内容
                    mergedContentParts.push({ type: 'text', text: textContent });
                } else {
                    // 保留原有的非占位符内容
                    mergedContentParts = prevContentParts.filter(p =>
                        !(p.type === 'text' && p.text === '(调用工具)')
                    );
                }
            }

            // 最终过滤：移除所有占位符，确保不会残留
            mergedContentParts = mergedContentParts.filter(p =>
                !(p.type === 'text' && p.text === '(调用工具)')
            );

            // 合并后去重：移除重复的图片URL
            const seenUrls = new Set();
            mergedContentParts = mergedContentParts.filter(p => {
                if (p.type === 'image_url' && p.url) {
                    // 使用完整 URL 的 hash 作为去重依据
                    const urlKey = simpleHash(p.url);
                    if (seenUrls.has(urlKey)) {
                        console.log('[saveAssistantMessage] Continuation合并：检测到重复图片，已去重');
                        return false;
                    }
                    seenUrls.add(urlKey);
                }
                return true;
            });

            console.log('[saveAssistantMessage] Continuation contentParts 合并:', {
                prevCount: prevContentParts.length,
                newCount: contentParts.length,
                mergedCount: mergedContentParts.length,
                hasPlaceholder,
                textContent: textContent?.substring(0, 50)
            });

            // 确保 content 和 contentParts 保持同步
            // 1. 先更新 contentParts
            if (mergedContentParts.length > 0) {
                prevOpenai.contentParts = mergedContentParts;
            } else if (mergedText && mergedText !== '(调用工具)') {
                // contentParts 为空但有有效文本，自动生成
                prevOpenai.contentParts = [{ type: 'text', text: mergedText }];
            }

            // 2. 从 contentParts 中提取最终的 textContent（确保同步）
            let finalTextContent = mergedText;
            if (!finalTextContent || finalTextContent === '(调用工具)') {
                // 如果 mergedText 无效，从 contentParts 中提取文本
                const textParts = (prevOpenai.contentParts || [])
                    .filter(p => p.type === 'text' && p.text && p.text !== '(调用工具)')
                    .map(p => p.text);
                if (textParts.length > 0) {
                    finalTextContent = textParts.join('\n\n');
                }
            }

            // 3. 更新 content
            if (finalTextContent && finalTextContent !== '(调用工具)') {
                prevOpenai.content = finalTextContent;
            }

            // 4. 更新 thinkingContent
            if (mergedThinking) {
                prevOpenai.thinkingContent = mergedThinking;
            }

            // 5. 更新合并后的签名
            if (mergedThoughtSignature !== undefined) {
                prevOpenai.thoughtSignature = mergedThoughtSignature;
            }
            if (mergedThinkingSignature !== undefined) {
                prevOpenai.thinkingSignature = mergedThinkingSignature;
            }
            if (mergedEncryptedContent !== undefined) {
                prevOpenai.encryptedContent = mergedEncryptedContent;
            }

            // 更新 Gemini 格式 - 从 contentParts 重建 parts
            // 使用 prevOpenai.contentParts（已经过滤和处理过）
            const finalContentParts = prevOpenai.contentParts || [];
            if (prevGemini) {
                if (finalContentParts.length > 0) {
                    // 从 contentParts 重建 parts（确保内容一致性）
                    const newParts = [];
                    finalContentParts.forEach(p => {
                        if (p.type === 'thinking') {
                            newParts.push({ text: p.text, thought: true });
                        } else if (p.type === 'text' && p.text && p.text !== '(调用工具)') {
                            newParts.push({ text: p.text });
                        } else if (p.type === 'image_url' && p.complete) {
                            const match = p.url?.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                newParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                            }
                        }
                    });
                    if (newParts.length > 0) {
                        prevGemini.parts = newParts;
                    } else if (finalTextContent && finalTextContent !== '(调用工具)') {
                        // newParts 为空（可能只有 thinking），使用 finalTextContent
                        prevGemini.parts = [{ text: finalTextContent }];
                    }
                    prevGemini.contentParts = finalContentParts;
                } else if (finalTextContent && finalTextContent !== '(调用工具)') {
                    // 回退：只有文本，没有 contentParts
                    prevGemini.parts = [{ text: finalTextContent }];
                }
            }

            // 更新 Claude 格式 - 从 contentParts 重建 content
            if (prevClaude) {
                if (finalContentParts.length > 0) {
                    // 从 contentParts 重建 content（确保内容一致性）
                    const newContent = [];
                    finalContentParts.forEach(p => {
                        if (p.type === 'text' && p.text && p.text !== '(调用工具)') {
                            newContent.push({ type: 'text', text: p.text });
                        } else if (p.type === 'image_url' && p.complete) {
                            const match = p.url?.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                newContent.push({
                                    type: 'image',
                                    source: { type: 'base64', media_type: match[1], data: match[2] }
                                });
                            }
                        }
                    });
                    if (newContent.length > 0) {
                        prevClaude.content = newContent;
                    } else if (finalTextContent && finalTextContent !== '(调用工具)') {
                        // newContent 为空，使用 finalTextContent
                        prevClaude.content = [{ type: 'text', text: finalTextContent }];
                    }
                    prevClaude.contentParts = finalContentParts;
                } else if (finalTextContent && finalTextContent !== '(调用工具)') {
                    // 回退：只有文本，没有 contentParts
                    prevClaude.content = [{ type: 'text', text: finalTextContent }];
                }
                if (mergedThinking) {
                    prevClaude.thinkingContent = mergedThinking;
                }
                // 更新合并后的签名
                if (mergedThinkingSignature !== undefined) {
                    prevClaude.thinkingSignature = mergedThinkingSignature;
                }
                if (mergedThoughtSignature !== undefined) {
                    prevClaude.thoughtSignature = mergedThoughtSignature;
                }
                if (mergedEncryptedContent !== undefined) {
                    prevClaude.encryptedContent = mergedEncryptedContent;
                }
            }

            // 处理 toolCalls - 如果有新的 toolCalls，更新它；否则保留旧的
            if (toolCalls && toolCalls.length > 0) {
                // 有新的工具调用，替换旧的
                prevOpenai.toolCalls = toolCalls;
                if (prevGemini) prevGemini.toolCalls = toolCalls;
                if (prevClaude) prevClaude.toolCalls = toolCalls;
            }
            // 如果 toolCalls 为 null/undefined，不做任何处理，保留原有的 toolCalls（如果有的话）

            // 更新 streamStats（优先使用最终统计，避免 continuation 时重复累加 token）
            if (streamStats) {
                const prevStats = prevOpenai.streamStats;
                let finalStats = streamStats;

                // 如果之前保存了部分统计：通常 continuation 不会重置 stats，此时 streamStats.tokens 已是累计值，直接覆盖即可
                if (prevStats && prevStats.isPartial) {
                    const prevTokens = parseInt(prevStats.tokens, 10) || 0;
                    const currentTokens = parseInt(streamStats.tokens, 10) || 0;

                    if (currentTokens < prevTokens) {
                        // 少见：如果 continuation 开始时重置了统计，则 tokens 是增量，需要进行聚合
                        const totalTokens = prevTokens + currentTokens;
                        const ttft = (prevStats.ttft && prevStats.ttft !== '-') ? prevStats.ttft : streamStats.ttft;

                        const totalTimeNum = parseFloat(streamStats.totalTime);
                        const ttftNum = parseFloat(ttft);
                        const genTime = (Number.isFinite(totalTimeNum) && Number.isFinite(ttftNum))
                            ? (totalTimeNum - ttftNum)
                            : NaN;

                        finalStats = {
                            ...streamStats,
                            ttft,
                            tokens: totalTokens,
                            tps: Number.isFinite(genTime) && genTime > 0
                                ? (totalTokens / genTime).toFixed(1)
                                : streamStats.tps
                        };
                    } else {
                        // 通常情况：统计未重置，streamStats 已包含全期间
                        finalStats = {
                            ...streamStats,
                            ttft: (streamStats.ttft && streamStats.ttft !== '-') ? streamStats.ttft : prevStats.ttft
                        };
                    }
                } else if (prevStats?.ttft && prevStats.ttft !== '-' && (!streamStats.ttft || streamStats.ttft === '-')) {
                    // 回退：保留之前的 TTFT
                    finalStats = { ...streamStats, ttft: prevStats.ttft };
                }

                // 移除 isPartial 标记（完整消息不再是部分统计）
                if (finalStats && finalStats.isPartial) {
                    delete finalStats.isPartial;
                }

                prevOpenai.streamStats = finalStats;
                if (prevGemini) prevGemini.streamStats = finalStats;
                if (prevClaude) prevClaude.streamStats = finalStats;
            }

            // 发出更新事件
            eventBus.emit('messages:changed', {
                action: 'assistant_updated',
                index: lastAssistantIndex
            });

            return lastAssistantIndex;
        }
    }

    // 使用安全的状态更新函数
    pushMessage(openaiMsg, geminiMsg, claudeMsg);

    const messageIndex = state.messages.length - 1;

    // 🏷️ 添加模型标签到最后一条助手消息的 DOM
    if (modelName || providerName) {
        // 等待下一个事件循环，确保 DOM 已经更新完成
        setTimeout(() => {
            const assistantMessages = document.querySelectorAll('.message.assistant');
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastAssistantMsg) {
                const contentWrapper = lastAssistantMsg.querySelector('.message-content-wrapper');
                if (contentWrapper) {
                    // 检查是否已经有模型标签（避免重复添加）
                    if (!contentWrapper.querySelector('.message-model-badge')) {
                        const modelBadge = document.createElement('div');
                        modelBadge.className = 'message-model-badge';
                        const badgeText = [modelName, providerName].filter(Boolean).join(' | ');
                        modelBadge.textContent = badgeText;
                        modelBadge.title = `模型: ${modelName || '未知'}\n提供商: ${providerName || '未知'}`;

                        // 插入到 contentWrapper 的最前面
                        contentWrapper.insertBefore(modelBadge, contentWrapper.firstChild);
                    }
                }
            }
        }, 0);
    }

    // 发出事件通知 UI 更新 DOM 索引
    eventBus.emit('messages:assistant-added', {
        index: messageIndex
    });

    // 发出事件通知会话保存（避免直接调用 saveCurrentSessionMessages）
    eventBus.emit('messages:changed', {
        action: 'assistant_added',
        index: messageIndex
    });

    return messageIndex;
}

/**
 * 保存助手消息到后台会话（会话已切换时使用）
 */
export function saveAssistantMessageToSession(session, options) {
    const {
        textContent = '',
        thinkingContent = null,
        thinkingSignature = null,  // Claude thinking block 签名
        thoughtSignature = null,
        groundingMetadata = null,
        streamStats = null,
        allReplies = null,
        selectedReplyIndex = 0,
        contentParts = [],
        geminiParts = null,
        toolCalls = null,  // 工具调用信息
    } = options;

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 🏷️ 记录当前使用的模型和提供商信息
    const provider = getCurrentProvider();
    const modelId = state.selectedModel || '';
    const modelName = getModelDisplayName(modelId, provider); // 使用友好显示名称而不是模型 ID
    const providerName = provider?.name || 'Unknown';

    const hasImages = contentParts?.some(p => p.type === 'image_url' && p.complete);

    // 构建并添加到会话
    const openaiMsg = buildOpenAIAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent, thinkingSignature,
        thoughtSignature, streamStats, allReplies, selectedReplyIndex, modelName, providerName,
        toolCalls  // 传递工具调用信息
    });
    session.messages.push(openaiMsg);

    const geminiMsg = buildGeminiAssistantMessage({
        messageId, textContent, contentParts, hasImages, thoughtSignature,
        streamStats, allReplies, selectedReplyIndex, geminiParts, modelName, providerName,
        toolCalls  // 传递工具调用信息
    });
    session.geminiContents.push(geminiMsg);

    const claudeMsg = buildClaudeAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent, thinkingSignature,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName,
        toolCalls  // 传递工具调用信息
    });
    session.claudeContents.push(claudeMsg);

    // 后台会话不需要保存到 IndexedDB，由 sessions.js 处理
}

/**
 * 保存错误消息
 */
export function saveErrorMessage(errorData, httpStatus = null, renderHumanizedError) {
    // 渲染错误 HTML（用于会话恢复时显示）
    const errorHtml = renderHumanizedError(errorData, httpStatus);

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 构建错误消息对象
    const openaiErrorMsg = {
        id: messageId,
        role: 'assistant',
        content: '',
        isError: true,
        errorData: errorData,
        errorHtml: errorHtml,
        httpStatus: httpStatus
    };

    const geminiErrorMsg = {
        id: messageId,
        role: 'model',
        parts: [{ text: '' }],
        isError: true
    };

    const claudeErrorMsg = {
        id: messageId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        isError: true,
        errorData: errorData,  // Bug 1 添加错误数据，支持降级渲染
        errorHtml: errorHtml,  // Bug 1 添加错误 HTML，用于会话恢复
        httpStatus: httpStatus // Bug 1 添加 HTTP 状态码
    };

    // 使用安全的状态更新函数
    pushMessage(openaiErrorMsg, geminiErrorMsg, claudeErrorMsg);

    // 计算消息索引（用于设置 DOM 元素的 dataset.messageIndex）
    const messageIndex = state.messages.length - 1;

    // 通知 UI 更新 DOM 索引
    eventBus.emit('messages:error-added', {
        index: messageIndex
    });

    // 保存到会话
    eventBus.emit('messages:changed', {
        action: 'error_added',
        index: messageIndex
    });

    // 返回消息索引（Bug 2 允许调用方设置 dataset.messageIndex）
    return messageIndex;
}

/**
 * 构建 OpenAI 格式的助手消息
 */
function buildOpenAIAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thinkingContent, thinkingSignature,
        thoughtSignature, streamStats, allReplies, selectedReplyIndex, modelName, providerName,
        toolCalls,
        encryptedContent
    } = opts;

    const msg = { role: 'assistant' };

    // 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 处理内容
    if (hasImages) {
        msg.content = [];
        if (textContent) {
            msg.content.push({ type: 'text', text: textContent });
        }
        contentParts.forEach(p => {
            if (p.type === 'image_url' && p.complete) {
                msg.content.push({ type: 'image_url', image_url: { url: p.url } });
            }
        });
    } else {
        msg.content = textContent;
    }

    // 添加元数据
    if (thinkingContent) msg.thinkingContent = thinkingContent;
    if (thinkingSignature) msg.thinkingSignature = thinkingSignature;  // Claude 签名
    if (thoughtSignature) msg.thoughtSignature = thoughtSignature;
    if (encryptedContent) msg.encryptedContent = encryptedContent;
    if (streamStats) msg.streamStats = streamStats;
    // 始终初始化 allReplies，即使是第一次生成
    if (allReplies && allReplies.length > 0) {
        msg.allReplies = allReplies;
        msg.selectedReplyIndex = selectedReplyIndex;
    } else {
        // 第一次生成时，创建包含当前消息的 allReplies 数组
        msg.allReplies = [{
            content: textContent,
            thinkingContent: thinkingContent,
            thoughtSignature: thoughtSignature,
            thinkingSignature: thinkingSignature,
            encryptedContent: encryptedContent,
            contentParts: contentParts,
            isOriginal: true,  // 标记为原始版本
            timestamp: Date.now()
        }];
        msg.selectedReplyIndex = 0;
    }

    // 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    // 保存工具调用信息（用于会话恢复时重建工具UI）
    if (toolCalls && toolCalls.length > 0) {
        msg.toolCalls = toolCalls;
    }

    return msg;
}

/**
 * 构建 Gemini 格式的助手消息
 */
function buildGeminiAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thoughtSignature,
        streamStats, geminiParts, modelName, providerName,
        toolCalls,
        encryptedContent,
        thinkingSignature  // 添加 Claude 签名支持
    } = opts;

    // 如果提供了原始 geminiParts，优先使用
    let parts;
    if (geminiParts && geminiParts.length > 0) {
        parts = geminiParts;
    } else {
        parts = [];

        // 优先使用 contentParts（保留正确的顺序，包括 thinking）
        if (contentParts && contentParts.length > 0) {
            contentParts.forEach(p => {
                if (p.type === 'thinking') {
                    // 思维链部分
                    parts.push({ text: p.text, thought: true });
                } else if (p.type === 'text') {
                    // 普通文本部分
                    parts.push({ text: p.text });
                } else if (p.type === 'image_url' && p.complete) {
                    // 图片部分
                    const match = p.url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                    }
                }
            });
        } else if (textContent) {
            // 回退：仅文本内容
            parts.push({ text: textContent });
        }
    }

    const msg = {
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: textContent || '' }],
    };

    // 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 添加元数据
    if (thoughtSignature) msg.thoughtSignature = thoughtSignature;
    if (thinkingSignature) msg.thinkingSignature = thinkingSignature;  // 添加 Claude 签名支持
    if (encryptedContent) msg.encryptedContent = encryptedContent;
    if (streamStats) msg.streamStats = streamStats;

    // 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    // 保存工具调用信息（用于会话恢复时重建工具UI）
    if (toolCalls && toolCalls.length > 0) {
        msg.toolCalls = toolCalls;
    }

    // 保存所有回复版本（支持多变体）- Gemini格式
    if (opts.allReplies && opts.allReplies.length > 0) {
        msg.allReplies = opts.allReplies;
        msg.selectedReplyIndex = opts.selectedReplyIndex;
    }

    return msg;
}

/**
 * 构建 Claude 格式的助手消息
 */
function buildClaudeAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thinkingContent, thinkingSignature,
        streamStats, modelName, providerName,
        toolCalls,
        encryptedContent,
        thoughtSignature  // 添加 Gemini 签名支持
    } = opts;

    let content;

    if (hasImages) {
        content = [];
        contentParts?.forEach(p => {
            if (p.type === 'image_url' && p.complete) {
                const match = p.url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    content.push({
                        type: 'image',
                        source: { type: 'base64', media_type: match[1], data: match[2] }
                    });
                }
            }
        });
        if (textContent) {
            content.push({ type: 'text', text: textContent });
        }
    } else {
        content = [{ type: 'text', text: textContent || '' }];
    }

    const msg = { role: 'assistant', content };

    // 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 添加元数据
    if (thinkingContent) msg.thinkingContent = thinkingContent;
    if (thinkingSignature) msg.thinkingSignature = thinkingSignature;
    if (thoughtSignature) msg.thoughtSignature = thoughtSignature;  // 添加 Gemini 签名支持
    if (encryptedContent) msg.encryptedContent = encryptedContent;
    if (streamStats) msg.streamStats = streamStats;

    // 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    // 保存工具调用信息（用于会话恢复时重建工具UI）
    if (toolCalls && toolCalls.length > 0) {
        msg.toolCalls = toolCalls;
    }

    // 保存所有回复版本（支持多变体）- Claude格式
    if (opts.allReplies && opts.allReplies.length > 0) {
        msg.allReplies = opts.allReplies;
        msg.selectedReplyIndex = opts.selectedReplyIndex;
    }

    return msg;
}

/**
 * 复制消息元数据
 * 完整复制所有元数据，避免格式转换时丢失
 */
export function copyMessageMetadata(source, target) {
    const metadataKeys = [
        'allReplies',         // 多回复数据
        'thinkingContent',    // 思维链内容
        'thinkingSignature',  // 思维链签名（Claude 专有）
        'selectedReplyIndex', // 选中的回复索引
        'groundingMetadata',  // 搜索引用（Gemini 专有）
        'streamStats',        // 流统计数据
        'thoughtSignature',   // 思维链签名（Gemini 专有）
        'encryptedContent',   // Responses API 签名
        'isError',            // 错误标记
        'errorData',          // 错误数据
        'errorHtml',          // 错误 HTML
        'id',                 // 消息唯一ID
        'modelName',          // 🏷️ 模型名称
        'providerName',       // 🏷️ 提供商名称
        'contentParts'        // 原始内容部分（用于会话恢复）
    ];
    metadataKeys.forEach(key => {
        if (source[key] !== undefined) {
            target[key] = source[key];
        }
    });
    return target;
}

/**
 * 从 OpenAI 格式转换到其他格式
 */
export function convertFromOpenAI() {
    state.geminiContents = [];
    state.claudeContents = [];

    state.messages.forEach(msg => {
        const content = extractTextContent(msg.content);
        const images = extractImages(msg.content);
        const geminiMsg = copyMessageMetadata(msg, toGeminiMessage(msg.role, content, images));
        const claudeMsg = copyMessageMetadata(msg, toClaudeMessage(msg.role, content, images));

        // ❌ 移除 P1 不在存储时删除签名，避免格式往返丢失
        // 改为在发送请求时过滤（见 api/gemini.js 和 api/claude.js）

        state.geminiContents.push(geminiMsg);
        state.claudeContents.push(claudeMsg);
    });
}

/**
 * 从 Gemini 格式转换到其他格式
 */
export function convertFromGemini() {
    state.messages = [];
    state.claudeContents = [];

    state.geminiContents.forEach(msg => {
        const role = msg.role === 'model' ? 'assistant' : 'user';
        const content = msg.parts?.filter(p => p.text).map(p => p.text).join('') || '';
        const images = msg.parts?.filter(p => p.inlineData).map(p =>
            `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
        ) || [];

        const openaiMsg = copyMessageMetadata(msg, toOpenAIMessage(role, content, images.length > 0 ? images : null));
        const claudeMsg = copyMessageMetadata(msg, toClaudeMessage(role, content, images.length > 0 ? images : null));

        // ❌ 移除 P1 保留所有签名，避免格式往返丢失

        state.messages.push(openaiMsg);
        state.claudeContents.push(claudeMsg);
    });
}

/**
 * 从 Claude 格式转换到其他格式
 */
export function convertFromClaude() {
    state.messages = [];
    state.geminiContents = [];

    state.claudeContents.forEach(msg => {
        let content = '';
        const images = [];

        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            msg.content.forEach(part => {
                if (part.type === 'text') {
                    content += part.text;
                } else if (part.type === 'image' && part.source?.type === 'base64') {
                    images.push(`data:${part.source.media_type};base64,${part.source.data}`);
                }
            });
        }

        const openaiMsg = copyMessageMetadata(msg, toOpenAIMessage(msg.role, content, images.length > 0 ? images : null));
        const geminiMsg = copyMessageMetadata(msg, toGeminiMessage(msg.role, content, images.length > 0 ? images : null));

        // ❌ 移除 P1 保留所有签名，避免格式往返丢失

        state.messages.push(openaiMsg);
        state.geminiContents.push(geminiMsg);
    });
}

/**
 * 同步所有格式（从当前格式转换）
 */
export function syncAllFormats() {
    switch (state.apiFormat) {
        case 'openai':
            convertFromOpenAI();
            break;
        case 'gemini':
            convertFromGemini();
            break;
        case 'claude':
            convertFromClaude();
            break;
    }

    // 转换后重建 messageIdMap（确保索引映射正确）
    rebuildMessageIdMap();
}

/**
 * 提取文本内容
 */
export function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter(p => p.type === 'text').map(p => p.text).join('');
    }
    return '';
}

/**
 * 提取图片 URL
 */
export function extractImages(content) {
    if (!Array.isArray(content)) return null;
    const images = content.filter(p => p.type === 'image_url').map(p => p.image_url?.url).filter(Boolean);
    return images.length > 0 ? images : null;
}

/**
 * 更新工具调用结果
 * 当工具执行完成时，将结果保存到消息历史中
 * @param {string} toolId - 工具调用ID
 * @param {string} status - 状态（completed/failed）
 * @param {Object} result - 执行结果或错误信息
 */
export function updateToolCallResult(toolId, status, result) {
    console.log('[Sync] 更新工具调用结果:', toolId, status);

    // 查找包含该工具调用的消息
    for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
            const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === toolId);
            if (toolCallIndex !== -1) {
                // 更新工具调用信息
                msg.toolCalls[toolCallIndex] = {
                    ...msg.toolCalls[toolCallIndex],
                    status: status,
                    result: status === 'completed' ? result : null,
                    error: status === 'failed' ? result : null,
                    completedAt: Date.now()
                };

                // 同步更新到其他格式
                if (state.geminiContents[i]) {
                    state.geminiContents[i].toolCalls = msg.toolCalls;
                }
                if (state.claudeContents[i]) {
                    state.claudeContents[i].toolCalls = msg.toolCalls;
                }

                console.log('[Sync] 工具调用结果已保存到消息 #' + i);

                // 保存到会话
                saveCurrentSessionMessages();
                break;
            }
        }
    }
}
