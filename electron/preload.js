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
    },

    // ========== Computer Use API ==========

    /**
     * Computer Use: 更新权限
     * @param {Object} permissions - 权限对象
     */
    computerUse_updatePermissions: (permissions) => {
        return ipcRenderer.invoke('computer-use:update-permissions', permissions);
    },

    /**
     * Computer Use: 更新 Bash 配置
     * @param {Object} config - 配置对象
     */
    computerUse_updateBashConfig: (config) => {
        return ipcRenderer.invoke('computer-use:update-bash-config', config);
    },

    /**
     * Computer Use: 截图
     * @returns {Promise<{success: boolean, base64?: string, width?: number, height?: number}>}
     */
    computerUse_screenshot: () => {
        return ipcRenderer.invoke('computer-use:screenshot');
    },

    /**
     * Computer Use: 区域放大截图（zoom）
     * @param {number} x1 - 起始 X 坐标
     * @param {number} y1 - 起始 Y 坐标
     * @param {number} x2 - 结束 X 坐标
     * @param {number} y2 - 结束 Y 坐标
     * @returns {Promise<{success: boolean, base64?: string, width?: number, height?: number, region?: object}>}
     */
    computerUse_zoom: (x1, y1, x2, y2) => {
        return ipcRenderer.invoke('computer-use:zoom', { x1, y1, x2, y2 });
    },

    /**
     * Computer Use: 鼠标移动
     * @param {number} x - X 坐标
     * @param {number} y - Y 坐标
     */
    computerUse_moveMouse: (x, y) => {
        return ipcRenderer.invoke('computer-use:mouse-move', { x, y });
    },

    /**
     * Computer Use: 鼠标点击
     * @param {string} button - 'left' | 'right' | 'middle'
     */
    computerUse_clickMouse: (button = 'left') => {
        return ipcRenderer.invoke('computer-use:mouse-click', { button });
    },

    /**
     * Computer Use: 鼠标双击
     * @param {string} button - 'left' | 'right' | 'middle'
     */
    computerUse_doubleClickMouse: (button = 'left') => {
        return ipcRenderer.invoke('computer-use:mouse-double-click', { button });
    },

    /**
     * Computer Use: 鼠标三击
     * @param {string} button - 'left' | 'right' | 'middle'
     */
    computerUse_tripleClickMouse: (button = 'left') => {
        return ipcRenderer.invoke('computer-use:mouse-triple-click', { button });
    },

    /**
     * Computer Use: 鼠标拖拽
     * @param {number} fromX - 起始 X
     * @param {number} fromY - 起始 Y
     * @param {number} toX - 目标 X
     * @param {number} toY - 目标 Y
     */
    computerUse_dragMouse: (fromX, fromY, toX, toY) => {
        return ipcRenderer.invoke('computer-use:mouse-drag', { fromX, fromY, toX, toY });
    },

    /**
     * Computer Use: 鼠标滚轮
     * @param {number} amount - 滚动量（正数向下，负数向上）
     */
    computerUse_scrollMouse: (amount) => {
        return ipcRenderer.invoke('computer-use:mouse-scroll', { amount });
    },

    /**
     * Computer Use: 按下鼠标按钮（不释放）
     * @param {string} button - 'left' | 'right' | 'middle'
     */
    computerUse_pressMouseButton: (button = 'left') => {
        return ipcRenderer.invoke('computer-use:mouse-press-button', { button });
    },

    /**
     * Computer Use: 释放鼠标按钮
     * @param {string} button - 'left' | 'right' | 'middle'
     */
    computerUse_releaseMouseButton: (button = 'left') => {
        return ipcRenderer.invoke('computer-use:mouse-release-button', { button });
    },

    /**
     * Computer Use: 键盘输入
     * @param {string} text - 要输入的文本
     */
    computerUse_typeText: (text) => {
        return ipcRenderer.invoke('computer-use:keyboard-type', { text });
    },

    /**
     * Computer Use: 按键
     * @param {string} key - 按键名称
     * @param {string[]} modifiers - 修饰键数组
     */
    computerUse_pressKey: (key, modifiers = []) => {
        return ipcRenderer.invoke('computer-use:keyboard-press', { key, modifiers });
    },

    /**
     * Computer Use: 按住按键
     * @param {string} key - 按键名称
     */
    computerUse_holdKey: (key) => {
        return ipcRenderer.invoke('computer-use:keyboard-hold', { key });
    },

    /**
     * Computer Use: 释放按键
     * @param {string} key - 按键名称
     */
    computerUse_releaseKey: (key) => {
        return ipcRenderer.invoke('computer-use:keyboard-release', { key });
    },

    /**
     * Computer Use: 获取显示器信息
     * @returns {Promise<{success: boolean, displays?: Array}>}
     */
    computerUse_getDisplayInfo: () => {
        return ipcRenderer.invoke('computer-use:get-display-info');
    },

    /**
     * Computer Use: 获取光标位置
     * @returns {Promise<{success: boolean, x?: number, y?: number}>}
     */
    computerUse_getCursorPosition: () => {
        return ipcRenderer.invoke('computer-use:get-cursor-position');
    },

    /**
     * Computer Use: 执行 Bash 命令
     * @param {string} command - 命令字符串
     * @returns {Promise<{success: boolean, stdout?: string, stderr?: string, exitCode?: number}>}
     */
    computerUse_executeBash: (command) => {
        return ipcRenderer.invoke('computer-use:bash-execute', { command });
    },

    /**
     * Computer Use: 读取文件
     * @param {string} path - 文件路径
     * @returns {Promise<{success: boolean, content?: string, size?: number}>}
     */
    computerUse_readFile: (path) => {
        return ipcRenderer.invoke('computer-use:file-read', { path });
    },

    /**
     * Computer Use: 写入文件
     * @param {string} path - 文件路径
     * @param {string} content - 文件内容
     * @returns {Promise<{success: boolean, path?: string, size?: number}>}
     */
    computerUse_writeFile: (path, content) => {
        return ipcRenderer.invoke('computer-use:file-write', { path, content });
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
            // ✅ 使用前缀匹配白名单（更灵活，支持 MCP 和 Computer Use）
            const allowedPrefixes = [
                'mcp:',           // MCP 相关通道
                'computer-use:'   // Computer Use 相关通道
            ];

            const isAllowed = allowedPrefixes.some(prefix => channel.startsWith(prefix));

            if (isAllowed) {
                return ipcRenderer.invoke(channel, data);
            } else {
                console.error(`[IPC Security] 拒绝访问不允许的通道: ${channel}`);
                return Promise.reject(new Error(`不允许的 IPC 通道: ${channel}`));
            }
        },

        /**
         * 监听主进程事件
         * @param {string} channel - IPC 通道
         * @param {Function} callback - 回调函数
         */
        on: (channel, callback) => {
            // ✅ 使用前缀匹配白名单
            const allowedPrefixes = [
                'mcp:',           // MCP 事件
                'computer-use:'   // Computer Use 事件
            ];

            const isAllowed = allowedPrefixes.some(prefix => channel.startsWith(prefix));

            if (isAllowed) {
                ipcRenderer.on(channel, (event, ...args) => callback(...args));
            } else {
                console.error(`[IPC Security] 拒绝监听不允许的通道: ${channel}`);
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
