/**
 * 回复选择器模块
 * 处理多回复的选择和切换
 */

import { state, elements } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { saveCurrentSessionMessages } from '../state/sessions.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { renderThinkingBlock, enhanceCodeBlocks, renderContentParts } from './renderer.js';
import { renderHumanizedError } from '../utils/errors.js';

/**
 * 选择回复（支持两种调用方式：直接索引或带消息索引）
 * @param {number} replyIndex - 回复索引
 * @param {number|null} messageIndex - 消息索引
 */
export function selectReply(replyIndex, messageIndex = null) {
    let replies;
    let messageEl;

    // 如果提供了消息索引，从消息历史中获取回复
    // 注意：allReplies 统一存储在 state.messages 中，不在 geminiContents/claudeContents 中
    if (messageIndex !== null) {
        const msg = state.messages[messageIndex];
        if (!msg || !msg.allReplies) return;
        replies = msg.allReplies;
        messageEl = elements.messagesArea.querySelector(`.message[data-message-index="${messageIndex}"]`);

        // ✅ Bug 2 修复：防御性日志（而非复杂的 DOM 恢复）
        if (!messageEl) {
            console.error(`[Bug 2] 消息索引 ${messageIndex} 的 DOM 元素未找到`);
            console.error('[Bug 2] 这表明 dataset.messageIndex 未正确设置');

            // 使用 currentAssistantMessage 作为后备（流式输出时）
            if (state.currentAssistantMessage) {
                messageEl = state.currentAssistantMessage.closest('.message');
                console.warn('[Bug 2] 使用 state.currentAssistantMessage 作为后备');
            } else {
                return; // 无法恢复，直接返回
            }
        }
    } else {
        // 使用当前的回复状态（正在生成时）
        replies = state.currentReplies;
        if (state.currentAssistantMessage) {
            messageEl = state.currentAssistantMessage.closest('.message');
        }
    }

    if (!messageEl) return; // ✅ Bug 2 修复：添加最终检查
    if (!replies || replyIndex < 0 || replyIndex >= replies.length) return;

    const reply = replies[replyIndex];

    // 更新消息历史中的选中索引 - 同步所有三种格式
    if (messageIndex !== null) {
        const textContent = reply.content || (reply.parts?.find(p => p.text)?.text) || '';

        // 更新 OpenAI 格式
        if (state.messages[messageIndex]) {
            state.messages[messageIndex].selectedReplyIndex = replyIndex;
            state.messages[messageIndex].content = textContent;
            state.messages[messageIndex].thinkingContent = reply.thinkingContent || null;
        }

        // 更新 Gemini 格式
        if (state.geminiContents[messageIndex]) {
            state.geminiContents[messageIndex].selectedReplyIndex = replyIndex;
            if (reply.parts) {
                state.geminiContents[messageIndex].parts = reply.parts;
            } else {
                state.geminiContents[messageIndex].parts = [{ text: textContent }];
            }
            // 更新 thoughtSignature（每个回复可能有不同的签名）
            if (reply.thoughtSignature) {
                state.geminiContents[messageIndex].thoughtSignature = reply.thoughtSignature;
            } else {
                delete state.geminiContents[messageIndex].thoughtSignature;
            }
        }

        // 更新 Claude 格式
        if (state.claudeContents[messageIndex]) {
            state.claudeContents[messageIndex].selectedReplyIndex = replyIndex;
            state.claudeContents[messageIndex].content = reply.claudeContent || [{ type: 'text', text: textContent }];
        }

        saveCurrentSessionMessages();
    } else {
        state.selectedReplyIndex = replyIndex;
        updateMessageHistoryWithSelectedReply();
    }

    // 更新显示的内容
    if (messageEl) {
        const wrapper = messageEl.querySelector('.message-content-wrapper');
        const contentDiv = messageEl.querySelector('.message-content');

        if (wrapper && contentDiv) {
            // 更新选择器
            const selectorEl = wrapper.querySelector('.reply-selector');
            if (selectorEl) {
                selectorEl.querySelectorAll('.reply-tab').forEach((tab, i) => {
                    tab.classList.toggle('active', i === replyIndex);
                });
            }

            // 更新内容
            let html = '';

            // 检查是否是错误回复
            if (reply.isError) {
                const errorObj = {
                    error: {
                        type: reply.errorType || 'unknown',
                        message: reply.errorMessage || 'Unknown error'
                    }
                };
                html = renderHumanizedError(errorObj, null, true);
            } else {
                // 渲染思维链内容（如果有）
                if (reply.thinkingContent) {
                    html += renderThinkingBlock(reply.thinkingContent);
                }

                // ✅ 优先渲染 contentParts (包含图片)
                if (reply.contentParts && reply.contentParts.length > 0) {
                    html += renderContentParts(reply.contentParts);
                }
                // 渲染主要内容
                else if (state.apiFormat === 'gemini' && reply.parts) {
                for (const part of reply.parts) {
                    // 跳过思维部分（已在上面单独渲染）
                    if (part.thought) continue;

                    if (part.text) {
                        html += safeMarkedParse(part.text);
                    } else if (part.inlineData || part.inline_data) {
                        const inlineData = part.inlineData || part.inline_data;
                        const mimeType = inlineData.mimeType || inlineData.mime_type;
                        const imgData = inlineData.data;
                        const ext = mimeType.split('/')[1] || 'png';
                        const dataUrl = `data:${mimeType};base64,${imgData}`;
                        html += `<div class="image-wrapper">
                            <img src="${dataUrl}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${dataUrl}')" style="cursor:pointer;">
                            <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${dataUrl}', 'image-${Date.now()}.${ext}')" title="下载原图">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                </svg>
                            </button>
                        </div>`;
                    }
                }

                // 渲染搜索引用（如果有）
                if (reply.groundingMetadata) {
                    html += renderSearchGrounding(reply.groundingMetadata);
                }
                } else if (reply.content) {
                if (Array.isArray(reply.content)) {
                    for (const part of reply.content) {
                        if (part.type === 'text') {
                            html += safeMarkedParse(part.text);
                        } else if (part.type === 'image_url' && part.image_url?.url) {
                            const url = part.image_url.url;
                            const match = url.match(/^data:image\/(\w+);/);
                            const ext = match ? match[1] : 'png';
                            html += `<div class="image-wrapper">
                                <img src="${url}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${url}')" style="cursor:pointer;">
                                <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${url}', 'image-${Date.now()}.${ext}')" title="下载原图">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                    </svg>
                                </button>
                            </div>`;
                        }
                    }
                } else {
                    html += safeMarkedParse(reply.content);
                }
                }
            }
            contentDiv.innerHTML = html;

            // ✅ 不再需要手动绑定图片事件（已使用内联 onclick）

            // 增强代码块（绑定复制按钮、表格导出、思维链折叠等）
            enhanceCodeBlocks(messageEl);
        }
    }
}

