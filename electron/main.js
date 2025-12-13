const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initUpdater, checkForUpdatesManually, setSilentUpdate } = require('./updater');

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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
