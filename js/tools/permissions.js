/**
 * 工具调用权限管理模块
 * 控制哪些工具可以被调用（白名单/黑名单模式）
 *
 * ⚠️ 注意：此模块提供完整的权限管理 API，但目前没有 UI 界面
 *
 * 🔧 使用方式：
 * 1. 在浏览器控制台中手动调用这些函数
 * 2. 未来可以创建 js/ui/tool-permissions.js 来提供管理界面
 *
 * 📚 可用 API：
 * - addToWhitelist(toolId) - 添加到白名单
 * - removeFromWhitelist(toolId) - 从白名单移除
 * - addToBlacklist(toolId) - 添加到黑名单
 * - removeFromBlacklist(toolId) - 从黑名单移除
 * - setPermissionMode('whitelist' | 'blacklist') - 设置模式
 * - setPermissionsEnabled(boolean) - 启用/禁用权限系统
 * - getPermissions() - 查看当前配置
 * - resetPermissions() - 重置为默认值
 *
 * 💡 示例：
 * ```javascript
 * import { addToWhitelist, setPermissionMode } from './js/tools/permissions.js';
 * setPermissionMode('whitelist');
 * addToWhitelist('calculator');
 * ```
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { debouncedSaveSession } from '../state/sessions.js';

/**
 * 检查工具是否有执行权限
 * @param {string} toolId - 工具ID
 * @param {string} toolName - 工具名称
 * @returns {Object} 权限检查结果
 */
export function checkToolPermission(toolId, toolName) {
    // 如果权限系统未启用，默认允许
    if (!state.toolPermissions.enabled) {
        return {
            allowed: true,
            reason: 'permissions_disabled'
        };
    }

    const { mode, whitelist, blacklist } = state.toolPermissions;

    if (mode === 'whitelist') {
        // 白名单模式：只允许列表中的工具
        const allowed = whitelist.includes(toolId) || whitelist.includes(toolName);
        return {
            allowed,
            reason: allowed ? 'whitelist_match' : 'whitelist_reject',
            message: allowed ? undefined : `工具 "${toolName}" 不在白名单中`
        };
    } else if (mode === 'blacklist') {
        // 黑名单模式：禁止列表中的工具
        const blocked = blacklist.includes(toolId) || blacklist.includes(toolName);
        return {
            allowed: !blocked,
            reason: blocked ? 'blacklist_reject' : 'blacklist_pass',
            message: blocked ? `工具 "${toolName}" 在黑名单中` : undefined
        };
    }

    // 默认允许（未知模式）
    return {
        allowed: true,
        reason: 'unknown_mode'
    };
}

/**
 * 添加工具到白名单
 * @param {string} toolIdentifier - 工具ID或名称
 */
export function addToWhitelist(toolIdentifier) {
    if (!state.toolPermissions.whitelist.includes(toolIdentifier)) {
        state.toolPermissions.whitelist.push(toolIdentifier);
        savePermissions();

        console.log(`[Permissions] 已添加到白名单: ${toolIdentifier}`);

        eventBus.emit('tool:permissions:whitelist-updated', {
            action: 'add',
            tool: toolIdentifier,
            whitelist: [...state.toolPermissions.whitelist]
        });
    }
}

/**
 * 从白名单移除工具
 * @param {string} toolIdentifier - 工具ID或名称
 */
export function removeFromWhitelist(toolIdentifier) {
    const index = state.toolPermissions.whitelist.indexOf(toolIdentifier);
    if (index !== -1) {
        state.toolPermissions.whitelist.splice(index, 1);
        savePermissions();

        console.log(`[Permissions] 已从白名单移除: ${toolIdentifier}`);

        eventBus.emit('tool:permissions:whitelist-updated', {
            action: 'remove',
            tool: toolIdentifier,
            whitelist: [...state.toolPermissions.whitelist]
        });
    }
}

/**
 * 添加工具到黑名单
 * @param {string} toolIdentifier - 工具ID或名称
 */
export function addToBlacklist(toolIdentifier) {
    if (!state.toolPermissions.blacklist.includes(toolIdentifier)) {
        state.toolPermissions.blacklist.push(toolIdentifier);
        savePermissions();

        console.log(`[Permissions] 已添加到黑名单: ${toolIdentifier}`);

        eventBus.emit('tool:permissions:blacklist-updated', {
            action: 'add',
            tool: toolIdentifier,
            blacklist: [...state.toolPermissions.blacklist]
        });
    }
}

/**
 * 从黑名单移除工具
 * @param {string} toolIdentifier - 工具ID或名称
 */
export function removeFromBlacklist(toolIdentifier) {
    const index = state.toolPermissions.blacklist.indexOf(toolIdentifier);
    if (index !== -1) {
        state.toolPermissions.blacklist.splice(index, 1);
        savePermissions();

        console.log(`[Permissions] 已从黑名单移除: ${toolIdentifier}`);

        eventBus.emit('tool:permissions:blacklist-updated', {
            action: 'remove',
            tool: toolIdentifier,
            blacklist: [...state.toolPermissions.blacklist]
        });
    }
}

