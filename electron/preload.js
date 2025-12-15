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
     * 立即安装更新并重启应用
     */
    installUpdateAndRestart: () => {
        ipcRenderer.send('install-update');
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
     * @returns {Promise<string>} 版本号
     */
    getVersion: () => {
        return ipcRenderer.invoke('get-app-version');
    },

    /**
     * 检测是否在 Electron 环境
     * @returns {boolean}
     */
    isElectron: () => {
        return true;
    }
});

/**
 * 暴露 electron 对象（用于 MCP 客户端）
 * 提供对 IPC 的访问
 */
contextBridge.exposeInMainWorld('electron', {
    /**
     * ipcRenderer 封装
     */
    ipcRenderer: {
        /**
         * 调用主进程方法
         * @param {string} channel - IPC 通道
         * @param {any} data - 数据
         * @returns {Promise<any>}
         */
        invoke: (channel, data) => {
            // 白名单：只允许特定的 MCP 通道
            const allowedChannels = [
                'mcp:connect',
                'mcp:disconnect',
                'mcp:list-tools',
                'mcp:call-tool',
                'mcp:status'
            ];

            if (allowedChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            } else {
                return Promise.reject(new Error(`不允许的 IPC 通道: ${channel}`));
            }
        },

        /**
         * 监听主进程事件
         * @param {string} channel - IPC 通道
         * @param {Function} callback - 回调函数
         */
        on: (channel, callback) => {
            const allowedChannels = [
                'mcp:server-started',
                'mcp:server-stopped',
                'mcp:server-error',
                'mcp:notification'
            ];

            if (allowedChannels.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => callback(...args));
            }
        },

        /**
         * 移除事件监听器
         * @param {string} channel - IPC 通道
         * @param {Function} callback - 回调函数
         */
        removeListener: (channel, callback) => {
            ipcRenderer.removeListener(channel, callback);
        }
    }
});
