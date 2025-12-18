/**
 * 更新弹窗模块
 * 处理自定义样式的更新提示弹窗
 */

import { showNotification } from '../ui/notifications.js';

let updateInfo = null;  // 存储更新信息

/**
 * 显示更新弹窗
 * @param {Object} info - 更新信息
 * @param {string} info.version - 新版本号
 * @param {string} info.releaseNotes - 更新说明
 */
export function showUpdateModal(info) {
    updateInfo = info;

    const overlay = document.getElementById('update-modal-overlay');
    const versionEl = document.getElementById('update-modal-version');
    const descriptionEl = document.getElementById('update-modal-description');

    if (!overlay) {
        console.error('[UpdateModal] 更新弹窗元素未找到');
        return;
    }

    // 设置内容
    if (versionEl) {
        versionEl.textContent = `v${info.version}`;
    }

    if (descriptionEl && info.releaseNotes) {
        descriptionEl.textContent = info.releaseNotes;
    }

    // 显示弹窗
    overlay.style.display = 'flex';

    console.log('[UpdateModal] 显示更新弹窗:', info);
}

/**
 * 隐藏更新弹窗
 */
export function hideUpdateModal() {
    const overlay = document.getElementById('update-modal-overlay');
    const progressContainer = document.getElementById('update-progress-container');

    if (overlay) {
        overlay.style.display = 'none';
    }

    // 重置进度条
    if (progressContainer) {
        progressContainer.style.display = 'none';
        updateProgress(0);
    }

    console.log('[UpdateModal] 隐藏更新弹窗');
}

/**
 * 更新下载进度
 * @param {number} percent - 进度百分比 (0-100)
 */
export function updateProgress(percent) {
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');

    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }

    if (progressText) {
        progressText.textContent = `正在下载... ${Math.round(percent)}%`;
    }
}

/**
 * 显示下载进度
 */
export function showProgress() {
    const progressContainer = document.getElementById('update-progress-container');
    const actionsContainer = document.querySelector('.update-modal-actions');

    if (progressContainer) {
        progressContainer.style.display = 'block';
    }

    // 隐藏按钮组
    if (actionsContainer) {
        actionsContainer.style.display = 'none';
    }
}

/**
 * 初始化更新弹窗
 */
