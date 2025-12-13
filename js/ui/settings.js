/**
 * 设置面板模块
 * 处理设置面板的显示和交互
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { saveCurrentConfig } from '../state/config.js';
import { savePreference, loadPreference } from '../state/storage.js';

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
 * 切换设置面板
 */
export function toggleSettings() {
    if (!elements.settingsPanel) return;

    const isOpening = !elements.settingsPanel.classList.contains('open');
    elements.settingsPanel.classList.toggle('open');

    // 控制 overlay 显示（不依赖 CSS，直接用 JS）
    const overlay = document.querySelector('.settings-overlay');
    if (overlay) {
        if (isOpening) {
            overlay.style.visibility = 'visible';
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'auto';
            overlay.style.zIndex = '100';  // 在设置面板(101)之下
        } else {
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
        }
    }

    if (isOpening) {
        // 打开时启用焦点陷阱
        trapFocus(elements.settingsPanel);
        // 禁用主内容的交互
        document.querySelector('.app-container')?.setAttribute('inert', '');
    } else {
        // 关闭时移除焦点陷阱
        removeFocusTrap(elements.settingsPanel);
        // 恢复主内容交互
        document.querySelector('.app-container')?.removeAttribute('inert');
        // 返回焦点到触发按钮
        elements.settingsToggle?.focus();
    }
}

/**
 * 初始化设置面板
 */
export function initSettings() {
    // 初始化 overlay 的初始状态
    const settingsOverlay = document.querySelector('.settings-overlay');
    if (settingsOverlay) {
        // 强制设置初始样式，覆盖所有CSS
        settingsOverlay.style.position = 'fixed';
        settingsOverlay.style.inset = '0';
        settingsOverlay.style.background = 'rgba(56, 56, 56, 0.6)';
        settingsOverlay.style.visibility = 'hidden';
        settingsOverlay.style.opacity = '0';
        settingsOverlay.style.pointerEvents = 'none';
        settingsOverlay.style.zIndex = '100';
        settingsOverlay.style.cursor = 'pointer';
        settingsOverlay.style.border = 'none';
        settingsOverlay.style.padding = '0';
        settingsOverlay.style.transition = 'opacity 0.2s ease-out, visibility 0.2s ease-out';

        // 使用事件捕获确保一定能接收到点击
        settingsOverlay.addEventListener('click', function(e) {
            console.log('🔵 Settings overlay clicked');
            e.stopPropagation();  // 阻止事件继续传播
            toggleSettings();
        }, true);  // true = 捕获阶段
    }

    // 绑定设置按钮
    if (elements.settingsToggle) {
        elements.settingsToggle.addEventListener('click', toggleSettings);
    }

    // 绑定关闭设置面板按钮
    if (elements.closeSettings) {
        elements.closeSettings.addEventListener('click', toggleSettings);
    }

    // 监听配置变更事件
    eventBus.on('config:loaded', () => {
        console.log('Config loaded in settings panel');
    });

    // 绑定配置输入框的自动保存
    elements.apiEndpoint?.addEventListener('input', saveCurrentConfig);
    elements.apiKey?.addEventListener('input', saveCurrentConfig);
    elements.modelSelect?.addEventListener('change', saveCurrentConfig);

    // 初始化更新设置（仅 Electron/APK）
    initUpdateSettings();

    console.log('✅ Settings panel initialized');
}

/**
 * 检测是否在 Electron 或 APK 环境
 */
function isElectron() {
    return window.electronAPI && window.electronAPI.isElectron && window.electronAPI.isElectron();
}

function isCapacitor() {
    return window.Capacitor !== undefined;
}

/**
 * 初始化更新设置
 */
