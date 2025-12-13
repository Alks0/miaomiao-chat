/**
 * 配置和会话导出/导入模块
 * 处理数据的备份和恢复
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { loadAllSessionsFromDB, saveSessionToDB, loadConfig as loadConfigFromDB, loadSavedConfigs as loadSavedConfigsFromDB, saveConfig as saveConfigToDB, saveSavedConfigs as saveSavedConfigsToDB } from './storage.js';
import { loadSavedConfigs } from './config.js';
import { loadSessions } from './sessions.js';
import { showNotification } from '../ui/notifications.js';
import { showConfirmDialog } from '../utils/dialogs.js';

/**
 * 生成导出文件名
 * @param {string} type - 导出类型
 * @returns {string} 文件名
 */
function generateExportFilename(type) {
    const date = new Date().toISOString().slice(0, 10);
    return `webchat-${type}-${date}.json`;
}

/**
 * 下载 JSON 文件
 * @param {Object} data - 要导出的数据
 * @param {string} filename - 文件名
 */
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 过滤运行时状态字段（不应该导出的字段）
 * @param {Object} config - 配置对象
 * @returns {Object} 过滤后的配置对象
 */
function filterRuntimeState(config) {
    if (!config) return null;

    const { selectedModel, ...filteredConfig } = config;
    return filteredConfig;
}

/**
 * 导出配置
 */
export async function exportConfig() {
    try {
        // ✅ 从 IndexedDB 读取配置
        let currentConfig = null;
        let savedConfigs = [];

        if (state.storageMode !== 'localStorage') {
            currentConfig = await loadConfigFromDB();
            savedConfigs = await loadSavedConfigsFromDB() || [];
        }

        // 降级：从 localStorage 读取
        if (!currentConfig) {
            const configData = localStorage.getItem('geminiChatConfig');
            currentConfig = configData ? JSON.parse(configData) : null;
        }
        if (savedConfigs.length === 0) {
            const configs = localStorage.getItem('geminiChatConfigs');
            savedConfigs = configs ? JSON.parse(configs) : [];
        }

        // ✅ 过滤掉运行时状态（selectedModel）
        const filteredCurrentConfig = currentConfig ? filterRuntimeState(currentConfig) : null;
        const filteredSavedConfigs = savedConfigs.map(filterRuntimeState);

        const exportData = {
            type: 'config',
            version: 1,
            exportDate: new Date().toISOString(),
            data: {
                currentConfig: filteredCurrentConfig,
                savedConfigs: filteredSavedConfigs
            }
        };

        downloadJSON(exportData, generateExportFilename('config'));
        showNotification('配置已导出', 'success');
    } catch (error) {
        console.error('导出配置失败:', error);
        showNotification('导出配置失败: ' + error.message, 'error');
    }
}

/**
 * 导出会话记录
 */
export async function exportSessions() {
    try {
        const sessions = await loadAllSessionsFromDB();

        const exportData = {
            type: 'sessions',
            version: 1,
            exportDate: new Date().toISOString(),
            totalSessions: sessions.length,
            sessions: sessions
        };

        downloadJSON(exportData, generateExportFilename('sessions'));
        showNotification(`已导出 ${sessions.length} 个会话`, 'success');
    } catch (error) {
        console.error('导出会话失败:', error);
        showNotification('导出会话失败: ' + error.message, 'error');
    }
}

/**
 * 导出全部数据（配置 + 会话）
 */
