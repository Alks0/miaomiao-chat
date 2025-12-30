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
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true // 启用网络安全
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });

    // 设置 CSP 响应头（在 Electron 中生效，包含 frame-ancestors）
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                    "img-src 'self' data: blob: https: http:; " +
                    "font-src 'self' data: https://fonts.gstatic.com; " +
                    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://aiplatform.googleapis.com https: http: wss: ws:; " +
                    "media-src 'self' data: blob:; " +
                    "object-src 'none'; " +
                    "base-uri 'self'; " +
                    "form-action 'self'; " +
                    "frame-ancestors 'none';"
                ]
            }
        });
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

// ========== Computer Use IPC 处理器 ==========

// 延迟加载 Computer Use 模块（避免启动时的 asar 路径解析问题）
let computerUse = null;
function getComputerUse() {
    if (!computerUse) {
        computerUse = require('./computer-use/manager');
    }
    return computerUse;
}

/**
 * IPC: 更新 Computer Use 权限
 */
ipcMain.handle('computer-use:update-permissions', async (event, permissions) => {
    try {
        getComputerUse().updatePermissions(permissions);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 更新权限失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 更新 Bash 配置
 */
ipcMain.handle('computer-use:update-bash-config', async (event, config) => {
    try {
        getComputerUse().updateBashConfig(config);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 更新 Bash 配置失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 截图
 */
ipcMain.handle('computer-use:screenshot', async () => {
    try {
        const result = await getComputerUse().captureScreen();
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] 截图失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 区域放大截图（zoom）
 */
ipcMain.handle('computer-use:zoom', async (event, { x1, y1, x2, y2 }) => {
    try {
        const result = await getComputerUse().zoomRegion(x1, y1, x2, y2);
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] Zoom 失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标移动
 */
ipcMain.handle('computer-use:mouse-move', async (event, { x, y }) => {
    try {
        const result = await getComputerUse().moveMouse(x, y);
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] 鼠标移动失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标点击
 */
ipcMain.handle('computer-use:mouse-click', async (event, { button }) => {
    try {
        await getComputerUse().clickMouse(button);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 鼠标点击失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标双击
 */
ipcMain.handle('computer-use:mouse-double-click', async (event, { button }) => {
    try {
        await getComputerUse().doubleClickMouse(button);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 鼠标双击失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标三击
 */
ipcMain.handle('computer-use:mouse-triple-click', async (event, { button }) => {
    try {
        await getComputerUse().tripleClickMouse(button);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 鼠标三击失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标拖拽
 */
ipcMain.handle('computer-use:mouse-drag', async (event, { fromX, fromY, toX, toY }) => {
    try {
        await getComputerUse().dragMouse(fromX, fromY, toX, toY);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 鼠标拖拽失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 鼠标滚轮
 */
ipcMain.handle('computer-use:mouse-scroll', async (event, { amount }) => {
    try {
        await getComputerUse().scrollMouse(amount);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 鼠标滚轮失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 按下鼠标按钮
 */
ipcMain.handle('computer-use:mouse-press-button', async (event, { button }) => {
    try {
        await getComputerUse().pressMouseButton(button);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 按下鼠标按钮失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 释放鼠标按钮
 */
ipcMain.handle('computer-use:mouse-release-button', async (event, { button }) => {
    try {
        await getComputerUse().releaseMouseButton(button);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 释放鼠标按钮失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 键盘输入
 */
ipcMain.handle('computer-use:keyboard-type', async (event, { text }) => {
    try {
        await getComputerUse().typeText(text);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 键盘输入失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 按键
 */
ipcMain.handle('computer-use:keyboard-press', async (event, { key, modifiers }) => {
    try {
        await getComputerUse().pressKey(key, modifiers);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 按键失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 按住按键
 */
ipcMain.handle('computer-use:keyboard-hold', async (event, { key }) => {
    try {
        await getComputerUse().holdKey(key);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 按住按键失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 释放按键
 */
ipcMain.handle('computer-use:keyboard-release', async (event, { key }) => {
    try {
        await getComputerUse().releaseKey(key);
        return { success: true };
    } catch (error) {
        console.error('[Computer Use] 释放按键失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 获取显示器信息
 */
ipcMain.handle('computer-use:get-display-info', async () => {
    try {
        const result = await getComputerUse().getDisplayInfo();
        return { success: true, displays: result };
    } catch (error) {
        console.error('[Computer Use] 获取显示器信息失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 获取光标位置
 */
ipcMain.handle('computer-use:get-cursor-position', async () => {
    try {
        const result = await getComputerUse().getCursorPosition();
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] 获取光标位置失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 执行 Bash 命令
 */
ipcMain.handle('computer-use:bash-execute', async (event, { command }) => {
    try {
        const result = await getComputerUse().executeBash(command);
        // bash.execute() 已经返回了包含 success 字段的对象，直接返回
        return result;
    } catch (error) {
        console.error('[Computer Use] Bash 执行失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 读取文件
 */
ipcMain.handle('computer-use:file-read', async (event, { path }) => {
    try {
        const result = await getComputerUse().readFile(path);
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] 读取文件失败:', error);
        return { success: false, error: error.message };
    }
});

/**
 * IPC: 写入文件
 */
ipcMain.handle('computer-use:file-write', async (event, { path, content }) => {
    try {
        const result = await getComputerUse().writeFile(path, content);
        return { success: true, ...result };
    } catch (error) {
        console.error('[Computer Use] 写入文件失败:', error);
        return { success: false, error: error.message };
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