async function initUpdateSettings() {
    const updateSettingsSection = document.getElementById('update-settings');
    if (!updateSettingsSection) return;

    // 仅在 Electron 或 Capacitor 环境显示
    if (!isElectron() && !isCapacitor()) {
        updateSettingsSection.style.display = 'none';
        return;
    }

    updateSettingsSection.style.display = 'block';

    // 获取 UI 元素
    const checkUpdateStartupToggle = document.getElementById('check-update-startup');
    const defaultSilentUpdateToggle = document.getElementById('default-silent-update');
    const manualCheckUpdateBtn = document.getElementById('manual-check-update-btn');
    const currentVersionNumber = document.getElementById('current-version-number');

    // 显示当前版本号
    if (isElectron() && window.electronAPI && window.electronAPI.getVersion) {
        const version = window.electronAPI.getVersion();
        if (currentVersionNumber) {
            currentVersionNumber.textContent = version;
        }
    } else if (window.Capacitor) {
        // Capacitor/APK 平台
        if (currentVersionNumber) {
            currentVersionNumber.textContent = '1.0.0'; // 从 package.json 读取
        }
    }

    // 从 IndexedDB 读取配置
    let appSettings = {};
    try {
        const settingsJson = await loadPreference('appSettings');
        if (settingsJson) {
            appSettings = JSON.parse(settingsJson);
        }
    } catch (err) {
        console.error('[Settings] 读取更新设置失败:', err);
    }

    // 初始化 UI 状态
    if (checkUpdateStartupToggle) {
        checkUpdateStartupToggle.checked = appSettings.checkUpdateOnStartup !== false; // 默认 true
    }

    if (defaultSilentUpdateToggle) {
        defaultSilentUpdateToggle.checked = appSettings.silentUpdate || false;
    }

    // 绑定"启动时检查更新"开关
    if (checkUpdateStartupToggle) {
        checkUpdateStartupToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            appSettings.checkUpdateOnStartup = enabled;

            // 保存到 IndexedDB
            try {
                await savePreference('appSettings', JSON.stringify(appSettings));
                console.log('[Settings] 启动检查更新设置已保存:', enabled);

                // Electron: 通知主进程
                if (isElectron() && window.electronAPI && window.electronAPI.saveSettings) {
                    window.electronAPI.saveSettings(appSettings);
                }
            } catch (err) {
                console.error('[Settings] 保存启动检查更新设置失败:', err);
            }
        });
    }

    // 绑定"默认静默更新"开关
    if (defaultSilentUpdateToggle) {
        defaultSilentUpdateToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            appSettings.silentUpdate = enabled;

            // 保存到 IndexedDB
            try {
                await savePreference('appSettings', JSON.stringify(appSettings));
                console.log('[Settings] 静默更新设置已保存:', enabled);

                // Electron: 立即通知主进程
                if (isElectron() && window.electronAPI) {
                    if (window.electronAPI.setSilentUpdate) {
                        window.electronAPI.setSilentUpdate(enabled);
                    }
                    if (window.electronAPI.saveSettings) {
                        window.electronAPI.saveSettings(appSettings);
                    }
                }
            } catch (err) {
                console.error('[Settings] 保存静默更新设置失败:', err);
            }
        });
    }

    // 绑定"立即检查更新"按钮
    if (manualCheckUpdateBtn) {
        manualCheckUpdateBtn.addEventListener('click', async () => {
            console.log('[Settings] 手动检查更新');

            if (isElectron() && window.electronAPI && window.electronAPI.checkForUpdates) {
                window.electronAPI.checkForUpdates();
            } else if (isCapacitor()) {
                // APK 平台的检查更新逻辑
                const { checkForUpdatesManually } = await import('../update/apk-updater.js');
                await checkForUpdatesManually();
            }
        });
    }

    // Electron: 监听更新进度
    if (isElectron() && window.electronAPI && window.electronAPI.onUpdateProgress) {
        window.electronAPI.onUpdateProgress((progress) => {
            console.log('[Settings] 更新进度:', progress.percent + '%');
            // 未来可以在 UI 显示进度条
        });
    }

    // Electron: 监听通知消息
    if (isElectron() && window.electronAPI && window.electronAPI.onNotification) {
        window.electronAPI.onNotification((data) => {
            console.log('[Settings] 更新通知:', data);
            // 未来可以显示 Toast 提示
        });
    }

    console.log('✅ Update settings initialized');
}
