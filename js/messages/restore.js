/**
 * 会话消息恢复模块
 * 处理会话切换时的消息渲染和恢复
 */

import { state, elements } from '../core/state.js';
import { createMessageElement, renderThinkingBlock, renderReplyWithSelector, enhanceCodeBlocks, renderContentParts, bindImageClickEvents } from './renderer.js';
import { renderStreamStatsFromData } from '../stream/stats.js';
import { generateMessageId } from '../utils/helpers.js';
import { rebuildMessageIdMap } from '../core/state-mutations.js';
import { initVirtualScroll } from '../ui/virtual-scroll.js';
import { renderHumanizedError } from '../utils/errors.js';

/**
 * 解析 Gemini 用户消息内容
 * @param {Array} parts - Gemini parts 数组
 * @returns {Object} { text, images }
 */
function parseGeminiUserContent(parts) {
    let text = '';
    const images = [];

    if (Array.isArray(parts)) {
        parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData || part.inline_data) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;
                images.push({
                    name: '已上传图片',
                    type: mimeType,
                    data: `data:${mimeType};base64,${data}`,
                });
            }
        });
    }

    return { text, images };
}

/**
 * 解析 OpenAI/Claude 格式的用户消息内容
 * @param {string|Array} content - 消息内容
 * @returns {Object} { text, images }
 */
function parseUserContent(content) {
    let text = '';
    const images = [];

    if (Array.isArray(content)) {
        content.forEach(part => {
            if (part.type === 'text') {
                text += (text ? '\n' : '') + (part.text || '');
            } else if (part.type === 'image_url' && part.image_url?.url) {
                images.push({
                    name: '已上传图片',
                    type: 'image/*',
                    data: part.image_url.url,
                });
            }
        });
    } else if (typeof content === 'string') {
        text = content;
    }

    return { text, images };
}

/**
 * 渲染会话消息
 */
export function renderSessionMessages() {
    // 清空消息区域
    elements.messagesArea.innerHTML = '';

    // 检查是否有消息
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;

    if (messages.length === 0) {
        // 显示欢迎消息
        elements.messagesArea.innerHTML = `
            <div class="welcome-message glass">
                <div class="gemini-logo">
                    <svg width="64" height="64" viewBox="0 0 64 64">
                        <defs>
                            <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" style="stop-color:#9168c0"/>
                                <stop offset="100%" style="stop-color:#a8c7fa"/>
                            </linearGradient>
                        </defs>
                        <circle cx="32" cy="32" r="28" fill="url(#gemini-gradient)"/>
                    </svg>
                </div>
                <h2>你好，我是 AI 助手</h2>
            </div>
        `;
        return;
    }

    // ✅ 如果消息数量超过阈值，使用虚拟滚动
    if (messages.length >= 100) {
        console.log(`✅ 消息数量 ${messages.length}，启用虚拟滚动模式`);
        initVirtualScroll(true); // 强制启用
        rebuildMessageIdMap(); // 重建索引映射
        // 虚拟滚动模块会自动渲染
        return;
    }

    // 传统渲染模式（< 100 条消息）

    // ✅ 性能优化：使用 DocumentFragment 批量插入，避免频繁 reflow
    const fragment = document.createDocumentFragment();
    const enhancementQueue = []; // 增强操作队列（异步执行）

    // 渲染所有消息
    if (state.apiFormat === 'gemini') {
        state.geminiContents.forEach((msg, index) => {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            const openaiMsg = state.messages[index]; // 提前获取，用于错误恢复和其他元数据
            const { text, images } = parseGeminiUserContent(msg.parts);

            // ✅ 确保消息有唯一ID（为旧消息生成ID）
            if (!msg.id) {
                msg.id = generateMessageId();
                // 同步到其他格式
                if (openaiMsg) openaiMsg.id = msg.id;
                if (state.claudeContents[index]) state.claudeContents[index].id = msg.id;
            }

            const messageEl = createMessageElement(role, text, images.length > 0 ? images : null, msg.id, openaiMsg?.modelName, openaiMsg?.providerName);
            messageEl.dataset.messageIndex = index;

            // ✅ 添加到 Fragment 而非直接 appendChild（减少 reflow）
            fragment.appendChild(messageEl);

            // ✅ 将耗时的增强操作加入队列，稍后异步执行
            if (role === 'assistant' && !msg.isError) {
                enhancementQueue.push({
                    messageEl,
                    msg,
                    openaiMsg,
                    role
                });
            } else if (role === 'assistant' && msg.isError) {
                // ✅ 增强：错误消息降级渲染
                const contentDiv = messageEl.querySelector('.message-content');
                if (contentDiv) {
                    if (openaiMsg?.errorHtml) {
                        // 优先级 1: 使用已保存的 errorHtml
                        contentDiv.innerHTML = openaiMsg.errorHtml;
                    } else if (openaiMsg?.errorData) {
                        // 优先级 2: 从 errorData 重新渲染
                        contentDiv.innerHTML = renderHumanizedError(
                            openaiMsg.errorData,
                            openaiMsg.httpStatus || null,
                            false  // 不显示技术详情，避免 DOM 过大
                        );
                    } else {
                        // 优先级 3: 显示通用错误消息
                        contentDiv.innerHTML = '<div class="error-humanized"><div class="error-humanized-content"><div class="error-humanized-title">错误消息加载失败</div><div class="error-humanized-hint">请重新发送消息</div></div></div>';
                    }
                }
                messageEl.dataset.isError = 'true';
            }
        });
    } else {
        state.messages.forEach((msg, index) => {
            const { text, images } = parseUserContent(msg.content);

            // ✅ 确保消息有唯一ID（为旧消息生成ID）
            if (!msg.id) {
                msg.id = generateMessageId();
                // 同步到其他格式
                if (state.geminiContents[index]) state.geminiContents[index].id = msg.id;
                if (state.claudeContents[index]) state.claudeContents[index].id = msg.id;
            }

            const messageEl = createMessageElement(msg.role, text, images.length > 0 ? images : null, msg.id, msg.modelName, msg.providerName);
            messageEl.dataset.messageIndex = index;

            // ✅ 添加到 Fragment 而非直接 appendChild（减少 reflow）
            fragment.appendChild(messageEl);

            // ✅ 将耗时的增强操作加入队列，稍后异步执行
            if (msg.role === 'assistant' && !msg.isError) {
                enhancementQueue.push({
                    messageEl,
                    msg,
                    openaiMsg: msg,
                    role: msg.role
                });
            } else if (msg.role === 'assistant' && msg.isError) {
                // ✅ 增强：错误消息降级渲染（OpenAI 格式）
                const contentDiv = messageEl.querySelector('.message-content');
                if (contentDiv) {
                    if (msg.errorHtml) {
                        // 优先级 1: 使用已保存的 errorHtml
                        contentDiv.innerHTML = msg.errorHtml;
                    } else if (msg.errorData) {
                        // 优先级 2: 从 errorData 重新渲染
                        contentDiv.innerHTML = renderHumanizedError(
                            msg.errorData,
                            msg.httpStatus || null,
                            false  // 不显示技术详情，避免 DOM 过大
                        );
                    } else {
                        // 优先级 3: 显示通用错误消息
                        contentDiv.innerHTML = '<div class="error-humanized"><div class="error-humanized-content"><div class="error-humanized-title">错误消息加载失败</div><div class="error-humanized-hint">请重新发送消息</div></div></div>';
                    }
                }
                messageEl.dataset.isError = 'true';
            }
        });
    }

    // ✅ 一次性插入所有消息（只触发一次 reflow）
    elements.messagesArea.appendChild(fragment);

    // ✅ 异步增强消息（不阻塞 UI）
    if (enhancementQueue.length > 0) {
        requestIdleCallback(() => {
            enhancementQueue.forEach(({ messageEl, msg, openaiMsg, role }) => {
                enhanceAssistantMessage(messageEl, msg, openaiMsg);
            });
        }, { timeout: 2000 }); // 2秒超时，确保即使在繁忙时也能完成
    }

    // ✅ 重建 messageIdMap（确保索引映射正确）
    rebuildMessageIdMap();

    // 滚动到底部
    setTimeout(() => {
        elements.messagesArea.scrollTo({
            top: elements.messagesArea.scrollHeight,
            behavior: 'instant'
        });
    }, 50);
}

