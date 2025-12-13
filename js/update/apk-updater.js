/**
 * APK 更新模块
 * 处理 Android APK 的热更新功能
 */

import { loadPreference } from '../state/storage.js';

// Capacitor Filesystem 插件（通过全局对象访问）
const getFilesystem = () => window.Capacitor?.Plugins?.Filesystem;

// GitHub 仓库配置
const GITHUB_OWNER = 'odysseiaDev';
const GITHUB_REPO = 'webchat';
const GITHUB_API_BASE = 'https://api.github.com';

// 当前应用版本（从 package.json）
const CURRENT_VERSION = '1.0.0';

/**
 * 检查是否有新版本
 * @returns {Promise<Object|null>} 更新信息或 null
 */
export async function checkForUpdates() {
    try {
        console.log('[APK Updater] 检查更新...');

        const response = await fetch(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);

        if (!response.ok) {
            console.error('[APK Updater] GitHub API 错误:', response.status);
            return null;
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, ''); // 移除 'v' 前缀

        console.log('[APK Updater] 当前版本:', CURRENT_VERSION);
        console.log('[APK Updater] 最新版本:', latestVersion);

        // 比较版本号
        if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
            // 查找 APK 文件
            const apkAsset = data.assets.find(asset => asset.name.endsWith('.apk'));

            if (!apkAsset) {
                console.warn('[APK Updater] 未找到 APK 文件');
                return null;
            }

            return {
                version: latestVersion,
                releaseNotes: data.body || '查看 GitHub 了解更新内容',
                downloadUrl: apkAsset.browser_download_url,
                fileSize: apkAsset.size
            };
        }

        console.log('[APK Updater] 已是最新版本');
        return null;
    } catch (error) {
        console.error('[APK Updater] 检查更新失败:', error);
        return null;
    }
}

/**
 * 比较版本号
 * @param {string} v1 - 版本1
 * @param {string} v2 - 版本2
 * @returns {number} 1 表示 v1 > v2, -1 表示 v1 < v2, 0 表示相等
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}

/**
 * 下载并安装 APK
 * @param {string} downloadUrl - APK 下载地址
 * @param {boolean} silent - 是否静默模式
 * @param {Function} onProgress - 进度回调
 */