// ✅ 已删除 bindImageClickEvents 函数（改用内联 onclick，与其他渲染函数保持一致）

/**
 * 更新消息历史中选中的回复
 */
function updateMessageHistoryWithSelectedReply() {
    if (state.currentReplies.length === 0) return;

    const reply = state.currentReplies[state.selectedReplyIndex];
    const textContent = reply.content || (reply.parts?.find(p => p.text)?.text) || '';

    // 同步更新所有三种格式的最后一条 assistant 消息
    // OpenAI 格式
    if (state.messages.length > 0) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg.role === 'assistant') {
            lastMsg.content = textContent;
            lastMsg.allReplies = state.currentReplies;
            lastMsg.selectedReplyIndex = state.selectedReplyIndex;
            lastMsg.thinkingContent = reply.thinkingContent || null;
        }
    }

    // Gemini 格式
    if (state.geminiContents.length > 0) {
        const lastMsg = state.geminiContents[state.geminiContents.length - 1];
        if (lastMsg.role === 'model') {
            lastMsg.parts = reply.parts || [{ text: textContent }];
            lastMsg.allReplies = state.currentReplies;
            lastMsg.selectedReplyIndex = state.selectedReplyIndex;
            // 更新 thoughtSignature
            if (reply.thoughtSignature) {
                lastMsg.thoughtSignature = reply.thoughtSignature;
            } else {
                delete lastMsg.thoughtSignature;
            }
        }
    }

    // Claude 格式
    if (state.claudeContents.length > 0) {
        const lastMsg = state.claudeContents[state.claudeContents.length - 1];
        if (lastMsg.role === 'assistant') {
            lastMsg.content = reply.claudeContent || [{ type: 'text', text: textContent }];
            lastMsg.allReplies = state.currentReplies;
            lastMsg.selectedReplyIndex = state.selectedReplyIndex;
        }
    }

    saveCurrentSessionMessages();
}

/**
 * 渲染搜索引用（Gemini Web Search）
 */
function renderSearchGrounding(groundingMetadata) {
    if (!groundingMetadata?.groundingChunks && !groundingMetadata?.webSearchQueries) return '';

    const chunks = groundingMetadata.groundingChunks || [];
    const sources = chunks
        .filter(chunk => chunk.web)
        .map(chunk => `
            <a href="${chunk.web.uri}" target="_blank" rel="noopener" class="search-source">
                ${escapeHtml(chunk.web.title || new URL(chunk.web.uri).hostname)}
            </a>
        `);

    if (sources.length === 0) return '';

    return `
        <div class="search-sources">
            <span class="sources-label">🔍 来源:</span>
            ${sources.join('')}
        </div>
    `;
}

/**
 * 转义 HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 初始化回复选择器事件监听
 */
export function initReplySelector() {
    // 监听回复选择请求事件
    eventBus.on('reply:select-requested', ({ index, messageIndex }) => {
        selectReply(index, messageIndex);
    });

    console.log('✅ Reply selector initialized');
}
