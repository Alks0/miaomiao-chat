/**
 * 面板和输入框拖拽调整功能
 * 处理输入框高度调整和面板宽度调整
 */

import { elements } from '../core/elements.js';
import { state } from '../core/state.js';
// 新增：IndexedDB 偏好设置 API
import { savePreference, loadPreference } from '../state/storage.js';

/**
 * 初始化输入框高度调整
 */
export async function initInputResize() {
    const handle = elements.inputResizeHandle;
    const textarea = elements.userInput;
    if (!handle || !textarea) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    // 从 IndexedDB 恢复高度
    try {
        let savedHeight = null;
        if (state.storageMode !== 'localStorage') {
            savedHeight = await loadPreference('inputTextareaHeight');
        }
        // 降级：从 localStorage 读取
        if (!savedHeight) {
            savedHeight = localStorage.getItem('inputTextareaHeight');
        }
        if (savedHeight) {
            textarea.style.height = savedHeight + 'px';
        }
    } catch (error) {
        console.error('恢复输入框高度失败:', error);
        const savedHeight = localStorage.getItem('inputTextareaHeight');
        if (savedHeight) {
            textarea.style.height = savedHeight + 'px';
        }
    }

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = textarea.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        // 向上拖动增加高度，向下拖动减小高度
        const deltaY = startY - e.clientY;
        const newHeight = Math.min(500, Math.max(24, startHeight + deltaY));
        textarea.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', async () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // 保存高度到存储
            const height = textarea.offsetHeight;
            try {
                if (state.storageMode !== 'localStorage') {
                    await savePreference('inputTextareaHeight', height);
                } else {
                    localStorage.setItem('inputTextareaHeight', height);
                }
            } catch (_error) {
                localStorage.setItem('inputTextareaHeight', height);
            }
        }
    });

    // 触摸支持
    handle.addEventListener('touchstart', (e) => {
        isResizing = true;
        startY = e.touches[0].clientY;
        startHeight = textarea.offsetHeight;
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isResizing) return;
        const deltaY = startY - e.touches[0].clientY;
        const newHeight = Math.min(500, Math.max(24, startHeight + deltaY));
        textarea.style.height = newHeight + 'px';
    }, { passive: true });

    document.addEventListener('touchend', async () => {
        if (isResizing) {
            isResizing = false;
            // 保存高度到存储
            const height = textarea.offsetHeight;
            try {
                if (state.storageMode !== 'localStorage') {
                    await savePreference('inputTextareaHeight', height);
                } else {
                    localStorage.setItem('inputTextareaHeight', height);
                }
            } catch (_error) {
                localStorage.setItem('inputTextareaHeight', height);
            }
        }
    });
}

/**
 * 初始化面板宽度调整
 */
export async function initPanelResize() {
    // 配置：[面板元素, 手柄ID, localStorage键, 最小宽度, 最大宽度, 方向（left/right）]
    const panels = [
        {
            panel: elements.settingsPanel,
            handleId: 'settings-resize-handle',
            storageKey: 'settingsPanelWidth',
            minWidth: 280,
            maxWidth: 600,
            side: 'right' // 从右侧，向左拖增加宽度
        },
        {
            panel: elements.sidebar,
            handleId: 'sidebar-resize-handle',
            storageKey: 'sidebarWidth',
            minWidth: 240,
            maxWidth: 500,
            side: 'left' // 从左侧，向右拖增加宽度
        }
    ];

    // 使用 for...of 以支持 async/await
    for (const { panel, handleId, storageKey, minWidth, maxWidth, side } of panels) {
        const handle = document.getElementById(handleId);
        if (!panel || !handle) continue;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        // 从 IndexedDB 恢复宽度
        try {
            let savedWidth = null;
            if (state.storageMode !== 'localStorage') {
                savedWidth = await loadPreference(storageKey);
            }
            // 降级：从 localStorage 读取
            if (!savedWidth) {
                savedWidth = localStorage.getItem(storageKey);
            }
            if (savedWidth) {
                const width = parseInt(savedWidth);
                if (width >= minWidth && width <= maxWidth) {
                    panel.style.width = width + 'px';
                }
            }
        } catch (error) {
            console.error(`恢复面板宽度失败 (${storageKey}):`, error);
            const savedWidth = localStorage.getItem(storageKey);
            if (savedWidth) {
                const width = parseInt(savedWidth);
                if (width >= minWidth && width <= maxWidth) {
                    panel.style.width = width + 'px';
                }
            }
        }

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            handle.classList.add('resizing');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // 计算 deltaX：右侧面板向左拖增加宽度，左侧面板向右拖增加宽度
            const deltaX = side === 'right'
                ? startX - e.clientX
                : e.clientX - startX;
            const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
            panel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', async () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                handle.classList.remove('resizing');
                // 保存宽度到存储
                const width = panel.offsetWidth;
                try {
                    if (state.storageMode !== 'localStorage') {
                        await savePreference(storageKey, width);
                    } else {
                        localStorage.setItem(storageKey, width);
                    }
                } catch (_error) {
                    localStorage.setItem(storageKey, width);
                }
            }
        });

        // 触摸支持
        handle.addEventListener('touchstart', (e) => {
            isResizing = true;
            startX = e.touches[0].clientX;
            startWidth = panel.offsetWidth;
            handle.classList.add('resizing');
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isResizing) return;
            const deltaX = side === 'right'
                ? startX - e.touches[0].clientX
                : e.touches[0].clientX - startX;
            const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
            panel.style.width = newWidth + 'px';
        }, { passive: true });

        document.addEventListener('touchend', async () => {
            if (isResizing) {
                isResizing = false;
                handle.classList.remove('resizing');
                // 保存宽度到存储
                const width = panel.offsetWidth;
                try {
                    if (state.storageMode !== 'localStorage') {
                        await savePreference(storageKey, width);
                    } else {
                        localStorage.setItem(storageKey, width);
                    }
                } catch (_error) {
                    localStorage.setItem(storageKey, width);
                }
            }
        });

        // 键盘支持（方向键调整宽度）
        handle.addEventListener('keydown', async (e) => {
            const step = e.shiftKey ? 20 : 10; // Shift键增加步长
            const currentWidth = panel.offsetWidth;
            let newWidth = currentWidth;

            // 左方向键减小宽度，右方向键增大宽度
            if (e.key === 'ArrowLeft') {
                newWidth = side === 'right' ? currentWidth + step : currentWidth - step;
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                newWidth = side === 'right' ? currentWidth - step : currentWidth + step;
                e.preventDefault();
            } else {
                return; // 其他键不处理
            }

            // 应用边界约束
            newWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
            panel.style.width = newWidth + 'px';

            // 保存到存储
            try {
                if (state.storageMode !== 'localStorage') {
                    await savePreference(storageKey, newWidth);
                } else {
                    localStorage.setItem(storageKey, newWidth);
                }
            } catch (_error) {
                localStorage.setItem(storageKey, newWidth);
            }

            // 更新ARIA属性（如果存在）
            if (handle.hasAttribute('aria-valuenow')) {
                handle.setAttribute('aria-valuenow', newWidth);
            }
        });
    }

    console.log('Panel resize initialized');
}