export async function downloadAndInstallAPK(downloadUrl, silent = false, onProgress = null) {
    try {
        console.log('[APK Updater] 开始下载 APK:', downloadUrl);

        // 显示下载中状态
        if (onProgress) {
            onProgress({ status: 'downloading', percent: 0 });
        }

        // 使用 Fetch API 下载文件
        const response = await fetch(downloadUrl);

        if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`);
        }

        const blob = await response.blob();
        const reader = new FileReader();

        reader.onloadend = async () => {
            try {
                const base64Data = reader.result.split(',')[1];

                // 保存到缓存目录
                const Filesystem = getFilesystem();
                if (!Filesystem) {
                    throw new Error('Filesystem plugin not available');
                }

                const fileName = `webchat-update-${Date.now()}.apk`;
                const fileResult = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: 'CACHE' // 使用字符串代替 Directory 枚举
                });

                console.log('[APK Updater] APK 已保存:', fileResult.uri);

                if (onProgress) {
                    onProgress({ status: 'downloaded', percent: 100 });
                }

                // 安装 APK
                await installAPK(fileResult.uri, silent);
            } catch (error) {
                console.error('[APK Updater] 保存 APK 失败:', error);
                if (onProgress) {
                    onProgress({ status: 'error', error: error.message });
                }
            }
        };

        reader.onerror = (error) => {
            console.error('[APK Updater] 读取文件失败:', error);
            if (onProgress) {
                onProgress({ status: 'error', error: '文件读取失败' });
            }
        };

        reader.readAsDataURL(blob);
    } catch (error) {
        console.error('[APK Updater] 下载失败:', error);
        if (onProgress) {
            onProgress({ status: 'error', error: error.message });
        }
    }
}

/**
 * 安装 APK
 * @param {string} fileUri - APK 文件 URI
 * @param {boolean} silent - 是否静默模式
 */
async function installAPK(fileUri, silent) {
    try {
        console.log('[APK Updater] 准备安装 APK:', fileUri);

        // 检查安装权限
        if (!await checkInstallPermission()) {
            console.warn('[APK Updater] 缺少安装权限，请求权限...');
            await requestInstallPermission();
        }

        // 创建安装 Intent（通过 Capacitor 插件或 WebView 接口）
        // 注意：这需要自定义 Capacitor 插件或使用第三方插件
        // 这里提供接口设计，实际实现需要 native 代码

        if (window.AndroidInstaller) {
            // 如果有自定义安装器插件
            await window.AndroidInstaller.installAPK({ uri: fileUri, silent });
        } else {
            // 降级方案：打开文件（需要用户手动确认）
            window.open(fileUri, '_system');
        }

        console.log('[APK Updater] 安装请求已发送');
    } catch (error) {
        console.error('[APK Updater] 安装失败:', error);
        throw error;
    }
}

/**
 * 检查安装权限（Android 8.0+）
 * @returns {Promise<boolean>}
 */
async function checkInstallPermission() {
    if (window.AndroidInstaller && window.AndroidInstaller.checkInstallPermission) {
        return await window.AndroidInstaller.checkInstallPermission();
    }
    // 默认假设有权限
    return true;
}

/**
 * 请求安装权限
 * @returns {Promise<boolean>}
 */
async function requestInstallPermission() {
    if (window.AndroidInstaller && window.AndroidInstaller.requestInstallPermission) {
        return await window.AndroidInstaller.requestInstallPermission();
    }
    return true;
}

/**
 * 初始化 APK 更新器
 * 在应用启动时调用
 */
export async function initAPKUpdater() {
    // 仅在 Android 平台运行
    if (!window.Capacitor || window.Capacitor.getPlatform() !== 'android') {
        console.log('[APK Updater] 非 Android 平台，跳过');
        return;
    }

    console.log('[APK Updater] 初始化...');

    // 读取配置
    const settingsJson = await loadPreference('appSettings');
    const appSettings = settingsJson ? JSON.parse(settingsJson) : {};

    const checkOnStartup = appSettings.checkUpdateOnStartup !== false; // 默认开启
    const silentUpdate = appSettings.silentUpdate || false;

    if (checkOnStartup) {
        console.log('[APK Updater] 启动时检查更新...');

        const updateInfo = await checkForUpdates();

        if (updateInfo) {
            if (silentUpdate) {
                // 静默更新
                console.log('[APK Updater] 静默更新模式，开始下载...');
                await downloadAndInstallAPK(updateInfo.downloadUrl, true);
            } else {
                // 显示更新弹窗
                showUpdateDialog(updateInfo);
            }
        }
    }
}

/**
 * 显示更新对话框
 * @param {Object} updateInfo - 更新信息
 */
function showUpdateDialog(updateInfo) {
    // 复用 Electron 的更新弹窗
    const overlay = document.getElementById('update-modal-overlay');
    const versionEl = document.getElementById('update-modal-version');
    const notesEl = document.getElementById('update-modal-notes');
    const nowBtn = document.getElementById('update-now-btn');
    const silentBtn = document.getElementById('update-silent-btn');
    const closeBtn = document.getElementById('update-modal-close');
    const progressContainer = document.getElementById('update-progress-container');

    if (!overlay) {
        console.error('[APK Updater] 找不到更新弹窗元素');
        return;
    }

    // 设置内容
    versionEl.textContent = `v${updateInfo.version}`;
    notesEl.textContent = updateInfo.releaseNotes;

    // 显示弹窗
    overlay.style.display = 'flex';

    // 立刻更新按钮
    const handleNowClick = () => {
        console.log('[APK Updater] 用户选择：立刻更新');
        nowBtn.disabled = true;
        silentBtn.disabled = true;
        closeBtn.disabled = true;

        downloadAndInstallAPK(updateInfo.downloadUrl, false, (progress) => {
            if (progress.status === 'downloading') {
                progressContainer.style.display = 'block';
                const fillEl = progressContainer.querySelector('.update-progress-fill');
                const textEl = progressContainer.querySelector('.update-progress-text');
                if (fillEl) fillEl.style.width = `${progress.percent}%`;
                if (textEl) textEl.textContent = `下载中... ${progress.percent}%`;
            } else if (progress.status === 'downloaded') {
                const textEl = progressContainer.querySelector('.update-progress-text');
                if (textEl) textEl.textContent = '下载完成，准备安装...';
                // 3秒后关闭弹窗
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 3000);
            } else if (progress.status === 'error') {
                alert(`更新失败: ${progress.error}`);
                overlay.style.display = 'none';
            }
        });
    };

    // 静默更新按钮
    const handleSilentClick = () => {
        console.log('[APK Updater] 用户选择：静默更新');
        overlay.style.display = 'none';
        downloadAndInstallAPK(updateInfo.downloadUrl, true);
    };

    // 关闭按钮
    const handleCloseClick = () => {
        console.log('[APK Updater] 用户关闭更新弹窗');
        overlay.style.display = 'none';
    };

    // 绑定事件（移除旧监听器）
    nowBtn.replaceWith(nowBtn.cloneNode(true));
    silentBtn.replaceWith(silentBtn.cloneNode(true));
    closeBtn.replaceWith(closeBtn.cloneNode(true));

    document.getElementById('update-now-btn').addEventListener('click', handleNowClick);
    document.getElementById('update-silent-btn').addEventListener('click', handleSilentClick);
    document.getElementById('update-modal-close').addEventListener('click', handleCloseClick);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) handleCloseClick();
    });
}

/**
 * 手动检查更新（从设置面板调用）
 */
export async function checkForUpdatesManually() {
    const updateInfo = await checkForUpdates();

    if (updateInfo) {
        showUpdateDialog(updateInfo);
    } else {
        alert('当前已是最新版本！');
    }
}
