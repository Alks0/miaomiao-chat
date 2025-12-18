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

// ========== Claude 原生工具执行 ==========

/**
 * 执行 Claude 原生工具（computer, bash, text_editor）
 * @param {string} toolName - 工具名称
 * @param {Object} args - 工具参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeNativeTool(toolName, args) {
    // 检查是否在 Electron 环境
    if (!window.electronAPI || !window.electronAPI.isElectron || !window.electronAPI.isElectron()) {
        throw new Error(`原生工具 "${toolName}" 仅在 Electron 环境中可用`);
    }

    switch (toolName) {
        case 'computer':
            return await executeComputerTool(args);

        case 'bash':
            return await executeBashTool(args);

        case 'str_replace_based_edit_tool':
            return await executeTextEditorTool(args);

        default:
            throw new Error(`未知的原生工具: ${toolName}`);
    }
}

/**
 * 执行 computer 工具
 * 参考：https://platform.claude.com/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool
 */
async function executeComputerTool(args) {
    const { action } = args;

    // 增强错误提示
    if (!action) {
        const availableParams = Object.keys(args).join(', ');
        throw new Error(
            `Missing required parameter 'action' for computer tool. ` +
            `Received parameters: ${availableParams || 'none'}. ` +
            `Expected format: { action: 'screenshot' | 'bash' | 'mouse_move' | 'type' | ..., ... }`
        );
    }

    switch (action) {
        case 'screenshot':
            return await window.electronAPI.computerUse_screenshot();

        case 'mouse_move': {
            const [x, y] = args.coordinate || [0, 0];
            return await window.electronAPI.computerUse_moveMouse(x, y);
        }

        case 'left_click':
        case 'right_click':
        case 'middle_click': {
            const button = action.replace('_click', '');
            if (args.coordinate) {
                const [x, y] = args.coordinate;
                await window.electronAPI.computerUse_moveMouse(x, y);
            }
            return await window.electronAPI.computerUse_clickMouse(button);
        }

        case 'double_click':
        case 'triple_click': {
            const times = action === 'double_click' ? 2 : 3;
            if (args.coordinate) {
                const [x, y] = args.coordinate;
                await window.electronAPI.computerUse_moveMouse(x, y);
            }
            // 连续点击
            for (let i = 0; i < times; i++) {
                await window.electronAPI.computerUse_clickMouse('left');
                if (i < times - 1) await new Promise(r => setTimeout(r, 50));
            }
            return { success: true };
        }

        case 'left_click_drag': {
            const [fromX, fromY] = args.coordinate || [0, 0];
            const [toX, toY] = args.end_coordinate || args.coordinate || [0, 0];
            return await window.electronAPI.computerUse_dragMouse(fromX, fromY, toX, toY);
        }

        case 'left_mouse_down': {
            const [x, y] = args.coordinate || [0, 0];
            await window.electronAPI.computerUse_moveMouse(x, y);
            // 简单实现：目前Electron API可能不支持单独的down/up
            console.warn('[Executor] left_mouse_down 操作：当前简化为移动鼠标');
            return { success: true };
        }

        case 'left_mouse_up':
            console.warn('[Executor] left_mouse_up 操作：当前简化实现');
            return { success: true };

        case 'scroll': {
            const direction = args.scroll_direction || 'down';
            const amount = args.scroll_amount || 1;
            // 简单实现：使用keyboard模拟滚动
            const key = direction === 'down' || direction === 'up'
                ? (direction === 'down' ? 'Page_Down' : 'Page_Up')
                : (direction === 'right' ? 'Right' : 'Left');

            for (let i = 0; i < amount; i++) {
                await window.electronAPI.computerUse_pressKey(key, []);
                await new Promise(r => setTimeout(r, 100));
            }
            return { success: true };
        }

        case 'type':
            return await window.electronAPI.computerUse_typeText(args.text);

        case 'key':
            return await window.electronAPI.computerUse_pressKey(
                args.key,
                args.modifiers || []
            );

        case 'hold_key':
            // 简单实现：暂不支持真正的hold
            console.warn('[Executor] hold_key 操作：当前简化为按键');
            return await window.electronAPI.computerUse_pressKey(args.key, []);

        case 'wait': {
            const duration = args.duration || 1;
            await new Promise(r => setTimeout(r, duration * 1000));
            return { success: true };
        }

        case 'zoom': {
            // Opus 4.5专用：缩放功能
            console.warn('[Executor] zoom 操作：当前不支持，需要特殊实现');
            throw new Error('Zoom操作需要特殊的图像处理支持，当前版本暂不支持');
        }

        case 'cursor_position':
            // 获取当前鼠标位置（如果有 API 支持）
            return { x: 0, y: 0 };

        default:
            throw new Error(
                `Unknown computer action: "${action}". ` +
                `Valid actions: screenshot, mouse_move, left_click, right_click, middle_click, ` +
                `double_click, triple_click, type, key, cursor_position, bash, str_replace_editor, etc.`
            );
    }
}

