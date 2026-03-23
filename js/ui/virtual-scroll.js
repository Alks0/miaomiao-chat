/**
 * 虚拟滚动模块
 * 用于超长会话（500+ 消息）的性能优化
 * 只渲染可见区域的消息，大幅降低 DOM 节点数量
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { createMessageElement, renderThinkingBlock, renderReplyWithSelector } from '../messages/renderer.js';
import { renderStreamStatsFromData } from '../stream/stats.js';
import { lazyImageManager, preloadImagesInRange } from '../utils/lazy-image.js';

// 虚拟滚动配置
const VIRTUAL_SCROLL_CONFIG = {
    enabled: true, // 默认启用虚拟滚动
    threshold: 50, // 消息数量阈值
    itemHeight: 150, // 预估每条消息高度（px）
    overscan: 8, // 上下额外渲染的消息数量（增加到8，减少闪烁）
    buffer: 15 // 缓冲区大小（增加到15，改善滚动体验）
};

// 虚拟滚动状态
const virtualScrollState = {
    isActive: false, // 是否正在使用虚拟滚动
    visibleRange: { start: 0, end: 50 }, // 可见范围
    scrollTop: 0, // 当前滚动位置
    containerHeight: 0, // 容器高度
    totalHeight: 0, // 总内容高度
    itemHeights: new Map(), // 实际测量的每条消息高度 Map<index, height>
    renderedMessages: new Set(), // 已渲染的消息索引
};

/**
 * 计算智能阈值（考虑图片因素）
 * 含有图片的消息会降低阈值
 */
function calculateSmartThreshold(messages) {
    let imageCount = 0;
    let hasImage = false;

    // 统计图片数量
    for (const msg of messages) {
        if (msg.content) {
            // OpenAI/Claude 格式（数组内容）
            if (Array.isArray(msg.content)) {
                // 检测 OpenAI 格式的图片
                imageCount += msg.content.filter(part => part.type === 'image_url').length;
                // 检测 Claude 格式的图片
                imageCount += msg.content.filter(part => part.type === 'image').length;
                if (!hasImage && imageCount > 0) hasImage = true;
            }
        }
        // Gemini parts 格式
        if (msg.parts && Array.isArray(msg.parts)) {
            imageCount += msg.parts.filter(part => part.inlineData).length;
            if (!hasImage && imageCount > 0) hasImage = true;
        }
    }

    // 根据图片密度调整阈值
    if (!hasImage) {
        // 纯文本消息：使用默认阈值
        return VIRTUAL_SCROLL_CONFIG.threshold;
    }

    const imageRatio = imageCount / messages.length;
    if (imageRatio > 0.3) {
        // 高图片密度（> 30%）：大幅降低阈值
        return Math.max(30, Math.floor(VIRTUAL_SCROLL_CONFIG.threshold * 0.3));
    } else if (imageRatio > 0.1) {
        // 中等图片密度（10-30%）：适度降低阈值
        return Math.max(50, Math.floor(VIRTUAL_SCROLL_CONFIG.threshold * 0.5));
    } else {
        // 低图片密度（< 10%）：轻微降低阈值
        return Math.max(75, Math.floor(VIRTUAL_SCROLL_CONFIG.threshold * 0.75));
    }
}

/**
 * 初始化虚拟滚动
 * @param {boolean} force - 强制启用/禁用
 */
export function initVirtualScroll(force = null) {
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;

    // 计算智能阈值
    const smartThreshold = calculateSmartThreshold(messages);

    const shouldEnable = force !== null
        ? force
        : (messages.length >= smartThreshold);

    if (shouldEnable && !virtualScrollState.isActive) {
        console.log(`[VirtualScroll] 启用虚拟滚动 (${messages.length} 条消息, 阈值: ${smartThreshold})`);
        enableVirtualScroll();
    } else if (!shouldEnable && virtualScrollState.isActive) {
        disableVirtualScroll();
    }
}

/**
 * 启用虚拟滚动
 */
function enableVirtualScroll() {
    console.log('🚀 启用虚拟滚动模式');

    virtualScrollState.isActive = true;
    VIRTUAL_SCROLL_CONFIG.enabled = true;

    // 测量容器高度
    virtualScrollState.containerHeight = elements.messagesArea.clientHeight;

    // 绑定滚动事件
    elements.messagesArea.addEventListener('scroll', handleVirtualScroll);

    // 初始渲染
    renderVirtualMessages();
}

/**
 * 禁用虚拟滚动（恢复正常渲染）
 */
