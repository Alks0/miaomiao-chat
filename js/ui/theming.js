/**
 * 主题切换功能
 * 管理明暗主题
 */

import { elements } from '../core/elements.js';
import { state } from '../core/state.js';
// ✅ 新增：IndexedDB 偏好设置 API
import { savePreference, loadPreference } from '../state/storage.js';

/**
 * 切换主题（明暗模式）
 */
export async function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark-theme');

    // 启用过渡动画
    html.classList.add('theme-transition');

    const newTheme = isDark ? 'light' : 'dark';

    if (isDark) {
        html.classList.remove('dark-theme');
    } else {
        html.classList.add('dark-theme');
    }

    // ✅ 保存主题到存储
    try {
        if (state.storageMode !== 'localStorage') {
            await savePreference('theme', newTheme);
        } else {
            localStorage.setItem('theme', newTheme);
        }
    } catch (error) {
        console.error('保存主题失败:', error);
        localStorage.setItem('theme', newTheme);
    }

    // 过渡结束后移除过渡类，避免其他样式变化触发不必要的动画
    setTimeout(() => {
        html.classList.remove('theme-transition');
    }, 300);
}

/**
 * 加载保存的主题设置（同步函数，在 IndexedDB 初始化前调用）
 */
export function loadTheme() {
    // 只从 localStorage 读取（因为在 IndexedDB 初始化前调用）
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark-theme');
    }
    // 默认是暗色主题，所以 dark 或 null 时不需要额外操作
}

/**
 * 初始化主题切换
 */
export function initTheming() {
    // 绑定主题切换按钮
    elements.themeToggle?.addEventListener('click', toggleTheme);

    console.log('Theme toggle initialized');
}
