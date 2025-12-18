/**
 * 会话消息恢复模块
 * 处理会话切换时的消息渲染和恢复
 */

import { state, elements } from '../core/state.js';
import { createMessageElement, renderThinkingBlock, renderReplyWithSelector, enhanceCodeBlocks, renderContentParts, bindImageClickEvents } from './renderer.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { renderStreamStatsFromData } from '../stream/stats.js';
import { generateMessageId } from '../utils/helpers.js';
import { rebuildMessageIdMap } from '../core/state-mutations.js';
import { initVirtualScroll } from '../ui/virtual-scroll.js';
import { renderHumanizedError } from '../utils/errors.js';
import { createToolCallUI, updateToolCallStatus } from '../ui/tool-display.js';  // 工具UI恢复
import { categorizeFile } from '../utils/file-helpers.js';

/**
 * 解析 Gemini 用户消息内容
 * @param {Array} parts - Gemini parts 数组
 * @returns {Object} { text, attachments }
 */
function parseGeminiUserContent(parts) {
    let text = '';
    const attachments = [];

    if (Array.isArray(parts)) {
        parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData || part.inline_data) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;
                const category = categorizeFile(mimeType);

                // 根据类型生成名称
                let name = '已上传文件';
                if (category === 'image') name = '已上传图片';
                else if (category === 'pdf') name = '已上传PDF';
                else if (category === 'text') name = mimeType === 'text/markdown' ? '已上传MD' : '已上传TXT';

                attachments.push({
                    name,
                    type: mimeType,
                    category,
                    data: `data:${mimeType};base64,${data}`,
                });
            }
        });
    }

    // 返回 images 以保持向后兼容
    return { text, images: attachments };
}

/**
 * 解析 OpenAI/Claude 格式的用户消息内容
 * @param {string|Array} content - 消息内容
 * @returns {Object} { text, images }
 */