function disableVirtualScroll() {
    console.log('📴 禁用虚拟滚动模式');

    virtualScrollState.isActive = false;
    VIRTUAL_SCROLL_CONFIG.enabled = false;

    // 解绑事件
    elements.messagesArea.removeEventListener('scroll', handleVirtualScroll);

    // 清理状态
    virtualScrollState.renderedMessages.clear();
    virtualScrollState.itemHeights.clear();
}

/**
 * 处理虚拟滚动事件
 * 使用 requestAnimationFrame 节流
 */
let rafId = null;
function handleVirtualScroll() {
    if (rafId) return; // 避免重复调用

    rafId = requestAnimationFrame(() => {
        const scrollTop = elements.messagesArea.scrollTop;

        // 如果滚动变化不大，跳过
        if (Math.abs(scrollTop - virtualScrollState.scrollTop) < 10) {
            rafId = null;
            return;
        }

        virtualScrollState.scrollTop = scrollTop;
        updateVisibleRange();
        renderVirtualMessages();

        rafId = null;
    });
}

/**
 * 计算可见范围
 */
function updateVisibleRange() {
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;
    const totalMessages = messages.length;

    if (totalMessages === 0) {
        virtualScrollState.visibleRange = { start: 0, end: 0 };
        return;
    }

    const scrollTop = virtualScrollState.scrollTop;
    const containerHeight = virtualScrollState.containerHeight;

    // 估算起始索引
    let start = 0;
    let accumulatedHeight = 0;

    for (let i = 0; i < totalMessages; i++) {
        const itemHeight = virtualScrollState.itemHeights.get(i) || VIRTUAL_SCROLL_CONFIG.itemHeight;

        if (accumulatedHeight + itemHeight > scrollTop) {
            start = i;
            break;
        }

        accumulatedHeight += itemHeight;
    }

    // 估算结束索引
    let end = start;
    let visibleHeight = 0;

    for (let i = start; i < totalMessages; i++) {
        const itemHeight = virtualScrollState.itemHeights.get(i) || VIRTUAL_SCROLL_CONFIG.itemHeight;
        visibleHeight += itemHeight;

        if (visibleHeight >= containerHeight) {
            end = i + 1;
            break;
        }
    }

    // 如果没有找到结束索引（内容不足一屏），显示到最后
    if (end === start) {
        end = totalMessages;
    }

    // 添加 overscan（上下各多渲染几条）
    start = Math.max(0, start - VIRTUAL_SCROLL_CONFIG.overscan);
    end = Math.min(totalMessages, end + VIRTUAL_SCROLL_CONFIG.overscan);

    virtualScrollState.visibleRange = { start, end };
}

/**
 * 渲染虚拟消息
 */
function renderVirtualMessages() {
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;
    const { start, end } = virtualScrollState.visibleRange;

    // 计算总高度和顶部偏移
    let topHeight = 0;
    let bottomHeight = 0;

    for (let i = 0; i < messages.length; i++) {
        const itemHeight = virtualScrollState.itemHeights.get(i) || VIRTUAL_SCROLL_CONFIG.itemHeight;

        if (i < start) {
            topHeight += itemHeight;
        } else if (i >= end) {
            bottomHeight += itemHeight;
        }
    }

    // 更新占位符高度
    let topSpacer = elements.messagesArea.querySelector('.virtual-spacer-top');
    let bottomSpacer = elements.messagesArea.querySelector('.virtual-spacer-bottom');

    if (!topSpacer) {
        topSpacer = document.createElement('div');
        topSpacer.className = 'virtual-spacer-top';
        topSpacer.style.flexShrink = '0';
        elements.messagesArea.insertBefore(topSpacer, elements.messagesArea.firstChild);
    }

    if (!bottomSpacer) {
        bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'virtual-spacer-bottom';
        bottomSpacer.style.flexShrink = '0';
        elements.messagesArea.appendChild(bottomSpacer);
    }

    topSpacer.style.height = `${topHeight}px`;
    bottomSpacer.style.height = `${bottomHeight}px`;

    // 移除不在可见范围内的消息
    const existingMessages = Array.from(elements.messagesArea.querySelectorAll('.message'));
    existingMessages.forEach(msgEl => {
        const index = parseInt(msgEl.dataset.messageIndex);
        if (index < start || index >= end) {
            msgEl.remove();
            virtualScrollState.renderedMessages.delete(index);
        }
    });

    // 渲染可见范围内的消息
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        // 如果已渲染，跳过
        if (virtualScrollState.renderedMessages.has(i)) {
            continue;
        }

        const msg = messages[i];
        if (!msg) continue;
        const messageEl = createVirtualMessageElement(msg, i);
        fragment.appendChild(messageEl);

        virtualScrollState.renderedMessages.add(i);

        // 测量实际高度
        requestIdleCallback(() => {
            const actualHeight = messageEl.offsetHeight;
            if (actualHeight > 0) {
                virtualScrollState.itemHeights.set(i, actualHeight);
            }
        });
    }

    // 插入到正确位置（在 bottom spacer 之前）
    if (fragment.childNodes.length > 0) {
        elements.messagesArea.insertBefore(fragment, bottomSpacer);

        // 观察新插入的懒加载图片
        requestIdleCallback(() => {
            const lazyImages = elements.messagesArea.querySelectorAll('.lazy-image:not(.observed)');
            lazyImages.forEach(img => {
                lazyImageManager.observe(img);
                img.classList.add('observed');
            });
        }, { timeout: 500 });
    }
}

