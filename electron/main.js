const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initUpdater, checkForUpdatesManually, setSilentUpdate, quitAndInstall } = require('./updater');
const { mcpManager } = require('./mcp-manager');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });

    mainWindow.loadFile('index.html');

    // 开发模式：打开 DevTools
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    // ✅ 读取用户设置（从渲染进程的 IndexedDB/localStorage）
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(`
            (async () => {
                // 优先从 IndexedDB 读取
                try {
                    const { loadPreference } = await import('./js/state/storage.js');
                    const settingsJson = await loadPreference('appSettings');
                    return settingsJson ? JSON.parse(settingsJson) : {};
                } catch (e) {
                    // 降级：从 localStorage 读取
                    return JSON.parse(localStorage.getItem('appSettings') || '{}');
                }
            })()
        `).then(settings => {
            console.log('[Main] 读取到用户设置:', settings);

            // 初始化更新器
            initUpdater(mainWindow, {
                silentUpdate: settings.silentUpdate || false,
                checkUpdateOnStartup: settings.checkUpdateOnStartup !== false,
                updateServerUrl: settings.updateServerUrl || null
            });
        }).catch(err => {
            console.error('[Main] 读取设置失败，使用默认值:', err);
            initUpdater(mainWindow, {});
        });
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// ✅ IPC：手动检查更新
ipcMain.on('check-for-updates', () => {
    checkForUpdatesManually();
});

// ✅ IPC：设置静默更新模式
ipcMain.on('set-silent-update', (event, enabled) => {
    setSilentUpdate(enabled);
});

// ✅ IPC：保存设置
ipcMain.on('save-settings', (event, settings) => {
    // 立即应用静默更新设置
    if (typeof settings.silentUpdate === 'boolean') {
        setSilentUpdate(settings.silentUpdate);
    }
    console.log('[Main] 保存设置:', settings);
});

// ✅ IPC：获取应用版本号
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// ✅ IPC：下载更新（立刻更新）
ipcMain.on('download-update', () => {
    console.log('[Main] 用户选择：立刻更新');
    const { autoUpdater } = require('electron-updater');
    autoUpdater.downloadUpdate();
});

// ✅ IPC：下载更新（静默模式）
ipcMain.on('download-update-silent', () => {
    console.log('[Main] 用户选择：静默更新');
    const { autoUpdater } = require('electron-updater');
    autoUpdater.downloadUpdate();
});

// ✅ IPC：立即安装更新并重启
ipcMain.on('install-update', () => {
    console.log('[Main] 用户选择：立即安装更新');
    quitAndInstall();  // ✅ 调用 updater.js 的导出函数
});

// ========== MCP IPC 处理器 ==========

/**
 * IPC: 连接到 MCP 服务器
 */
ipcMain.handle('mcp:connect', async (event, config) => {
    try {
        console.log('[Main] MCP 连接请求:', config);
        const result = await mcpManager.startServer(config);
        return result;
    } catch (error) {
        console.error('[Main] MCP 连接失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 断开 MCP 服务器
 */
ipcMain.handle('mcp:disconnect', async (event, { serverId }) => {
    try {
        console.log('[Main] MCP 断开请求:', serverId);
        await mcpManager.stopServer(serverId);
        return { success: true };
    } catch (error) {
        console.error('[Main] MCP 断开失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 列出 MCP 工具
 */
ipcMain.handle('mcp:list-tools', async (event, { serverId }) => {
    try {
        console.log('[Main] MCP 列出工具:', serverId);
        const result = await mcpManager.sendRequest(serverId, 'tools/list');
        return { success: true, tools: result.tools || [] };
    } catch (error) {
        console.error('[Main] MCP 列出工具失败:', error);
        return { success: false, error: error.message, tools: [] };
    }
});

/**
 * IPC: 调用 MCP 工具
 */
ipcMain.handle('mcp:call-tool', async (event, { serverId, toolName, arguments: args }) => {
    try {
        console.log('[Main] MCP 调用工具:', { serverId, toolName });
        const result = await mcpManager.sendRequest(serverId, 'tools/call', {
            name: toolName,
            arguments: args
        });
        return result;
    } catch (error) {
        console.error('[Main] MCP 调用工具失败:', error);
        throw error;
    }
});

/**
 * IPC: 获取 MCP 状态
 */
ipcMain.handle('mcp:status', async (event, { serverId }) => {
    try {
        if (serverId) {
            const status = mcpManager.getStatus(serverId);
            return { success: true, status };
        } else {
            const statuses = mcpManager.getAllStatus();
            return { success: true, statuses };
        }
    } catch (error) {
        console.error('[Main] MCP 获取状态失败:', error);
        return { success: false, error: error.message };
    }
});

// 监听 MCP 管理器事件，转发到渲染进程
mcpManager.on('server-started', (data) => {
    if (mainWindow) {
        mainWindow.webContents.send('mcp:server-started', data);
    }
});

mcpManager.on('server-stopped', (data) => {
    if (mainWindow) {
        mainWindow.webContents.send('mcp:server-stopped', data);
    }
});

mcpManager.on('server-error', (data) => {
    if (mainWindow) {
        mainWindow.webContents.send('mcp:server-error', data);
    }
});

mcpManager.on('notification', (data) => {
    if (mainWindow) {
        mainWindow.webContents.send('mcp:notification', data);
    }
});

// 应用退出时清理所有 MCP 进程
app.on('before-quit', async () => {
    console.log('[Main] 应用退出，停止所有 MCP 服务器');
    await mcpManager.stopAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
