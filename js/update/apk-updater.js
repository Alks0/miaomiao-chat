/**
 * APK 更新模块
 * 处理 Android APK 的热更新功能
 */

import { loadPreference } from '../state/storage.js';
import { showNotification } from '../ui/notifications.js';

// Capacitor Filesystem 插件（通过全局对象访问）
const getFilesystem = () => window.Capacitor?.Plugins?.Filesystem;

// 获取自定义 AndroidInstaller 插件（通过全局对象访问）
// Java 端用 @CapacitorPlugin 注册的插件会自动暴露在 Plugins 中
const getAndroidInstaller = () => window.Capacitor?.Plugins?.AndroidInstaller;

// GitHub 仓库配置
const GITHUB_OWNER = 'Alks0';
const GITHUB_REPO = 'miaomiao-chat';
const GITHUB_API_BASE = 'https://api.github.com';
const UPDATE_CHECK_URL = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// 当前应用版本（运行时从 Capacitor 获取）
const CURRENT_VERSION = '1.1.7'; // 默认值

/**
 * 获取当前应用版本号
 * @returns {Promise<string>} 版本号
 */
async function getCurrentVersion() {
    try {
        if (window.Capacitor && window.Capacitor.Plugins.App) {
            const { App } = window.Capacitor.Plugins;
            const info = await App.getInfo();
            return info.version;
        }
    } catch (error) {
        console.warn('[APK Updater] 获取版本号失败,使用默认值:', error);
    }
    return CURRENT_VERSION; // 降级到默认值
}

/**
 * 检查是否有新版本
 * @returns {Promise<Object|null>} 更新信息或 null
 */
export async function checkForUpdates() {
    try {
        console.log('[APK Updater] 检查更新...');

        const response = await fetch(UPDATE_CHECK_URL);

        if (!response.ok) {
            console.error('[APK Updater] GitHub API 错误:', response.status);
            return null;
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, ''); // 移除 'v' 前缀

        // 获取当前版本号
        const currentVersion = await getCurrentVersion();
        console.log('[APK Updater] 当前版本:', currentVersion);
        console.log('[APK Updater] 最新版本:', latestVersion);

        // 比较版本号
        if (compareVersions(latestVersion, currentVersion) > 0) {
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
                fileName: apkAsset.name,  // 直接使用 asset 名称
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
 * @param {string} fileName - APK 文件名（从 GitHub API 获取）
 * @param {boolean} silent - 是否静默模式
 * @param {Function} onProgress - 进度回调
 */
export async function downloadAndInstallAPK(downloadUrl, fileName, silent = false, onProgress = null) {
    try {
        console.log('[APK Updater] 开始下载 APK:', downloadUrl);

        if (onProgress) {
            onProgress({ status: 'downloading', percent: 0 });
        }

        const Filesystem = getFilesystem();
        if (!Filesystem) {
            throw new Error('Filesystem plugin not available');
        }

        // 方案1：尝试使用 Capacitor HTTP 原生下载（绕过 CORS）
        let blob;
        try {
            // Capacitor 4+ 的 HTTP API 在核心包中
            const { Http } = window.Capacitor.Plugins;

            if (Http && Http.downloadFile) {
                console.log('[APK Updater] 使用 Capacitor HTTP 原生下载');

                const fileName = `webchat-update-${Date.now()}.apk`;
                const result = await Http.downloadFile({
                    url: downloadUrl,
                    filePath: fileName,
                    fileDirectory: 'CACHE'
                });

                console.log('[APK Updater] 原生下载完成:', result.path);

                if (onProgress) {
                    onProgress({ status: 'downloaded', percent: 100 });
                }

                // 安装 APK
                await installAPK(result.path, silent);
                return;
            }
        } catch (httpError) {
            console.warn('[APK Updater] Capacitor HTTP 不可用，降级到代理下载:', httpError);
        }

        // 方案2：使用代理下载（绕过 CORS 限制）
        // GitHub Releases 的直接下载会遇到 CORS 问题
        // Worker 支持格式: /download/{filename}
        // 使用传入的 fileName（从 GitHub API 获取的真实文件名）
        const proxyUrl = `https://dawn-feather-d2e6.alks2636777.workers.dev/download/${fileName}`;

        console.log('[APK Updater] 使用代理下载 APK:', proxyUrl);

        const response = await fetch(proxyUrl, {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
        }

        blob = await response.blob();
        console.log('[APK Updater] 下载完成，大小:', blob.size, 'bytes');

        // 转换为 Base64
        const reader = new FileReader();

        reader.onloadend = async () => {
            try {
                const base64Data = reader.result.split(',')[1];

                const fileName = `webchat-update-${Date.now()}.apk`;
                const fileResult = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: 'CACHE'
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

        // 健壮的错误消息提取
        let errorDetail = '';
        if (error instanceof TypeError) {
            errorDetail = error.message || '网络请求失败 (TypeError)';
        } else if (error instanceof Error) {
            errorDetail = error.message || error.toString();
        } else {
            errorDetail = String(error) || '未知错误';
        }

        const errorMsg = `下载失败: ${errorDetail}\n\n可能原因:\n1. 网络连接问题\n2. GitHub 访问受限\n3. 代理服务不可用\n\n建议: 请手动下载 APK 文件安装`;

        if (onProgress) {
            onProgress({ status: 'error', error: errorMsg });
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

        // 使用全局 Capacitor 对象访问插件
        const installer = getAndroidInstaller();
        if (!installer) {
            throw new Error('AndroidInstaller plugin not available');
        }

        // 检查安装权限
        const permissionResult = await installer.checkInstallPermission();
        if (!permissionResult.granted) {
            console.warn('[APK Updater] 缺少安装权限，请求权限...');
            await installer.requestInstallPermission();

            // ⚠️ 权限请求会跳转到系统设置，用户需要手动授权
            // 此时应该停止安装流程，提示用户授权后重新下载
            throw new Error('需要安装权限。请在系统设置中允许"安装未知应用"，然后重新下载更新。');
        }

        // 安装 APK
        await installer.installAPK({ uri: fileUri });

        console.log('[APK Updater] 安装请求已发送');
    } catch (error) {
        console.error('[APK Updater] 安装失败:', error);
        throw error;
    }
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
                await downloadAndInstallAPK(updateInfo.downloadUrl, updateInfo.fileName, true);
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
async function showUpdateDialog(updateInfo) {
    // 存储更新信息供 update-modal.js 使用
    window._currentUpdateInfo = updateInfo;

    // 调用统一的 UI 模块
    const { showUpdateModal } = await import('./update-modal.js');
    showUpdateModal({
        version: updateInfo.version,
        releaseNotes: updateInfo.releaseNotes
    });

    console.log('[APK Updater] 显示更新弹窗');
}

/**
 * 手动检查更新（从设置面板调用）
 */
export async function checkForUpdatesManually() {
    const updateInfo = await checkForUpdates();

    if (updateInfo) {
        showUpdateDialog(updateInfo);
    } else {
        showNotification('当前已是最新版本！', 'info');
    }
}
