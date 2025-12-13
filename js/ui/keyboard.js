/**
 * 全局键盘事件处理
 * 处理 ESC 键等全局快捷键
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { toggleSettings } from './settings.js';
import { toggleSidebar } from './sidebar.js';
import { closeImageViewer } from './viewer.js';

/**
 * 取消编辑（通过全局访问）
 */
function cancelEdit() {
    if (state.editingIndex === null) return;

    // 清空输入框
    elements.userInput.value = '';
    if (elements.userInput.style) {
        elements.userInput.style.height = 'auto';
    }
    state.uploadedImages = [];

    // 更新图片预览
    const previewContainer = document.getElementById('image-preview-container');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        previewContainer.classList.remove('has-images');
    }

    // 重置编辑状态
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
        state.editingElement = null;
    }
    state.editingIndex = null;

    // 更新取消编辑按钮
    const cancelBtn = document.getElementById('cancel-edit');
    if (cancelBtn) {
        cancelBtn.classList.remove('show');
    }
}

/**
 * 初始化全局键盘事件
 */
export function initKeyboard() {
    // ESC 键处理
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // 1. 优先关闭图片查看器
            const imageViewer = document.getElementById('image-viewer-modal');
            if (imageViewer && imageViewer.classList.contains('open')) {
                closeImageViewer();
                return;
            }

            // 2. 关闭设置面板
            if (elements.settingsPanel && elements.settingsPanel.classList.contains('open')) {
                toggleSettings();
                return;
            }

            // 3. 关闭会话侧边栏
            if (elements.sidebar && elements.sidebar.classList.contains('open')) {
                toggleSidebar();
                return;
            }

            // 4. 取消编辑状态
            if (state.editingIndex !== null) {
                cancelEdit();
            }
        }
    });

    console.log('Keyboard shortcuts initialized');
}
