/**
 * MCP 自动连接模块
 * 负责在应用启动时自动连接已配置的 MCP 服务器
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { mcpClient } from '../tools/mcp/client.js';
import { showNotification } from './notifications.js';

/**
 * 自动连接所有已配置的 MCP 服务器
 * @param {Object} options - 配置选项
 * @param {boolean} options.showNotifications - 是否显示通知（默认 true）
 * @param {number} options.delayBetweenConnections - 连接之间的延迟（ms，默认 100）
 * @returns {Promise<Object>} 连接结果统计
 */
export async function autoConnectMCPServers(options = {}) {
    const {
        showNotifications = true,
        delayBetweenConnections = 100
    } = options;

    console.log('[MCP AutoConnect] 🚀 开始自动连接 MCP 服务器...');

    if (!state.mcpServers || state.mcpServers.length === 0) {
        console.log('[MCP AutoConnect] 没有配置的 MCP 服务器');
        return { total: 0, connected: 0, failed: 0 };
    }

    const results = {
        total: state.mcpServers.length,
        connected: 0,
        failed: 0,
        errors: []
    };

    // 按顺序连接每个服务器（避免并发过多）
    for (const server of state.mcpServers) {
        try {
            console.log(`[MCP AutoConnect] 正在连接: ${server.name} (${server.type})`);

            const result = await mcpClient.connect(server);

            if (result.success) {
                results.connected++;
                console.log(`[MCP AutoConnect] 成功连接: ${server.name}`);

                // 更新服务器状态
                server.connected = true;
                server.lastConnected = new Date().toISOString();

                // 打印工具信息
                const tools = mcpClient.getToolsByServer(server.id);
                console.log(`[MCP AutoConnect] 服务器 ${server.name} 提供 ${tools.length} 个工具`);
            } else {
                results.failed++;
                results.errors.push({
                    serverId: server.id,
                    serverName: server.name,
                    error: result.error,
                    errorType: result.errorType
                });
                console.error(`[MCP AutoConnect] ❌ 连接失败: ${server.name}`, result.error);
            }

            // 延迟一下，避免过快连接
            if (delayBetweenConnections > 0) {
                await delay(delayBetweenConnections);
            }

        } catch (error) {
            results.failed++;
            results.errors.push({
                serverId: server.id,
                serverName: server.name,
                error: error.message
            });
            console.error(`[MCP AutoConnect] ❌ 连接异常: ${server.name}`, error);
        }
    }

    // 显示汇总通知
    if (showNotifications) {
        if (results.connected === results.total) {
            showNotification(
                `✅ 成功连接所有 ${results.total} 个 MCP 服务器`,
                'success'
            );
        } else if (results.connected > 0) {
            showNotification(
                `⚠️ 已连接 ${results.connected}/${results.total} 个 MCP 服务器`,
                'warning'
            );
        } else {
            showNotification(
                `❌ 无法连接任何 MCP 服务器`,
                'error'
            );
        }
    }

    console.log('[MCP AutoConnect] 自动连接完成:', results);

    // 如果有工具成功连接，重新加载工具状态
    if (results.connected > 0) {
        console.log('[MCP AutoConnect] 重新加载工具状态...');
        try {
            const { loadToolStates } = await import('../tools/manager.js');
            // 传入 true 确保加载所有工具状态（包括尚未注册的 MCP 工具）
            await loadToolStates(true);
            console.log('[MCP AutoConnect] 工具状态加载完成');
        } catch (error) {
            console.error('[MCP AutoConnect] 加载工具状态失败:', error);
        }
    }

    // 发送完成事件
    eventBus.emit('mcp:auto-connect-complete', results);

    return results;
}

/**
 * 延迟辅助函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 初始化自动连接（在应用启动时调用）
 * @param {number} startupDelay - 启动后的延迟时间（ms，默认 500）
 */
export function initMCPAutoConnect(startupDelay = 500) {
    console.log('[MCP AutoConnect] 初始化自动连接...');

    // 延迟执行，确保其他模块已经初始化
    setTimeout(async () => {
        console.log('[MCP AutoConnect] 执行自动连接...');
        await autoConnectMCPServers({
            showNotifications: true,
            delayBetweenConnections: 100
        });
    }, startupDelay);
}

console.log('[MCP AutoConnect] 模块已加载');