/**
 * 异步增强 assistant 消息（思维链、统计、多回复）
 * ✅ 性能优化：使用 requestIdleCallback 避免阻塞 UI
 * @param {HTMLElement} messageEl - 消息元素
 * @param {Object} msg - Gemini 或 OpenAI 消息对象
 * @param {Object} openaiMsg - OpenAI 格式消息对象（用于元数据）
 */
function enhanceAssistantMessage(messageEl, msg, openaiMsg) {
    const contentDiv = messageEl.querySelector('.message-content');

    // ✅ 优先恢复 contentParts（包含图片和思维链的完整顺序）
    if (openaiMsg && openaiMsg.contentParts && openaiMsg.contentParts.length > 0) {
        if (contentDiv) {
            // 使用 renderContentParts 完整渲染（包含 thinking, text, image）
            contentDiv.innerHTML = renderContentParts(openaiMsg.contentParts);
        }
    }
    // 回退：恢复思维链（旧格式，只有 thinkingContent）
    else if (openaiMsg && openaiMsg.thinkingContent) {
        if (contentDiv) {
            contentDiv.innerHTML = renderThinkingBlock(openaiMsg.thinkingContent) + contentDiv.innerHTML;
        }
    }

    // 恢复流统计信息
    const statsData = msg.streamStats || (openaiMsg && openaiMsg.streamStats);
    if (statsData) {
        const wrapper = messageEl.querySelector('.message-content-wrapper');
        if (wrapper) {
            wrapper.insertAdjacentHTML('beforeend', renderStreamStatsFromData(statsData));
        }
    }

    // 恢复多回复选择器
    if (openaiMsg?.allReplies && openaiMsg.allReplies.length > 1) {
        const selectedIndex = openaiMsg.selectedReplyIndex || 0;
        renderReplyWithSelector(openaiMsg.allReplies, selectedIndex, messageEl);
    } else {
        // 对于没有多回复的消息，也需要增强代码块、表格、思维链等
        enhanceCodeBlocks(messageEl);
    }
}