function parseUserContent(content) {
    let text = '';
    const attachments = [];

    if (Array.isArray(content)) {
        content.forEach(part => {
            if (part.type === 'text') {
                text += (text ? '\n' : '') + (part.text || '');
            } else if (part.type === 'image_url' && part.image_url?.url) {
                // 图片（OpenAI 格式）
                attachments.push({
                    name: '已上传图片',
                    type: 'image/*',
                    category: 'image',
                    data: part.image_url.url,
                });
            } else if (part.type === 'image' && part.source?.data) {
                // 图片（Claude 格式）
                const mimeType = part.source.media_type || 'image/*';
                attachments.push({
                    name: '已上传图片',
                    type: mimeType,
                    category: 'image',
                    data: `data:${mimeType};base64,${part.source.data}`,
                });
            } else if (part.type === 'file' && part.file?.file_data) {
                // PDF（OpenAI 格式）
                attachments.push({
                    name: part.file.filename || '已上传PDF',
                    type: 'application/pdf',
                    category: 'pdf',
                    data: part.file.file_data,
                });
            } else if (part.type === 'document' && part.source?.data) {
                // PDF（Claude 格式）
                const mimeType = part.source.media_type || 'application/pdf';
                attachments.push({
                    name: '已上传PDF',
                    type: mimeType,
                    category: 'pdf',
                    data: `data:${mimeType};base64,${part.source.data}`,
                });
            }
            // 注意：TXT/MD 文件在 OpenAI/Claude 格式中会被解码为文本内容
            // 无法从纯文本中恢复为附件形式
        });
    } else if (typeof content === 'string') {
        text = content;
    }

    // 返回 images 以保持向后兼容
    return { text, images: attachments };
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

    // 如果消息数量超过阈值，使用虚拟滚动
    if (messages.length >= 100) {
        console.log(`消息数量 ${messages.length}，启用虚拟滚动模式`);
        initVirtualScroll(true); // 强制启用
        rebuildMessageIdMap(); // 重建索引映射
        // 虚拟滚动模块会自动渲染
        return;
    }

    // 传统渲染模式（< 100 条消息）

    // 性能优化：使用 DocumentFragment 批量插入，避免频繁 reflow
    const fragment = document.createDocumentFragment();
    const enhancementQueue = []; // 增强操作队列（异步执行）

    // 渲染所有消息
    if (state.apiFormat === 'gemini') {
        state.geminiContents.forEach((msg, index) => {
            const role = msg.role === 'model' ? 'assistant' : msg.role;
            const openaiMsg = state.messages[index]; // 提前获取，用于错误恢复和其他元数据
            const { text, images } = parseGeminiUserContent(msg.parts);

            // 确保消息有唯一ID（为旧消息生成ID）
            if (!msg.id) {
                msg.id = generateMessageId();
                // 同步到其他格式
                if (openaiMsg) openaiMsg.id = msg.id;
                if (state.claudeContents[index]) state.claudeContents[index].id = msg.id;
            }

            const messageEl = createMessageElement(role, text, images.length > 0 ? images : null, msg.id, openaiMsg?.modelName, openaiMsg?.providerName);
            messageEl.dataset.messageIndex = index;

            // 添加到 Fragment 而非直接 appendChild（减少 reflow）
            fragment.appendChild(messageEl);

            // 将耗时的增强操作加入队列，稍后异步执行
            if (role === 'assistant' && !msg.isError) {
                enhancementQueue.push({
                    messageEl,
                    msg,
                    openaiMsg
                });
            } else if (role === 'assistant' && msg.isError) {
                // 增强：错误消息降级渲染
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

            // 确保消息有唯一ID（为旧消息生成ID）
            if (!msg.id) {
                msg.id = generateMessageId();
                // 同步到其他格式
                if (state.geminiContents[index]) state.geminiContents[index].id = msg.id;
                if (state.claudeContents[index]) state.claudeContents[index].id = msg.id;
            }

            const messageEl = createMessageElement(msg.role, text, images.length > 0 ? images : null, msg.id, msg.modelName, msg.providerName);
            messageEl.dataset.messageIndex = index;

            // 添加到 Fragment 而非直接 appendChild（减少 reflow）
            fragment.appendChild(messageEl);

            // 将耗时的增强操作加入队列，稍后异步执行
            if (msg.role === 'assistant' && !msg.isError) {
                enhancementQueue.push({
                    messageEl,
                    msg,
                    openaiMsg: msg
                });
            } else if (msg.role === 'assistant' && msg.isError) {
                // 增强：错误消息降级渲染（OpenAI 格式）
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

    // 一次性插入所有消息（只触发一次 reflow）
    elements.messagesArea.appendChild(fragment);

    // 异步增强消息（不阻塞 UI）
    if (enhancementQueue.length > 0) {
        requestIdleCallback(() => {
            enhancementQueue.forEach(({ messageEl, msg, openaiMsg }) => {
                enhanceAssistantMessage(messageEl, msg, openaiMsg);
            });
        }, { timeout: 2000 }); // 2秒超时，确保即使在繁忙时也能完成
    }

    // 重建 messageIdMap（确保索引映射正确）
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
 * 恢复工具调用UI
 * @param {Array} toolCalls - 工具调用数组
 * @param {HTMLElement} messageEl - 消息元素
 */
async function restoreToolCallsUI(toolCalls, messageEl) {
    if (!toolCalls || toolCalls.length === 0) return;

    console.log(`[Restore] 恢复 ${toolCalls.length} 个工具调用UI`);

    const contentDiv = messageEl.querySelector('.message-content');
    if (!contentDiv) {
        console.warn('[Restore] 未找到消息内容容器');
        return;
    }

    // 导入工具UI函数
    const { createToolCallUI, updateToolCallStatus } = await import('../ui/tool-display.js');

    // 临时设置 state.currentAssistantMessage 用于 createToolCallUI
    const prevAssistantMessage = state.currentAssistantMessage;
    state.currentAssistantMessage = contentDiv;

    try {
        // 记录插入位置：第一个非工具UI的元素
        // 这样可以确保所有工具UI都按顺序插入到内容的最前面
        let insertBeforeElement = null;

        // 找到第一个不是工具UI的子元素
        for (const child of contentDiv.children) {
            if (!child.classList.contains('tool-call-container')) {
                insertBeforeElement = child;
                break;
            }
        }

        // 按顺序恢复所有工具调用
        for (const toolCall of toolCalls) {
            // 创建工具UI元素
            const toolContainer = await createToolCallUI({
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.arguments || toolCall.input || {}
            });

            // 关键将工具UI移动到正确位置
            // createToolCallUI 使用 appendChild 添加到最后，我们需要移动它
            if (toolContainer && contentDiv.contains(toolContainer)) {
                // 如果找到了非工具UI元素，插入到它之前；否则保持在当前位置
                if (insertBeforeElement) {
                    contentDiv.insertBefore(toolContainer, insertBeforeElement);
                }
                // 如果 insertBeforeElement 为 null，说明内容全是工具UI或为空，
                // 工具UI已经在正确位置（appendChild 添加到了最后），不需要移动
            }

            // 立即更新为completed状态
            updateToolCallStatus(toolCall.id, 'completed', {
                result: { restored: true }
            });
        }

        console.log('[Restore] 工具UI恢复完成');
    } catch (error) {
        console.error('[Restore] 恢复工具UI失败:', error);
    } finally {
        // 恢复 state.currentAssistantMessage
        state.currentAssistantMessage = prevAssistantMessage;
    }
}

/**
 * 异步增强 assistant 消息（思维链、统计、多回复、工具UI）
 * 性能优化：使用 requestIdleCallback 避免阻塞 UI
 * 性能优化：缓存 DOM 查询
 * @param {HTMLElement} messageEl - 消息元素
 * @param {Object} msg - Gemini 或 OpenAI 消息对象
 * @param {Object} openaiMsg - OpenAI 格式消息对象（用于元数据）
 */
function enhanceAssistantMessage(_messageEl, msg, openaiMsg) {
    // 优化：缓存 querySelector 结果
    const contentDiv = _messageEl.querySelector('.message-content');

    // 恢复消息内容（思维链 + 文本/图片）
    if (contentDiv && openaiMsg) {
        let html = '';
        let contentRendered = false;  // 跟踪是否成功渲染了内容

        // 1. 先渲染思维链（如果有）
        if (openaiMsg.thinkingContent) {
            html += renderThinkingBlock(openaiMsg.thinkingContent);
        }

        // 2. 优先渲染 contentParts（text, image）
        if (openaiMsg.contentParts && openaiMsg.contentParts.length > 0) {
            // 过滤掉占位符和 thinking 类型（thinking 已经在上面单独渲染过了）
            const validContentParts = openaiMsg.contentParts.filter(
                p => !(p.type === 'text' && p.text === '(调用工具)') && p.type !== 'thinking'
            );

            if (validContentParts.length > 0) {
                const renderedContent = renderContentParts(validContentParts);
                if (renderedContent && renderedContent.trim()) {
                    html += renderedContent;
                    contentRendered = true;
                }
            }
        }

        // 3. 如果 contentParts 没有渲染出内容，回退到 openaiMsg.content
        if (!contentRendered && openaiMsg.content) {
            // 获取原始文本内容
            let textContent = '';
            if (typeof openaiMsg.content === 'string') {
                textContent = openaiMsg.content;
            } else if (Array.isArray(openaiMsg.content)) {
                textContent = openaiMsg.content
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('');
            }
            // 如果不是占位符，渲染它
            if (textContent && textContent !== '(调用工具)') {
                html += safeMarkedParse(textContent);
                contentRendered = true;
            }
        }

        // 4. 最后的回退：尝试从 Gemini parts 获取内容
        if (!contentRendered && msg && msg.parts && Array.isArray(msg.parts)) {
            const textFromParts = msg.parts
                .filter(p => p.text && !p.thought)  // 排除思维链
                .map(p => p.text)
                .join('');
            if (textFromParts && textFromParts !== '(调用工具)') {
                html += safeMarkedParse(textFromParts);
                contentRendered = true;
            }
        }

        // 5. 如果有内容，更新 DOM
        if (html) {
            contentDiv.innerHTML = html;
        }

        // 日志记录未渲染的情况
        if (!contentRendered && !openaiMsg.thinkingContent) {
            console.warn('[Restore] 消息无法渲染内容:', {
                index: _messageEl.dataset.messageIndex,
                contentParts: openaiMsg.contentParts?.length,
                content: typeof openaiMsg.content,
                parts: msg?.parts?.length
            });
        }
    }

    // 优化：恢复流统计信息（缓存 wrapper 查询）
    const statsData = msg.streamStats || (openaiMsg && openaiMsg.streamStats);
    if (statsData) {
        const wrapper = _messageEl.querySelector('.message-content-wrapper');
        if (wrapper) {
            wrapper.insertAdjacentHTML('beforeend', renderStreamStatsFromData(statsData));
        }
    }

    // 恢复多回复选择器
    if (openaiMsg?.allReplies && openaiMsg.allReplies.length > 1) {
        const selectedIndex = openaiMsg.selectedReplyIndex || 0;
        renderReplyWithSelector(openaiMsg.allReplies, selectedIndex, _messageEl);
    } else {
        // 对于没有多回复的消息，也需要增强代码块、表格、思维链等
        enhanceCodeBlocks(_messageEl);
    }

    // 恢复工具调用UI（如果有）
    if (openaiMsg?.toolCalls && openaiMsg.toolCalls.length > 0) {
        restoreToolCallsUI(openaiMsg.toolCalls, _messageEl);
    }
}
