/**
 * 工具执行引擎
 * 负责工具的实际执行、超时控制、错误处理
 *
 * 发布事件:
 * - tool:execute:start { toolId, toolName, args }
 * - tool:execute:progress { toolId, percent, message }
 * - tool:execute:success { toolId, result, duration }
 * - tool:execute:error { toolId, error, duration }
 *
 * 📚 高级执行 API（可用但未使用）：
 * - executeToolsBatch() - 批量并行执行工具
 * - safeExecuteTool() - 安全执行（不抛出异常）
 * - executeToolWithRetry() - 带重试的执行
 * - executeCancelable() - 可取消的执行
 * - cancelToolExecution() - 取消工具执行
 *
 * 💡 未来可以在以下场景使用：
 * - 批量工具调用优化（使用 executeToolsBatch）
 * - 增强错误恢复（使用 executeToolWithRetry）
 * - 长时间运行的工具（使用 executeCancelable）
 */

import { eventBus } from '../core/events.js';
import { getTool, getToolHandler } from './manager.js';
import { safeValidate, formatValidationErrors } from './validator.js';
import { checkRateLimit } from './rate-limiter.js';

// ========== 配置 ==========

const DEFAULT_TIMEOUT = 30000; // 30秒
const MAX_TIMEOUT = 120000; // 最大2分钟

// ========== 工具执行 API ==========

/**
 * 执行工具
 * @param {string} toolId - 工具 ID
 * @param {Object} args - 工具参数
 * @param {Object} options - 执行选项
 * @returns {Promise<Object>} 执行结果
 */
export async function executeTool(toolId, args, options = {}) {
    const startTime = Date.now();

    // 获取工具定义
    const tool = getTool(toolId);
    if (!tool) {
        throw new Error(`工具不存在: ${toolId}`);
    }

    const toolName = tool.name || toolId;

    console.log(`[Executor] 🚀 开始执行工具: ${toolName}`);
    console.log(`[Executor] 参数:`, args);

    // 发布开始事件
    eventBus.emit('tool:execute:start', {
        toolId,
        toolName,
        args
    });

    try {
        // 1. 权限检查
        try {
            const { checkToolPermission } = await import('./permissions.js');
            const permission = checkToolPermission(toolId, toolName);

            if (!permission.allowed) {
                console.error(`[Executor] ❌ 权限拒绝: ${toolName}`);
                console.error(permission.message || '无权限执行此工具');

                throw new Error(permission.message || `无权限执行工具: ${toolName}`);
            }
        } catch (err) {
            // 如果是权限拒绝错误，直接抛出
            if (err.message && err.message.includes('无权限')) {
                throw err;
            }
            // 模块导入失败（语法错误、文件缺失）- 这是严重错误
            if (err instanceof SyntaxError || err.message.includes('Cannot find module')) {
                console.error('[Executor] ❌ 权限模块加载失败（严重错误）:', err);
                throw new Error(`权限系统故障，无法执行工具: ${err.message}`);
            }
            // 其他未知错误，记录警告但允许继续（降级模式）
            console.warn('[Executor] ⚠️ 权限检查失败，降级为默认允许模式:', err.message);
        }

        // 2. 速率限制检查
        if (tool.rateLimit) {
            try {
                checkRateLimit(toolId, tool.rateLimit);
            } catch (err) {
                console.error(`[Executor] ❌ 速率限制: ${toolName}`);
                console.error(err.message);
                throw err; // 抛出速率限制错误
            }
        }

        // 3. 参数验证
        const validation = safeValidate(args, tool.inputSchema);
        if (!validation.valid) {
            const errorMsg = formatValidationErrors(validation.errors);
            console.error(`[Executor] ❌ 参数验证失败: ${toolName}`);
            console.error(errorMsg);

            throw new Error(errorMsg);
        }

        // 4. 执行工具（带超时）
        const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);
        const result = await executeWithTimeout(tool, args, timeout);

        const duration = Date.now() - startTime;

        console.log(`[Executor] ✅ 工具执行成功: ${toolName} (耗时 ${duration}ms)`);
        console.log(`[Executor] 结果:`, result);

        // 发布成功事件
        eventBus.emit('tool:execute:success', {
            toolId,
            result,
            duration
        });

        // 记录到历史
        try {
            const { recordToolCall } = await import('./history.js');
            recordToolCall({
                toolId,
                toolName,
                args,
                result,
                success: true,
                duration
            });
        } catch (err) {
            // 历史记录失败不影响工具执行，但语法错误应明确记录
            if (err instanceof SyntaxError) {
                console.error('[Executor] ❌ 历史模块存在语法错误:', err);
            } else {
                console.warn('[Executor] ⚠️ 记录历史失败:', err.message);
            }
        }

        return result;

    } catch (error) {
        const duration = Date.now() - startTime;

        console.error(`[Executor] ❌ 工具执行失败: ${toolName} (耗时 ${duration}ms)`);
        console.error(error);

        // 发布失败事件
        eventBus.emit('tool:execute:error', {
            toolId,
            error: error.message,
            duration
        });

        // 记录到历史
        try {
            const { recordToolCall } = await import('./history.js');
            recordToolCall({
                toolId,
                toolName,
                args,
                result: null,
                success: false,
                duration,
                error: error.message
            });
        } catch (err) {
            // 历史记录失败不影响错误抛出，但语法错误应明确记录
            if (err instanceof SyntaxError) {
                console.error('[Executor] ❌ 历史模块存在语法错误:', err);
            } else {
                console.warn('[Executor] ⚠️ 记录历史失败:', err.message);
            }
        }

        throw error;
    }
}

