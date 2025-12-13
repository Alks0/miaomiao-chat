const { contextBridge, ipcRenderer } = require('electron');

/**
 * 预加载脚本
 * 通过 contextBridge 安全地暴露 API 给渲染进程
 */
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * 手动检查更新
     */
    checkForUpdates: () => {
        ipcRenderer.send('check-for-updates');
    },

    /**
     * 设置静默更新模式
     * @param {boolean} enabled - 是否启用静默更新
     */
    setSilentUpdate: (enabled) => {
        ipcRenderer.send('set-silent-update', enabled);
    },

    /**
     * 保存设置到主进程
     * @param {Object} settings - 设置对象
     */
    saveSettings: (settings) => {
        ipcRenderer.send('save-settings', settings);
    },

    /**
     * 监听更新可用事件
     * @param {Function} callback - 回调函数，接收更新信息
     */
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, info) => callback(info));
    },

    /**
     * 下载更新（立刻更新模式）
     */
    downloadUpdate: () => {
        ipcRenderer.send('download-update');
    },

    /**
     * 下载更新（静默模式）
     */
    downloadUpdateSilent: () => {
        ipcRenderer.send('download-update-silent');
    },

    /**
     * 监听更新进度
     * @param {Function} callback - 回调函数，接收进度数据
     */
    onUpdateProgress: (callback) => {
        ipcRenderer.on('update-progress', (event, progress) => callback(progress));
    },

    /**
     * 监听更新下载完成
     * @param {Function} callback - 回调函数，接收更新信息
     */
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, info) => callback(info));
    },

    /**
     * 监听通知消息
     * @param {Function} callback - 回调函数，接收通知数据
     */
    onNotification: (callback) => {
        ipcRenderer.on('notification', (event, data) => callback(data));
    },

    /**
     * 获取应用版本号
     * @returns {string} 版本号
     */
    getVersion: () => {
        return require('../package.json').version;
    },

    /**
     * 检测是否在 Electron 环境
     * @returns {boolean}
     */
    isElectron: () => {
        return true;
    }
});
