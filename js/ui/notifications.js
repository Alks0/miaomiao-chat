/**
 * 通知提示系统
 * 显示临时的成功/错误消息，支持堆叠和自定义持续时间
 */

import { eventBus } from '../core/events.js';

const activeNotifications = [];
const MAX_NOTIFICATIONS = 5;
const BASE_TOP = 70;
const NOTIFICATION_GAP = 60;

/**
 * 重新计算所有活跃通知的位置
 */
function repositionNotifications() {
    activeNotifications.forEach((n, i) => {
        n.style.top = `${BASE_TOP + i * NOTIFICATION_GAP}px`;
    });
}

/**
 * 显示通知消息
 * @param {string} message - 通知内容
 * @param {string} type - 通知类型 ('info' | 'error' | 'success' | 'warning')
 * @param {number} duration - 显示持续时间（毫秒）
 */
export function showNotification(message, type = 'info', duration = 3000) {
    // 限制最大通知数量
    if (activeNotifications.length >= MAX_NOTIFICATIONS) {
        const oldest = activeNotifications.shift();
        if (oldest && oldest.parentNode) {
            oldest.remove();
        }
    }

    const notification = document.createElement('div');

    const typeClass = type === 'error' ? 'notification-error' :
                      type === 'success' ? 'notification-success' :
                      type === 'warning' ? 'notification-warning' : '';
    notification.className = `notification${typeClass ? ' ' + typeClass : ''}`;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    // 根据当前活跃通知数量计算位置
    notification.style.top = `${BASE_TOP + activeNotifications.length * NOTIFICATION_GAP}px`;

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    notification.appendChild(messageSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', '关闭通知');

    const removeNotification = () => {
        if (!notification.parentNode) return;
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            notification.remove();
            const idx = activeNotifications.indexOf(notification);
            if (idx > -1) {
                activeNotifications.splice(idx, 1);
                repositionNotifications();
            }
        }, 300);
    };

    closeBtn.onclick = removeNotification;
    notification.appendChild(closeBtn);

    activeNotifications.push(notification);
    document.body.appendChild(notification);

    setTimeout(removeNotification, duration);
}

// ========== 事件监听 ==========

eventBus.on('ui:notification', ({ message, type, duration }) => {
    showNotification(message, type || 'info', duration || 3000);
});