/**
 * 创建虚拟消息元素
 * @param {Object} msg - 消息对象
 * @param {number} index - 消息索引
 * @returns {HTMLElement} 消息元素
 */
function createVirtualMessageElement(msg, index) {
    let role, text, images, messageId;

    if (state.apiFormat === 'gemini') {
        role = msg.role === 'model' ? 'assistant' : msg.role;
        const parts = msg.parts || [];

        text = parts.filter(p => p.text).map(p => p.text).join('');
        images = parts.filter(p => p.inlineData || p.inline_data);
        messageId = msg.id;
    } else {
        role = msg.role;
        const content = msg.content;

        if (typeof content === 'string') {
            text = content;
            images = [];
        } else if (Array.isArray(content)) {
            text = content.filter(p => p.type === 'text').map(p => p.text).join('');
            images = content.filter(p => p.type === 'image_url');
        } else {
            text = '';
            images = [];
        }

        messageId = msg.id;
    }

    const messageEl = createMessageElement(
        role,
        text,
        images.length > 0 ? images : null,
        messageId
    );

    messageEl.dataset.messageIndex = index;

    // 恢复思维链（如果有）
    const openaiMsg = state.messages[index];
    if (role === 'assistant' && openaiMsg?.thinkingContent) {
        requestIdleCallback(() => {
            const contentDiv = messageEl.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.innerHTML = renderThinkingBlock(openaiMsg.thinkingContent) + contentDiv.innerHTML;
            }
        });
    }

    // 恢复流统计（如果有）
    if (openaiMsg?.streamStats) {
        requestIdleCallback(() => {
            const wrapper = messageEl.querySelector('.message-content-wrapper');
            if (wrapper) {
                wrapper.insertAdjacentHTML('beforeend', renderStreamStatsFromData(openaiMsg.streamStats));
            }
        });
    }

    // 恢复多回复（如果有）
    if (openaiMsg?.allReplies && openaiMsg.allReplies.length > 1) {
        requestIdleCallback(() => {
            renderReplyWithSelector(openaiMsg.allReplies, openaiMsg.selectedReplyIndex || 0, messageEl);
        });
    }

    return messageEl;
}

/**
 * 滚动到指定消息索引
 * @param {number} index - 消息索引
 * @param {string} behavior - 滚动行为 ('auto' | 'smooth' | 'instant')
 */
export function scrollToMessage(index, behavior = 'smooth') {
    if (!virtualScrollState.isActive) {
        // 非虚拟滚动模式，使用普通滚动
        const messageEl = elements.messagesArea.querySelector(`[data-message-index="${index}"]`);
        if (messageEl) {
            messageEl.scrollIntoView({ behavior, block: 'center' });
        }
        return;
    }

    // 虚拟滚动模式：计算目标位置
    let targetScrollTop = 0;

    for (let i = 0; i < index; i++) {
        const itemHeight = virtualScrollState.itemHeights.get(i) || VIRTUAL_SCROLL_CONFIG.itemHeight;
        targetScrollTop += itemHeight;
    }

    elements.messagesArea.scrollTo({
        top: targetScrollTop,
        behavior
    });
}

/**
 * 滚动到底部
 * @param {string} behavior - 滚动行为
 */
export function scrollToBottom(behavior = 'smooth') {
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;
    scrollToMessage(messages.length - 1, behavior);
}

/**
 * 获取虚拟滚动统计信息
 */
export function getVirtualScrollStats() {
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;

    return {
        isActive: virtualScrollState.isActive,
        totalMessages: messages.length,
        renderedMessages: virtualScrollState.renderedMessages.size,
        visibleRange: virtualScrollState.visibleRange,
        measuredHeights: virtualScrollState.itemHeights.size,
        estimatedTotalHeight: messages.length * VIRTUAL_SCROLL_CONFIG.itemHeight
    };
}