export function initUpdateModal() {
    const closeBtn = document.getElementById('update-modal-close');
    const updateNowBtn = document.getElementById('update-now-btn');
    const updateSilentBtn = document.getElementById('update-silent-btn');
    const overlay = document.getElementById('update-modal-overlay');

    // 检测平台
    const isElectron = window.electronAPI && typeof window.electronAPI === 'object';
    const isAndroid = window.Capacitor && window.Capacitor.getPlatform() === 'android';

    if (!isElectron && !isAndroid) {
        console.log('[UpdateModal] 非 Electron/Android 环境，跳过初始化');
        return;
    }

    // 关闭按钮（通用）
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideUpdateModal();
            console.log('[UpdateModal] 用户选择：暂不更新');
        });
    }

    // 点击遮罩层关闭（通用）
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideUpdateModal();
            }
        });
    }

    // Android 平台初始化
    if (isAndroid) {
        console.log('[UpdateModal] Android 环境，绑定 APK 更新逻辑');

        // 立刻更新按钮
        if (updateNowBtn) {
            updateNowBtn.addEventListener('click', async () => {
                console.log('[UpdateModal] Android: 用户选择立刻更新');
                showProgress();

                try {
                    // 调用 apk-updater.js 的下载函数
                    const { downloadAndInstallAPK } = await import('./apk-updater.js');
                    const updateInfo = window._currentUpdateInfo; // 临时存储

                    if (!updateInfo || !updateInfo.downloadUrl || !updateInfo.fileName) {
                        showNotification('更新信息不可用，请重试', 'error');
                        hideUpdateModal();
                        return;
                    }

                    await downloadAndInstallAPK(updateInfo.downloadUrl, updateInfo.fileName, false, (progress) => {
                        if (progress.status === 'downloading') {
                            updateProgress(progress.percent);
                        } else if (progress.status === 'downloaded') {
                            const progressText = document.getElementById('update-progress-text');
                            if (progressText) {
                                progressText.textContent = '下载完成，准备安装...';
                            }
                            setTimeout(() => hideUpdateModal(), 3000);
                        } else if (progress.status === 'error') {
                            showNotification(`更新失败: ${progress.error}`, 'error');
                            hideUpdateModal();
                        }
                    });
                } catch (error) {
                    console.error('[UpdateModal] Android 更新异常:', error);
                    showNotification(`更新失败: ${error.message || '未知错误'}`, 'error');
                    hideUpdateModal();
                }
            });
        }

        // 静默更新按钮（Android 不支持真正的静默）
        if (updateSilentBtn) {
            updateSilentBtn.style.display = 'none'; // 隐藏静默按钮
        }

        console.log('Android update modal initialized');
        return; // 跳过 Electron 逻辑
    }

    // Electron 平台初始化（原有逻辑）
    if (isElectron) {
        // 立刻更新按钮
        if (updateNowBtn) {
        updateNowBtn.addEventListener('click', () => {
            console.log('[UpdateModal] 用户选择：立刻更新');

            // 显示进度条
            showProgress();

            // 通知主进程下载更新
            if (window.electronAPI && window.electronAPI.downloadUpdate) {
                window.electronAPI.downloadUpdate();
            }
        });
    }

    // 静默更新按钮
    if (updateSilentBtn) {
        updateSilentBtn.addEventListener('click', () => {
            console.log('[UpdateModal] 用户选择：静默更新');

            // 隐藏弹窗
            hideUpdateModal();

            // 通知主进程下载更新（静默模式）
            if (window.electronAPI && window.electronAPI.downloadUpdateSilent) {
                window.electronAPI.downloadUpdateSilent();
            }
        });
    }

    // 监听更新可用事件
    if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
        window.electronAPI.onUpdateAvailable((info) => {
            console.log('[UpdateModal] 收到更新可用事件:', info);
            showUpdateModal(info);
        });
    }

    // 监听下载进度
    if (window.electronAPI && window.electronAPI.onUpdateProgress) {
        window.electronAPI.onUpdateProgress((progress) => {
            console.log('[UpdateModal] 下载进度:', progress.percent + '%');
            updateProgress(progress.percent);
        });
    }

    // 监听下载完成
    if (window.electronAPI && window.electronAPI.onUpdateDownloaded) {
        window.electronAPI.onUpdateDownloaded((info) => {
            console.log('[UpdateModal] 更新下载完成:', info);

            const progressText = document.getElementById('update-progress-text');
            const progressContainer = document.getElementById('update-progress-container');
            const actionsContainer = document.querySelector('.update-modal-actions');

            if (progressText) {
                progressText.textContent = '下载完成！';
            }

            // 显示"立即重启安装"按钮
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }

            if (actionsContainer) {
                actionsContainer.style.display = 'flex';
                actionsContainer.innerHTML = `
                    <button id="install-restart-btn" class="update-modal-btn update-modal-btn-primary">
                        立即重启安装
                    </button>
                    <button id="install-later-btn" class="update-modal-btn">
                        稍后安装
                    </button>
                `;

                // 绑定按钮事件
                const installNowBtn = document.getElementById('install-restart-btn');
                const installLaterBtn = document.getElementById('install-later-btn');

                if (installNowBtn) {
                    installNowBtn.addEventListener('click', () => {
                        console.log('[UpdateModal] 用户选择：立即重启安装');
                        if (window.electronAPI && window.electronAPI.installUpdateAndRestart) {
                            window.electronAPI.installUpdateAndRestart();
                        }
                    });
                }

                if (installLaterBtn) {
                    installLaterBtn.addEventListener('click', () => {
                        console.log('[UpdateModal] 用户选择：稍后安装');
                        hideUpdateModal();
                    });
                }
            }
        });
    }

    console.log('Electron update modal initialized');
    }
}