export async function exportAllData() {
    try {
        // ✅ 从 IndexedDB 读取数据
        let currentConfig = null;
        let savedConfigs = [];
        const sessions = await loadAllSessionsFromDB();

        if (state.storageMode !== 'localStorage') {
            currentConfig = await loadConfigFromDB();
            savedConfigs = await loadSavedConfigsFromDB() || [];
        }

        // 降级：从 localStorage 读取
        if (!currentConfig) {
            const configData = localStorage.getItem('geminiChatConfig');
            currentConfig = configData ? JSON.parse(configData) : null;
        }
        if (savedConfigs.length === 0) {
            const configs = localStorage.getItem('geminiChatConfigs');
            savedConfigs = configs ? JSON.parse(configs) : [];
        }

        // ✅ 过滤掉运行时状态（selectedModel）
        const filteredCurrentConfig = currentConfig ? filterRuntimeState(currentConfig) : null;
        const filteredSavedConfigs = savedConfigs.map(filterRuntimeState);

        const exportData = {
            type: 'full-backup',
            version: 1,
            exportDate: new Date().toISOString(),
            metadata: {
                totalConfigs: filteredSavedConfigs.length,
                totalSessions: sessions.length
            },
            config: {
                currentConfig: filteredCurrentConfig,
                savedConfigs: filteredSavedConfigs
            },
            sessions: sessions
        };

        downloadJSON(exportData, generateExportFilename('backup'));
        showNotification(`已导出完整备份（${sessions.length} 个会话）`, 'success');
    } catch (error) {
        console.error('导出失败:', error);
        showNotification('导出失败: ' + error.message, 'error');
    }
}

/**
 * 导入配置
 * @param {Object} data - 导入的数据
 */
async function importConfig(data) {
    if (!data.data) {
        throw new Error('配置数据格式错误');
    }

    try {
        // ✅ 导入当前配置（过滤掉运行时状态）
        if (data.data.currentConfig) {
            const filtered = filterRuntimeState(data.data.currentConfig);
            if (state.storageMode !== 'localStorage') {
                await saveConfigToDB(filtered);
            } else {
                localStorage.setItem('geminiChatConfig', JSON.stringify(filtered));
            }
        }

        // ✅ 导入保存的配置（过滤掉运行时状态）
        if (data.data.savedConfigs) {
            const filtered = data.data.savedConfigs.map(filterRuntimeState);
            if (state.storageMode !== 'localStorage') {
                await saveSavedConfigsToDB(filtered);
            } else {
                localStorage.setItem('geminiChatConfigs', JSON.stringify(filtered));
            }
        }

        // 重新加载配置列表
        loadSavedConfigs();

        // ✅ 新增：触发模型列表刷新
        import('../ui/models.js').then(({ populateModelSelect }) => {
            populateModelSelect();
        }).catch(err => console.warn('Failed to refresh model list:', err));

        showNotification('配置已导入，请刷新页面应用更改', 'success');
    } catch (error) {
        console.error('导入配置失败:', error);
        // 降级处理
        if (data.data.currentConfig) {
            const filtered = filterRuntimeState(data.data.currentConfig);
            localStorage.setItem('geminiChatConfig', JSON.stringify(filtered));
        }
        if (data.data.savedConfigs) {
            const filtered = data.data.savedConfigs.map(filterRuntimeState);
            localStorage.setItem('geminiChatConfigs', JSON.stringify(filtered));
        }
        throw error;
    }
}

/**
 * 导入会话
 * @param {Object} data - 导入的数据
 */
async function importSessions(data) {
    if (!data.sessions || !Array.isArray(data.sessions)) {
        throw new Error('会话数据格式错误');
    }

    let importCount = 0;
    const errors = [];

    for (const session of data.sessions) {
        try {
            // 检查会话是否已存在
            const existing = state.sessions.find(s => s.id === session.id);
            if (existing) {
                // 询问是否覆盖
                const overwrite = await showConfirmDialog(
                    `会话 "${session.name}" 已存在，是否覆盖？`,
                    '确认覆盖'
                );
                if (!overwrite) continue;
            }

            await saveSessionToDB(session);
            importCount++;
        } catch (error) {
            console.error(`导入会话 ${session.id} 失败:`, error);
            errors.push(session.name);
        }
    }

    // 重新加载会话列表
    await loadSessions();

    if (errors.length > 0) {
        showNotification(`已导入 ${importCount} 个会话，${errors.length} 个失败`, 'warning');
    } else {
        showNotification(`已导入 ${importCount} 个会话`, 'success');
    }
}

