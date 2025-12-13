/**
 * 图片查看器模块
 * 处理图片的全屏查看
 */

import { eventBus } from '../core/events.js';
import { downloadImage } from '../utils/images.js';

/**
 * 焦点陷阱 - 限制焦点在指定元素内
 * @param {HTMLElement} element - 要限制焦点的元素
 */
function trapFocus(element) {
    if (element._focusTrapHandler) return; // 已经设置过

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handler = (e) => {
        if (e.key !== 'Tab') return;

        const focusableElements = element.querySelectorAll(focusableSelector);
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    };

    element.addEventListener('keydown', handler);
    element._focusTrapHandler = handler;
}

/**
 * 移除焦点陷阱
 * @param {HTMLElement} element - 元素
 */
function removeFocusTrap(element) {
    if (element._focusTrapHandler) {
        element.removeEventListener('keydown', element._focusTrapHandler);
        delete element._focusTrapHandler;
    }
}

/**
 * 打开图片查看器
 * @param {string} src - 图片 URL
 */
export function openImageViewer(src) {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('image-viewer-img');
    if (modal && img) {
        img.src = src;
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // 启用焦点陷阱
        trapFocus(modal);

        // 禁用主内容交互
        document.querySelector('.app-container')?.setAttribute('inert', '');
    }
}

/**
 * 关闭图片查看器
 * @param {Event} event - 事件对象
 */
export function closeImageViewer(event) {
    // 如果点击的是图片本身，不关闭
    if (event && event.target.id === 'image-viewer-img') {
        return;
    }
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';

        // 移除焦点陷阱
        removeFocusTrap(modal);

        // 恢复主内容交互
        document.querySelector('.app-container')?.removeAttribute('inert');
    }
}

/**
 * 初始化图片查看器
 */
export function initImageViewer() {
    // 监听图片查看请求
    eventBus.on('ui:open-image-viewer', ({ url }) => {
        openImageViewer(url);
    });

    // 绑定关闭按钮
    const closeBtn = document.querySelector('#image-viewer-modal .close-viewer-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeImageViewer);
    }

    // 点击背景关闭
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.addEventListener('click', closeImageViewer);
    }

    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('image-viewer-modal');
            if (modal && modal.classList.contains('open')) {
                closeImageViewer();
            }
        }
    });

    // 将函数暴露到全局作用域供 HTML onclick 使用
    window.openImageViewer = openImageViewer;
    window.closeImageViewer = closeImageViewer;
    window.downloadImage = downloadImage;

    console.log('Image viewer initialized');
}