/**
 * 执行 bash 工具
 */
async function executeBashTool(args) {
    // 支持多种参数字段名（向后兼容）
    const command = args.command || args.text || args.bash_command;
    const { restart } = args;

    if (!command) {
        throw new Error('Missing bash command parameter. Expected one of: command, text, or bash_command');
    }

    if (restart) {
        console.warn('[Executor] Bash restart 参数被忽略');
    }

    const result = await window.electronAPI.computerUse_executeBash(command);
    return result;
}

/**
 * 执行 text_editor 工具
 */
async function executeTextEditorTool(args) {
    const { command, path } = args;

    switch (command) {
        case 'view':
            return await window.electronAPI.computerUse_readFile(path);

        case 'create':
            return await window.electronAPI.computerUse_writeFile(path, args.file_text || '');

        case 'str_replace': {
            // 先读取文件
            const readResult = await window.electronAPI.computerUse_readFile(path);
            if (!readResult.success) {
                throw new Error(`读取文件失败: ${readResult.error}`);
            }

            // 执行替换
            const newContent = readResult.content.replace(args.old_str, args.new_str);

            // 写回文件
            return await window.electronAPI.computerUse_writeFile(path, newContent);
        }

        case 'insert': {
            // 先读取文件
            const readResult2 = await window.electronAPI.computerUse_readFile(path);
            if (!readResult2.success) {
                throw new Error(`读取文件失败: ${readResult2.error}`);
            }

            // 在指定行插入
            const lines = readResult2.content.split('\n');
            lines.splice(args.insert_line, 0, args.new_str);
            const newContent2 = lines.join('\n');

            // 写回文件
            return await window.electronAPI.computerUse_writeFile(path, newContent2);
        }

        case 'undo_edit':
            // 简单实现：不支持撤销
            throw new Error('Text editor undo_edit 操作暂不支持');

        default:
            throw new Error(`未知的 text_editor 操作: ${command}`);
    }
}

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

    // 特殊处理：Claude 原生工具（computer, bash, text_editor）
    // 这些工具通过 beta header 启用，只在 Claude 原生模式下使用
    // ⭐ XML 模式下即使是 Claude 也使用自定义工具
    const nativeTools = ['computer', 'bash', 'str_replace_based_edit_tool'];
    const { state } = await import('../core/state.js');
    const isClaudeNativeMode = state.apiFormat === 'claude' && !state.xmlToolCallingEnabled;

    // 只有在 Claude 原生模式下才将这些工具名当作原生工具处理
    if (nativeTools.includes(toolId) && isClaudeNativeMode) {
        console.log(`[Executor] 🚀 执行 Claude 原生工具: ${toolId}`);
        console.log(`[Executor] 参数:`, args);

        const result = await executeNativeTool(toolId, args);
        const duration = Date.now() - startTime;

        console.log(`[Executor] 工具执行成功: ${toolId} (耗时 ${duration}ms)`);
        console.log(`[Executor] 结果:`, result);

        return result;
    }

    // XML 模式下的提示
    if (nativeTools.includes(toolId) && state.apiFormat === 'claude' && state.xmlToolCallingEnabled) {
        console.log(`[Executor] 💬 XML 模式：使用自定义工具 "${toolId}"（非 Claude 原生工具）`);
    }

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

        console.log(`[Executor] 工具执行成功: ${toolName} (耗时 ${duration}ms)`);
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
    // 创建 AbortController 用于取消
    const abortController = new AbortController();
    const { signal } = abortController;

    // 根据工具类型选择执行方式
    let executePromise;

    if (tool.type === 'builtin' || tool.type === 'custom') {
        // 内置工具或自定义工具：直接调用处理器
        const handler = getToolHandler(tool.id);
        if (!handler) {
            throw new Error(`工具处理器不存在: ${tool.id}`);
        }
        // 传递 signal（如果处理器支持）
        executePromise = handler(args, { signal });

    } else if (tool.type === 'mcp') {
        // MCP 工具：通过 MCP 客户端调用
        executePromise = executeMCPTool(tool, args, { signal });

    } else {
        throw new Error(`未知工具类型: ${tool.type}`);
    }

    // 创建超时 Promise
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            // 取消执行
            abortController.abort();
            reject(new Error(`工具执行超时 (${timeout}ms)`));
        }, timeout);
    });

    // 竞速：执行 vs 超时
    try {
        const result = await Promise.race([executePromise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        abortController.abort(); // 确保取消
        throw error;
    }
}

/**
 * 执行 MCP 工具
 * @param {Object} tool - MCP 工具定义
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeMCPTool(tool, args, options = {}) {
    // 动态导入 MCP 客户端（避免循环依赖）
    const { callMCPTool } = await import('./mcp/client.js');

    return callMCPTool(tool.serverId, tool.name, args, options);
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
    console.log(`[Executor] 批量执行完成: ${successCount}/${toolCalls.length} 成功`);

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
