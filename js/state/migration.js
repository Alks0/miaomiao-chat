/**
 * IndexedDB 数据迁移模块
 * 处理从 localStorage 到 IndexedDB 的数据迁移
 */

import { eventBus } from '../core/events.js';
import {
    saveConfig, loadConfig, saveSavedConfigs, loadSavedConfigs,
    savePreference, loadPreference,
    saveQuickMessage, loadAllQuickMessages
} from './storage.js';

// ========== 迁移状态管理 ==========

/**
 * 迁移状态常量
 */
export const MIGRATION_STATES = {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

/**
 * 获取迁移状态
 * @returns {Promise<string>} 迁移状态
 */
export async function getMigrationStatus() {
    try {
        const status = await loadPreference('migration_status');
        return status || MIGRATION_STATES.NOT_STARTED;
    } catch (error) {
        console.error('获取迁移状态失败:', error);
        return MIGRATION_STATES.NOT_STARTED;
    }
}

/**
 * 设置迁移状态
 * @param {string} status - 迁移状态
 * @returns {Promise<void>}
 */
export async function setMigrationStatus(status) {
    await savePreference('migration_status', status);
    logMigrationStep('状态更新', status, { timestamp: Date.now() });
}

// ========== 并发保护 ==========

const MIGRATION_LOCK_KEY = 'migration_lock';
const MIGRATION_LOCK_TIMEOUT = 60000; // 60秒

/**
 * 获取迁移锁
 * @throws {Error} 如果其他标签页正在迁移
 */
export function acquireMigrationLock() {
    const lock = localStorage.getItem(MIGRATION_LOCK_KEY);
    const now = Date.now();

    if (lock) {
        const lockTime = parseInt(lock, 10);
        if (now - lockTime < MIGRATION_LOCK_TIMEOUT) {
            const remainingTime = Math.ceil((MIGRATION_LOCK_TIMEOUT - (now - lockTime)) / 1000);
            throw new Error(`其他标签页正在迁移，请等待 ${remainingTime} 秒后重试`);
        }
    }

    localStorage.setItem(MIGRATION_LOCK_KEY, now.toString());
    console.log('已获取迁移锁');
}

/**
 * 释放迁移锁
 */
export function releaseMigrationLock() {
    localStorage.removeItem(MIGRATION_LOCK_KEY);
    console.log('已释放迁移锁');
}

// ========== 迁移日志 ==========

const migrationLog = [];

/**
 * 记录迁移步骤
 * @param {string} step - 步骤名称
 * @param {string} status - 步骤状态
 * @param {Object} details - 详细信息
 */
export function logMigrationStep(step, status, details = {}) {
    const logEntry = {
        step,
        status,
        details,
        timestamp: Date.now()
    };
    migrationLog.push(logEntry);
    console.log(`[迁移] ${step}: ${status}`, details);
}

/**
 * 获取迁移日志
 * @returns {Array} 迁移日志
 */
export function getMigrationLog() {
    return [...migrationLog];
}

// ========== 备份函数 ==========

/**
 * 备份 localStorage 数据到 IndexedDB
 * @returns {Promise<Object>} 备份数据
 */
export async function backupLocalStorage() {
    const backup = {
        timestamp: Date.now(),
        data: {}
    };

    // 备份所有相关的 localStorage 键
    const keysToBackup = [
        'geminiChatConfig',
        'geminiChatConfigs',
        'geminiCurrentSessionId',
        'quickMessages',
        'theme',
        'sidebarOpen',
        'inputTextareaHeight',
        'sessionListWidth',
        'settingsPanelWidth'
    ];

    keysToBackup.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            backup.data[key] = value;
        }
    });

    // 保存备份到 IndexedDB
    await savePreference('localStorage_backup', backup);

    console.log('localStorage 备份完成:', Object.keys(backup.data));
    return backup;
}

// ========== 迁移函数 ==========

/**
 * 迁移配置数据
 * @returns {Promise<void>}
 */
