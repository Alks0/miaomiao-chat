/**
 * 通知提示系统
 * 显示临时的成功/错误消息
 */

import { eventBus } from '../core/events.js';

/**
 * 显示通知消息
 * @param {string} message - 通知内容
 * @param {string} type - 通知类型 ('info' | 'error' | 'success' | 'warning')
 */
export function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');

    // 根据类型设置不同的样式类
    const typeClass = type === 'error' ? 'notification-error' :
                      type === 'success' ? 'notification-success' :
                      type === 'warning' ? 'notification-warning' : '';
    notification.className = `notification${typeClass ? ' ' + typeClass : ''}`;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    // 创建消息文本
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    notification.appendChild(messageSpan);

    // 创建关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', '关闭通知');
    closeBtn.onclick = () => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    };
    notification.appendChild(closeBtn);

    document.body.appendChild(notification);

    // 3秒后自动移除
    const autoCloseTimeout = setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);

    // 如果用户手动关闭，取消自动关闭
    closeBtn.addEventListener('click', () => clearTimeout(autoCloseTimeout), { once: true });
}

// ========== 事件监听 ==========

/**
 * 监听全局通知事件
 */
eventBus.on('ui:notification', ({ message, type }) => {
    showNotification(message, type || 'info');
});
