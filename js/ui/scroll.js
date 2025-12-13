/**
 * 滚动控制模块
 * 处理消息区域的滚动行为和滚动监听
 */

import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';

let scrollTimeout = null;

/**
 * 滚动到底部
 */
export function scrollToBottom() {
    if (!elements.messagesArea) return;
    elements.messagesArea.scrollTo({
        top: elements.messagesArea.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * 更新滚动到底部按钮的显示状态
 */
function updateScrollButtonVisibility() {
    if (!elements.messagesArea || !elements.scrollToBottomBtn) return;

    const scrollTop = elements.messagesArea.scrollTop;
    const scrollHeight = elements.messagesArea.scrollHeight;
    const clientHeight = elements.messagesArea.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // 距离底部超过 150px 时显示按钮
    if (distanceFromBottom > 150) {
        elements.scrollToBottomBtn.classList.add('visible');
    } else {
        elements.scrollToBottomBtn.classList.remove('visible');
    }
}

/**
 * 初始化滚动控制
 */
export function initScrollControl() {
    // 监听滚动请求事件
    eventBus.on('ui:scroll-to-bottom', () => {
        scrollToBottom();
    });

    // 监听消息区域滚动（节流）
    elements.messagesArea?.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            updateScrollButtonVisibility();
            scrollTimeout = null;
        }, 100);
    });

    // 绑定滚动到底部按钮
    elements.scrollToBottomBtn?.addEventListener('click', scrollToBottom);

    // 初始检查
    updateScrollButtonVisibility();

    // 将函数暴露到全局作用域供 HTML onclick 使用
    window.scrollToBottom = scrollToBottom;

    console.log('Scroll control initialized');
}