/**
 * 设置权限模式
 * @param {string} mode - 'whitelist' | 'blacklist'
 */
export function setPermissionMode(mode) {
    if (mode !== 'whitelist' && mode !== 'blacklist') {
        throw new Error(`无效的权限模式: ${mode}。必须是 'whitelist' 或 'blacklist'`);
    }

    state.toolPermissions.mode = mode;
    savePermissions();

    console.log(`[Permissions] 权限模式已设为: ${mode}`);

    eventBus.emit('tool:permissions:mode-changed', { mode });
}

/**
 * 启用/禁用权限系统
 * @param {boolean} enabled - 是否启用
 */
export function setPermissionsEnabled(enabled) {
    state.toolPermissions.enabled = enabled;
    savePermissions();

    console.log(`[Permissions] 权限系统已${enabled ? '启用' : '禁用'}`);

    eventBus.emit('tool:permissions:enabled-changed', { enabled });
}

/**
 * 设置是否需要用户确认
 * @param {boolean} required - 是否需要确认
 */
export function setRequireConfirmation(required) {
    state.toolPermissions.requireConfirmation = required;
    savePermissions();

    console.log(`[Permissions] 用户确认已${required ? '启用' : '禁用'}`);

    eventBus.emit('tool:permissions:confirmation-changed', { required });
}

/**
 * 获取权限配置
 * @returns {Object} 权限配置
 */
export function getPermissions() {
    return {
        ...state.toolPermissions,
        whitelist: [...state.toolPermissions.whitelist],
        blacklist: [...state.toolPermissions.blacklist]
    };
}

/**
 * 重置权限配置
 */
export function resetPermissions() {
    state.toolPermissions = {
        enabled: false,
        mode: 'whitelist',
        whitelist: [],
        blacklist: [],
        requireConfirmation: false
    };

    savePermissions();

    console.log('[Permissions] 权限配置已重置');

    eventBus.emit('tool:permissions:reset');
}

/**
 * 导出权限配置
 * @returns {string} JSON 字符串
 */
export function exportPermissions() {
    return JSON.stringify(state.toolPermissions, null, 2);
}

/**
 * 导入权限配置
 * @param {string} data - JSON 字符串
 */
export function importPermissions(data) {
    try {
        const imported = JSON.parse(data);

        // 验证数据结构
        if (typeof imported !== 'object') {
            throw new Error('导入数据必须是对象');
        }

        // 合并到当前配置
        state.toolPermissions = {
            ...state.toolPermissions,
            ...imported
        };

        savePermissions();

        console.log('[Permissions] 权限配置已导入');

        eventBus.emit('tool:permissions:imported');

    } catch (error) {
        console.error('[Permissions] 导入失败:', error);
        throw new Error(`导入权限配置失败: ${error.message}`);
    }
}

/**
 * 获取权限统计
 * @returns {Object} 统计信息
 */
export function getPermissionStats() {
    return {
        enabled: state.toolPermissions.enabled,
        mode: state.toolPermissions.mode,
        whitelistCount: state.toolPermissions.whitelist.length,
        blacklistCount: state.toolPermissions.blacklist.length,
        requireConfirmation: state.toolPermissions.requireConfirmation
    };
}

/**
 * 批量设置白名单
 * @param {Array<string>} tools - 工具ID/名称数组
 * @param {boolean} replace - 是否替换（默认 false，追加）
 */
export function setWhitelist(tools, replace = false) {
    if (replace) {
        state.toolPermissions.whitelist = [...tools];
    } else {
        // 追加并去重
        const combined = [...state.toolPermissions.whitelist, ...tools];
        state.toolPermissions.whitelist = [...new Set(combined)];
    }

    savePermissions();

    console.log(`[Permissions] 白名单已${replace ? '替换' : '更新'}: ${state.toolPermissions.whitelist.length} 个工具`);

    eventBus.emit('tool:permissions:whitelist-updated', {
        action: replace ? 'replace' : 'append',
        whitelist: [...state.toolPermissions.whitelist]
    });
}

/**
 * 批量设置黑名单
 * @param {Array<string>} tools - 工具ID/名称数组
 * @param {boolean} replace - 是否替换（默认 false，追加）
 */
export function setBlacklist(tools, replace = false) {
    if (replace) {
        state.toolPermissions.blacklist = [...tools];
    } else {
        // 追加并去重
        const combined = [...state.toolPermissions.blacklist, ...tools];
        state.toolPermissions.blacklist = [...new Set(combined)];
    }

    savePermissions();

    console.log(`[Permissions] 黑名单已${replace ? '替换' : '更新'}: ${state.toolPermissions.blacklist.length} 个工具`);

    eventBus.emit('tool:permissions:blacklist-updated', {
        action: replace ? 'replace' : 'append',
        blacklist: [...state.toolPermissions.blacklist]
    });
}

/**
 * 保存权限配置到 IndexedDB
 */
function savePermissions() {
    debouncedSaveSession();
}

console.log('[Permissions] 🔒 工具权限管理模块已加载');