/**
 * 导入完整备份
 * @param {Object} data - 导入的数据
 */
async function importFullBackup(data) {
    if (!data.config || !data.sessions) {
        throw new Error('备份数据格式错误');
    }

    try {
        // ✅ 导入配置（过滤掉运行时状态）
        if (data.config.currentConfig) {
            const filtered = filterRuntimeState(data.config.currentConfig);
            if (state.storageMode !== 'localStorage') {
                await saveConfigToDB(filtered);
            } else {
                localStorage.setItem('geminiChatConfig', JSON.stringify(filtered));
            }
        }
        if (data.config.savedConfigs) {
            const filtered = data.config.savedConfigs.map(filterRuntimeState);
            if (state.storageMode !== 'localStorage') {
                await saveSavedConfigsToDB(filtered);
            } else {
                localStorage.setItem('geminiChatConfigs', JSON.stringify(filtered));
            }
        }

        // 导入会话
        let importCount = 0;
        for (const session of data.sessions) {
            try {
                await saveSessionToDB(session);
                importCount++;
            } catch (error) {
                console.error(`导入会话 ${session.id} 失败:`, error);
            }
        }

        // 重新加载配置和会话列表
        loadSavedConfigs();
        await loadSessions();

        // ✅ 新增：触发模型列表刷新
        import('../ui/models.js').then(({ populateModelSelect }) => {
            populateModelSelect();
        }).catch(err => console.warn('Failed to refresh model list:', err));

        showNotification(`已导入完整备份（${importCount} 个会话），请刷新页面应用配置更改`, 'success');
    } catch (error) {
        console.error('导入完整备份失败:', error);
        // 降级处理
        if (data.config.currentConfig) {
            const filtered = filterRuntimeState(data.config.currentConfig);
            localStorage.setItem('geminiChatConfig', JSON.stringify(filtered));
        }
        if (data.config.savedConfigs) {
            const filtered = data.config.savedConfigs.map(filterRuntimeState);
            localStorage.setItem('geminiChatConfigs', JSON.stringify(filtered));
        }
        throw error;
    }
}

/**
 * 触发导入文件选择
 */
export function triggerImport() {
    elements.importFileInput.click();
}

/**
 * 处理导入文件
 * @param {Event} event - 文件输入事件
 */
export async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.type || !data.version) {
            throw new Error('无效的备份文件格式');
        }

        switch (data.type) {
            case 'config':
                await importConfig(data);
                break;
            case 'sessions':
                await importSessions(data);
                break;
            case 'full-backup':
                await importFullBackup(data);
                break;
            default:
                throw new Error(`不支持的备份类型: ${data.type}`);
        }

    } catch (error) {
        console.error('导入失败:', error);
        showNotification('导入失败: ' + error.message, 'error');
    } finally {
        // 清空文件输入
        event.target.value = '';
    }
}

/**
 * 初始化导出/导入功能
 */
export function initExportImport() {
    // 绑定导出按钮（使用正确的ID）
    const exportConfigBtn = document.getElementById('export-config');
    if (exportConfigBtn) {
        exportConfigBtn.addEventListener('click', exportConfig);
    }

    const exportSessionsBtn = document.getElementById('export-sessions');
    if (exportSessionsBtn) {
        exportSessionsBtn.addEventListener('click', exportSessions);
    }

    const exportAllBtn = document.getElementById('export-all');
    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', exportAllData);
    }

    // 绑定导入按钮
    const importBtn = document.getElementById('import-data');
    if (importBtn) {
        importBtn.addEventListener('click', triggerImport);
    }

    // 绑定文件输入
    if (elements.importFileInput) {
        elements.importFileInput.addEventListener('change', handleImportFile);
    }

    // 将函数暴露到全局作用域供 HTML onclick 使用
    window.exportConfig = exportConfig;
    window.exportSessions = exportSessions;
    window.exportAllData = exportAllData;
    window.triggerImport = triggerImport;

    console.log('Export/Import initialized');
}