async function migrateConfig() {
    logMigrationStep('迁移配置', '开始', {});

    // 迁移当前配置
    const configStr = localStorage.getItem('geminiChatConfig');
    if (configStr) {
        try {
            const config = JSON.parse(configStr);
            await saveConfig(config);
            logMigrationStep('迁移配置', '当前配置已迁移', { keys: Object.keys(config).length });
        } catch (error) {
            console.error('迁移当前配置失败:', error);
            throw error;
        }
    }

    // 迁移保存的配置列表
    const configsStr = localStorage.getItem('geminiChatConfigs');
    if (configsStr) {
        try {
            const configs = JSON.parse(configsStr);
            await saveSavedConfigs(configs);
            logMigrationStep('迁移配置', '配置列表已迁移', { count: configs.length });
        } catch (error) {
            console.error('迁移配置列表失败:', error);
            throw error;
        }
    }

    logMigrationStep('迁移配置', '完成', {});
}

/**
 * 迁移偏好设置
 * @returns {Promise<void>}
 */
async function migratePreferences() {
    logMigrationStep('迁移偏好设置', '开始', {});

    const prefKeys = [
        { key: 'theme', transform: (v) => v },
        { key: 'sidebarOpen', transform: (v) => v === 'true' },
        { key: 'inputTextareaHeight', transform: (v) => parseInt(v, 10) },
        { key: 'sessionListWidth', transform: (v) => parseInt(v, 10) },
        { key: 'settingsPanelWidth', transform: (v) => parseInt(v, 10) }
    ];

    let migratedCount = 0;

    for (const { key, transform } of prefKeys) {
        const value = localStorage.getItem(key);
        if (value !== null) {
            try {
                const transformedValue = transform(value);
                await savePreference(key, transformedValue);
                migratedCount++;
            } catch (error) {
                console.error(`迁移偏好设置 ${key} 失败:`, error);
            }
        }
    }

    logMigrationStep('迁移偏好设置', '完成', { count: migratedCount });
}

/**
 * 迁移快捷消息
 * @returns {Promise<void>}
 */
async function migrateQuickMessages() {
    logMigrationStep('迁移快捷消息', '开始', {});

    const qmStr = localStorage.getItem('quickMessages');
    if (qmStr) {
        try {
            const messages = JSON.parse(qmStr);
            for (const msg of messages) {
                await saveQuickMessage(msg);
            }
            logMigrationStep('迁移快捷消息', '完成', { count: messages.length });
        } catch (error) {
            console.error('迁移快捷消息失败:', error);
            throw error;
        }
    } else {
        logMigrationStep('迁移快捷消息', '无数据，跳过', {});
    }
}

/**
 * 迁移当前会话 ID
 * @returns {Promise<void>}
 */
async function migrateCurrentSessionId() {
    logMigrationStep('迁移当前会话ID', '开始', {});

    const sessionId = localStorage.getItem('geminiCurrentSessionId');
    if (sessionId) {
        await savePreference('currentSessionId', sessionId);
        logMigrationStep('迁移当前会话ID', '完成', { sessionId });
    } else {
        logMigrationStep('迁移当前会话ID', '无数据，跳过', {});
    }
}

// ========== 验证函数 ==========

/**
 * 验证迁移完整性
 * @returns {Promise<boolean>} 验证是否成功
 */
export async function verifyMigration() {
    logMigrationStep('验证迁移', '开始', {});

    const errors = [];

    // 验证配置
    const config = await loadConfig();
    const localConfig = localStorage.getItem('geminiChatConfig');
    if (localConfig && !config) {
        errors.push('配置迁移失败');
    }

    // 验证快捷消息
    const quickMessages = await loadAllQuickMessages();
    const localQM = localStorage.getItem('quickMessages');
    if (localQM) {
        const oldQM = JSON.parse(localQM);
        if (quickMessages.length !== oldQM.length) {
            errors.push(`快捷消息数量不一致: IDB=${quickMessages.length}, LS=${oldQM.length}`);
        }
    }

    // 验证偏好设置
    const theme = await loadPreference('theme');
    const oldTheme = localStorage.getItem('theme');
    if (oldTheme && theme !== oldTheme) {
        errors.push(`主题设置不一致: IDB=${theme}, LS=${oldTheme}`);
    }

    if (errors.length > 0) {
        console.error('❌ 迁移验证失败:', errors);
        logMigrationStep('验证迁移', '失败', { errors });
        return false;
    }

    console.log('迁移验证成功');
    logMigrationStep('验证迁移', '成功', {});
    return true;
}

// ========== 清理函数 ==========

/**
 * 清理 localStorage（保留备份键）
 * @returns {Promise<void>}
 */