/**
 * 带超时的工具执行
 * @param {Object} tool - 工具定义
 * @param {Object} args - 参数
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Object>} 执行结果
 */
async function executeWithTimeout(tool, args, timeout) {
    // 根据工具类型选择执行方式
    let executePromise;

    if (tool.type === 'builtin' || tool.type === 'custom') {
        // 内置工具或自定义工具：直接调用处理器
        const handler = getToolHandler(tool.id);
        if (!handler) {
            throw new Error(`工具处理器不存在: ${tool.id}`);
        }
        executePromise = handler(args);

    } else if (tool.type === 'mcp') {
        // MCP 工具：通过 MCP 客户端调用
        executePromise = executeMCPTool(tool, args);

    } else {
        throw new Error(`未知工具类型: ${tool.type}`);
    }

    // 创建超时 Promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`工具执行超时 (${timeout}ms)`));
        }, timeout);
    });

    // 竞速：执行 vs 超时
    return Promise.race([executePromise, timeoutPromise]);
}

/**
 * 执行 MCP 工具
 * @param {Object} tool - MCP 工具定义
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeMCPTool(tool, args) {
    // 动态导入 MCP 客户端（避免循环依赖）
    const { callMCPTool } = await import('./mcp/client.js');

    return callMCPTool(tool.serverId, tool.name, args);
}

/**
 * 批量执行工具（并行）
 * @param {Array<{toolId: string, args: Object}>} toolCalls - 工具调用列表
 * @param {Object} options - 执行选项
 * @returns {Promise<Array>} 结果列表
 */
export async function executeToolsBatch(toolCalls, options = {}) {
    console.log(`[Executor] 🔄 并行执行 ${toolCalls.length} 个工具`);

    const promises = toolCalls.map(({ toolId, args }) =>
        executeTool(toolId, args, options)
            .then(result => ({ success: true, toolId, result }))
            .catch(error => ({ success: false, toolId, error: error.message }))
    );

    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.success).length;
    console.log(`[Executor] ✅ 批量执行完成: ${successCount}/${toolCalls.length} 成功`);

    return results;
}

/**
 * 安全执行工具（不抛出异常）
 * @param {string} toolId - 工具 ID
 * @param {Object} args - 参数
 * @param {Object} options - 执行选项
 * @returns {Promise<{success: boolean, result?: Object, error?: string}>}
 */
export async function safeExecuteTool(toolId, args, options = {}) {
    try {
        const result = await executeTool(toolId, args, options);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========== 工具重试机制 ==========

/**
 * 带重试的工具执行
 * @param {string} toolId - 工具 ID
 * @param {Object} args - 参数
 * @param {Object} options - 执行选项
 * @returns {Promise<Object>} 执行结果
 */
export async function executeToolWithRetry(toolId, args, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Executor] 尝试 ${attempt}/${maxRetries}: ${toolId}`);
            return await executeTool(toolId, args, options);

        } catch (error) {
            lastError = error;

            if (attempt < maxRetries) {
                console.warn(`[Executor] ⚠️ 第 ${attempt} 次尝试失败，${retryDelay}ms 后重试...`);
                await delay(retryDelay * attempt); // 指数退避
            }
        }
    }

    console.error(`[Executor] ❌ 工具执行失败（已重试 ${maxRetries} 次）: ${toolId}`);
    throw lastError;
}

/**
 * 延迟函数
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 工具取消 ==========

// 存储当前执行的工具（用于取消）
const runningTools = new Map();

/**
 * 可取消的工具执行
 * @param {string} executionId - 执行 ID
 * @param {string} toolId - 工具 ID
 * @param {Object} args - 参数
 * @param {Object} options - 执行选项
 * @returns {Promise<Object>} 执行结果
 */
export async function executeCancelable(executionId, toolId, args, options = {}) {
    // 创建取消控制器
    const cancelController = {
        canceled: false,
        cancel() {
            this.canceled = true;
        }
    };

    runningTools.set(executionId, cancelController);

    try {
        // 在执行前检查是否已取消
        if (cancelController.canceled) {
            throw new Error('工具执行已取消');
        }

        const result = await executeTool(toolId, args, options);

        // 检查执行后是否被取消
        if (cancelController.canceled) {
            throw new Error('工具执行已取消');
        }

        return result;

    } finally {
        runningTools.delete(executionId);
    }
}

/**
 * 取消工具执行
 * @param {string} executionId - 执行 ID
 * @returns {boolean} 是否成功取消
 */
export function cancelToolExecution(executionId) {
    const controller = runningTools.get(executionId);

    if (controller) {
        controller.cancel();
        console.log(`[Executor] 🛑 已取消工具执行: ${executionId}`);
        return true;
    }

    return false;
}
