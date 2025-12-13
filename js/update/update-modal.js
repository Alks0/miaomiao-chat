/**
 * 更新弹窗模块
 * 处理自定义样式的更新提示弹窗
 */

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

    // 检测是否在 Electron 环境
    const isElectron = window.electronAPI && typeof window.electronAPI === 'object';

    if (!isElectron) {
        console.log('[UpdateModal] 非 Electron 环境，跳过初始化');
        return;
    }

    // 关闭按钮
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideUpdateModal();
            console.log('[UpdateModal] 用户选择：暂不更新（点击关闭）');
        });
    }

    // 点击遮罩层关闭
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideUpdateModal();
                console.log('[UpdateModal] 用户选择：暂不更新（点击遮罩）');
            }
        });
    }

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
            if (progressText) {
                progressText.textContent = '下载完成！应用将在下次启动时自动安装';
            }

            // 3 秒后自动关闭弹窗
            setTimeout(() => {
                hideUpdateModal();
            }, 3000);
        });
    }

    console.log('✅ Update modal initialized');
}