async function cleanupLocalStorage() {
    logMigrationStep('清理 localStorage', '开始', {});

    const keysToRemove = [
        'geminiChatConfig',
        'geminiChatConfigs',
        'geminiCurrentSessionId',
        'quickMessages'
        // 注意: 不删除 UI 偏好，作为降级后备
        // 注意: 不删除备份键
        // - 'localStorage_backup'
        // - 'config-backup-pre-migration'
        // - 'theme', 'sidebarOpen', 'inputTextareaHeight', etc.
    ];

    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`已清理: ${key}`);
    });

    logMigrationStep('清理 localStorage', '完成', { removed: keysToRemove.length });
}

// ========== 回滚函数 ==========

/**
 * 回滚迁移（从备份恢复）
 * @returns {Promise<void>}
 */
export async function rollbackMigration() {
    console.log('🔄 开始回滚迁移...');

    try {
        // 从 IndexedDB 读取备份
        const backup = await loadPreference('localStorage_backup');

        if (!backup || !backup.data) {
            console.warn('未找到备份数据，无法回滚');
            return;
        }

        // 恢复到 localStorage
        Object.entries(backup.data).forEach(([key, value]) => {
            localStorage.setItem(key, value);
            console.log(`已恢复: ${key}`);
        });

        // 清除迁移状态
        await savePreference('migration_status', MIGRATION_STATES.NOT_STARTED);

        console.log('回滚成功');

        eventBus.emit('ui:notification', {
            message: '已回滚到迁移前状态',
            type: 'info'
        });

    } catch (error) {
        console.error('❌ 回滚失败:', error);

        eventBus.emit('ui:notification', {
            message: '回滚失败: ' + error.message,
            type: 'error'
        });
    }
}

// ========== 主迁移函数 ==========

/**
 * 执行完整的数据迁移
 * @returns {Promise<boolean>} 迁移是否成功
 */
export async function executeMigration() {
    console.log('🔄 开始数据迁移到 IndexedDB...');

    // 通知 UI 迁移开始
    eventBus.emit('ui:migration-started', {
        message: '正在迁移数据到 IndexedDB，请稍候...'
    });

    const startTime = Date.now();

    try {
        // 检查当前状态
        const currentStatus = await getMigrationStatus();

        if (currentStatus === MIGRATION_STATES.IN_PROGRESS) {
            console.warn('检测到未完成的迁移，执行回滚');
            await rollbackMigration();
        }

        if (currentStatus === MIGRATION_STATES.COMPLETED) {
            console.log('迁移已完成，跳过');
            return true;
        }

        // 设置状态为进行中
        await setMigrationStatus(MIGRATION_STATES.IN_PROGRESS);

        // 步骤 1: 备份
        await backupLocalStorage();

        // 步骤 2: 迁移配置
        await migrateConfig();

        // 步骤 3: 迁移 UI 偏好
        await migratePreferences();

        // 步骤 4: 迁移快捷消息
        await migrateQuickMessages();

        // 步骤 5: 迁移当前会话 ID
        await migrateCurrentSessionId();

        // 步骤 6: 验证
        const isValid = await verifyMigration();
        if (!isValid) {
            throw new Error('迁移验证失败');
        }

        // 步骤 7: 标记完成
        await setMigrationStatus(MIGRATION_STATES.COMPLETED);

        // 步骤 8: 清理 localStorage
        await cleanupLocalStorage();

        // 保存迁移日志
        await savePreference('migration_log', migrationLog);

        const duration = Date.now() - startTime;
        console.log(`数据迁移完成，耗时: ${duration}ms`);

        // 通知 UI 迁移完成
        eventBus.emit('ui:migration-completed', {
            message: '数据迁移完成',
            duration
        });

        return true;

    } catch (error) {
        console.error('❌ 迁移失败:', error);

        // 标记失败状态
        await setMigrationStatus(MIGRATION_STATES.FAILED);
        logMigrationStep('迁移失败', 'error', { error: error.message });

        // 通知 UI 迁移失败
        eventBus.emit('ui:migration-failed', {
            message: '数据迁移失败: ' + error.message,
            error
        });

        eventBus.emit('ui:notification', {
            message: '数据迁移失败，已回退到 localStorage',
            type: 'error',
            duration: 8000
        });

        // 尝试回滚
        try {
            await rollbackMigration();
        } catch (rollbackError) {
            console.error('回滚失败:', rollbackError);
        }

        return false;
    }
}
