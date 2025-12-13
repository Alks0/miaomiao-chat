/**
 * UI 增强功能模块
 * 包括密码切换、自定义请求头、代码复制、涟漪效果等
 */

import { state } from '../core/state.js';
import { saveCurrentConfig } from '../state/config.js';
import { showNotification } from './notifications.js';
import { escapeHtml } from '../utils/helpers.js';

/**
 * 初始化密码显示切换
 */
export function initPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach(btn => {
        // 初始化 aria-label
        btn.setAttribute('aria-label', '显示密码');
        btn.setAttribute('role', 'button');

        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;

            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.classList.toggle('visible', isPassword);
            btn.setAttribute('aria-label', isPassword ? '隐藏密码' : '显示密码');
        });
    });

    console.log('Password toggles initialized');
}

/**
 * 渲染所有自定义请求头
 */
export function renderCustomHeaders() {
    const listContainer = document.getElementById('custom-headers-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    state.customHeaders.forEach((header, index) => {
        addCustomHeaderRow(header.key, header.value, index);
    });
}

/**
 * 添加一行请求头输入
 */
function addCustomHeaderRow(key = '', value = '', index = null) {
    const listContainer = document.getElementById('custom-headers-list');
    if (!listContainer) return;

    // 如果是新增，添加到 state
    if (index === null) {
        index = state.customHeaders.length;
        state.customHeaders.push({ key: '', value: '' });
    }

    const row = document.createElement('div');
    row.className = 'custom-header-row';
    row.dataset.index = index;

    row.innerHTML = `
        <input type="text" class="header-key" placeholder="Header-Name" value="${escapeHtml(key)}" data-field="key">
        <input type="text" class="header-value" placeholder="Header Value" value="${escapeHtml(value)}" data-field="value">
        <button type="button" class="remove-header-btn" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
        </button>
    `;

    // 输入事件 - 更新 state
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = parseInt(row.dataset.index);
            const field = e.target.dataset.field;
            if (state.customHeaders[idx]) {
                state.customHeaders[idx][field] = e.target.value;
                saveCurrentConfig();
            }
        });
    });

    // 删除按钮
    row.querySelector('.remove-header-btn').addEventListener('click', () => {
        const idx = parseInt(row.dataset.index);
        state.customHeaders.splice(idx, 1);
        renderCustomHeaders();
        saveCurrentConfig();
    });

    listContainer.appendChild(row);
}

/**
 * 初始化自定义请求头
 */
export function initCustomHeaders() {
    const addBtn = document.getElementById('add-custom-header');
    const listContainer = document.getElementById('custom-headers-list');

    if (!addBtn || !listContainer) return;

    // 添加请求头按钮
    addBtn.addEventListener('click', () => {
        addCustomHeaderRow('', '');
        saveCurrentConfig();
    });

    // 渲染已有的请求头
    renderCustomHeaders();

    console.log('Custom headers initialized');
}

/**
 * 添加涟漪效果
 */
function addRippleEffect(event, button = null) {
    button = button || event.currentTarget;
    if (!button || typeof button.getBoundingClientRect !== 'function') return;

    // 创建涟漪元素
    const ripple = document.createElement('span');
    ripple.className = 'ripple';

    // 计算涟漪的位置和大小
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    button.appendChild(ripple);

    // 动画结束后移除涟漪
    ripple.addEventListener('animationend', () => {
        ripple.remove();
    });
}

/**
 * 初始化涟漪效果
 */
export function initRippleEffects() {
    const rippleSelectors = [
        '.icon-button',
        '.send-btn',
        '.settings-icon-btn',
        '.new-session-btn',
        '.input-icon-btn',
        '.close-settings-btn',
        '.format-btn',
        '.reply-tab',
        '.session-action-btn',
        '.retry-button',
        '.cancel-edit-btn',
        '.msg-action-btn',
        '.quick-toggle-btn'
    ];

    // 优化：使用单个监听器处理所有选择器，减少事件监听器数量
    document.addEventListener('click', (e) => {
        for (const selector of rippleSelectors) {
            const button = e.target.closest(selector);
            if (button && !button.disabled && typeof button.getBoundingClientRect === 'function') {
                addRippleEffect(e, button);
                break;  // 找到目标后立即退出，避免重复处理
            }
        }
    });

    console.log('Ripple effects initialized');
}

// 注意：代码块增强功能（enhanceCodeBlocks）已在 messages/renderer.js 中实现
// 此处不重复实现，避免代码冗余
