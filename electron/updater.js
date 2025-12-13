const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

let mainWindow = null;
let silentUpdate = false;
let checkUpdateOnStartup = true;
let updateServerUrl = null;

/**
 * 初始化更新器
 * @param {BrowserWindow} win - 主窗口实例
 * @param {Object} options - 配置选项
 * @param {boolean} options.silentUpdate - 是否静默更新
 * @param {boolean} options.checkUpdateOnStartup - 启动时是否检查更新
 * @param {string} options.updateServerUrl - 自定义更新服务器 URL
 */
function initUpdater(win, options = {}) {
    mainWindow = win;
    silentUpdate = options.silentUpdate || false;
    checkUpdateOnStartup = options.checkUpdateOnStartup !== false;
    updateServerUrl = options.updateServerUrl || null;

    // 配置日志
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    // 配置更新服务器（如果有自定义）
    if (updateServerUrl) {
        autoUpdater.setFeedURL(updateServerUrl);
    }

    // 禁用自动下载，手动控制下载流程
    autoUpdater.autoDownload = false;

    // 监听更新事件
    setupUpdateListeners();

    // 启动时检查更新
    if (checkUpdateOnStartup) {
        setTimeout(() => {
            checkForUpdates();
        }, 3000); // 延迟 3 秒，确保窗口已完全加载
    }
}

/**
 * 设置更新事件监听器
 */
function setupUpdateListeners() {
    // 检查更新出错
    autoUpdater.on('error', (err) => {
        log.error('[Updater] 更新错误:', err);
        sendNotification({
            type: 'error',
            title: '更新失败',
            message: `更新过程中出错: ${err.message}`
        });
    });

    // 检查更新中
    autoUpdater.on('checking-for-update', () => {
        log.info('[Updater] 正在检查更新...');
    });

    // 发现新版本
    autoUpdater.on('update-available', (info) => {
        log.info('[Updater] 发现新版本:', info.version);

        if (silentUpdate) {
            // 静默模式：直接后台下载
            log.info('[Updater] 静默模式：开始后台下载');
            autoUpdater.downloadUpdate();
            sendNotification({
                type: 'info',
                title: '发现新版本',
                message: `v${info.version} 正在后台下载，下次启动时自动安装`
            });
        } else {
            // 交互模式：显示更新弹窗
            showUpdateDialog(info);
        }
    });

    // 当前已是最新版本
    autoUpdater.on('update-not-available', (info) => {
        log.info('[Updater] 当前已是最新版本:', info.version);
    });

    // 下载进度
    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        log.info(`[Updater] 下载进度: ${percent}%`);

        // 发送进度到渲染进程
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('update-progress', {
                percent: percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            });
        }
    });

    // 下载完成
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] 更新下载完成:', info.version);

        // 发送下载完成事件到渲染进程
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('update-downloaded', {
                version: info.version,
                releaseNotes: info.releaseNotes
            });
        }

        // 通知用户
        sendNotification({
            type: 'success',
            title: '更新已下载',
            message: `v${info.version} 将在下次启动时自动安装`
        });
    });
}

/**
 * ✅ 显示更新弹窗（通过渲染进程的自定义 UI）
 *
 * 交互说明：
 * 1. 发送 'update-available' 事件到渲染进程
 * 2. 渲染进程显示自定义弹窗
 * 3. 用户选择后，渲染进程通过 IPC 通知主进程
 */
function showUpdateDialog(info) {
    log.info('[Updater] 发送更新可用事件到渲染进程');

    // 发送更新信息到渲染进程
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-available', {
            version: info.version,
            releaseNotes: info.releaseNotes || '建议您更新到最新版本以获得更好的体验'
        });
    }
}

/**
 * 手动检查更新
 */
function checkForUpdates() {
    log.info('[Updater] 手动检查更新...');
    autoUpdater.checkForUpdates().catch(err => {
        log.error('[Updater] 检查更新失败:', err);
        sendNotification({
            type: 'error',
            title: '检查更新失败',
            message: '无法连接到更新服务器，请检查网络连接'
        });
    });
}

/**
 * 手动检查更新（带用户反馈）
 */
function checkForUpdatesManually() {
    log.info('[Updater] 用户手动检查更新');

    sendNotification({
        type: 'info',
        title: '检查更新',
        message: '正在检查更新...'
    });

    // 临时监听"无更新"事件，给用户反馈
    const onNoUpdate = (info) => {
        sendNotification({
            type: 'success',
            title: '已是最新版本',
            message: `当前版本 v${info.version} 已是最新`
        });
        autoUpdater.removeListener('update-not-available', onNoUpdate);
    };

    autoUpdater.once('update-not-available', onNoUpdate);
    checkForUpdates();
}

/**
 * ✅ 新增：更新静默模式设置（运行时调用）
 * @param {boolean} enabled - 是否启用静默更新
 */
function setSilentUpdate(enabled) {
    silentUpdate = enabled;
    log.info(`[Updater] 静默模式已${enabled ? '启用' : '禁用'}`);
}

/**
 * 发送通知到渲染进程
 */
function sendNotification(data) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('notification', data);
    }
}

module.exports = {
    initUpdater,
    checkForUpdatesManually,
    setSilentUpdate  // ✅ 新增导出
};
