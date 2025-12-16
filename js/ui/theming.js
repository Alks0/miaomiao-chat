/**
 * 主题切换功能
 * 管理明暗主题
 */

import { elements } from '../core/elements.js';
import { state } from '../core/state.js';
// ✅ 新增：IndexedDB 偏好设置 API
import { savePreference } from '../state/storage.js';

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.remove('dark-theme');
        return;
    }
    document.documentElement.classList.add('dark-theme');
}

function getSystemTheme() {
    if (window.matchMedia?.('(prefers-color-scheme: light)')?.matches) return 'light';
    return 'dark';
}

/**
 * 切换主题（明暗模式）
 */
export async function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark-theme');

    // 启用过渡动画
    html.classList.add('theme-transition');

    const newTheme = isDark ? 'light' : 'dark';

    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);

    // ✅ 保存主题到存储
    try {
        if (state.storageMode !== 'localStorage') {
            await savePreference('theme', newTheme);
        }
    } catch (error) {
        console.error('保存主题失败:', error);
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
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
        applyTheme(savedTheme);
        return;
    }

    applyTheme(getSystemTheme());
}

/**
 * 初始化主题切换
 */
export function initTheming() {
    // 绑定主题切换按钮
    elements.themeToggle?.addEventListener('click', toggleTheme);

    // 未设置显式偏好时，跟随系统主题变化
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    media?.addEventListener?.('change', () => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light' || savedTheme === 'dark') return;
        applyTheme(getSystemTheme());
    });

    console.log('Theme toggle initialized');
}
