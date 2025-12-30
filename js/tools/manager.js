/**
 * 工具管理器模块
 * 负责工具的注册、启用/禁用、格式转换
 *
 * 发布事件:
 * - tool:registered { toolId, type }
 * - tool:enabled:changed { toolId, enabled }
 * - tools:added (触发保存)
 * - tools:updated (触发保存)
 * - tools:removed (触发保存)
 *
 * ⚠️ 注意：部分工具管理 API 目前没有 UI 界面
 *
 * 📚 可用但未使用的 API：
 * - registerCustomTool() - 注册自定义工具
 * - removeTool() - 移除工具
 * - isToolEnabled() - 检查工具是否启用
 * - getAllTools() - 获取所有工具（内部使用）
 * - getEnabledTools() - 获取已启用工具（内部使用）
 *
 * 💡 未来可以创建 js/ui/tool-manager.js 来提供：
 * - 工具列表展示
 * - 工具启用/禁用开关
 * - 自定义工具添加界面
 * - 工具移除功能
 */

import { eventBus } from '../core/events.js';
import { generateId } from '../utils/helpers.js';
import { mcpClient } from './mcp/client.js';
import { savePreference, loadPreference } from '../state/storage.js';
import { state } from '../core/state.js';  // 用于检查 computerUseEnabled

// ========== 模块私有状态 ==========

/**
 * 工具注册表
 * Map<toolId, ToolDefinition>
 */
const toolRegistry = new Map();

/**
 * 工具处理器映射
 * Map<toolId, Function>
 */
const toolHandlers = new Map();

/**
 * 工具类型映射
 * Map<toolId, 'builtin' | 'mcp' | 'custom'>
 */
const toolTypes = new Map();

/**
 * 工具启用状态
 * Map<toolId, boolean>
 */
const toolEnabled = new Map();

/**
 * 工具名称反向索引（用于快速查找）
 * Map<toolName, Set<toolId>>
 */
const toolNameIndex = new Map();

// ========== 反向索引辅助函数 ==========

/**
 * 添加工具名称到反向索引
 * @param {string} toolName - 工具名称
 * @param {string} toolId - 工具 ID
 */
function addToNameIndex(toolName, toolId) {
    if (!toolNameIndex.has(toolName)) {
        toolNameIndex.set(toolName, new Set());
    }
    toolNameIndex.get(toolName).add(toolId);
}

/**
 * 从反向索引中移除工具名称
 * @param {string} toolName - 工具名称
 * @param {string} toolId - 工具 ID
 */
function removeFromNameIndex(toolName, toolId) {
    if (toolNameIndex.has(toolName)) {
        const idSet = toolNameIndex.get(toolName);
        idSet.delete(toolId);
        if (idSet.size === 0) {
            toolNameIndex.delete(toolName);
        }
    }
}

// ========== 工具注册 API ==========

/**
 * 注册内置工具
 * @param {string} toolId - 工具唯一标识符
 * @param {Object} toolDefinition - 工具定义（OpenAI 格式）
 * @param {Function} handler - 工具处理函数
 * @returns {void}
 */
export function registerBuiltinTool(toolId, toolDefinition, handler) {
    if (toolRegistry.has(toolId)) {
        console.warn(`[Tools] 工具 "${toolId}" 已存在，将被覆盖`);
    }

    // 存储工具定义
    toolRegistry.set(toolId, {
        id: toolId,
        ...toolDefinition,
        type: 'builtin'
    });

    // 存储处理器
    toolHandlers.set(toolId, handler);

    // 存储类型
    toolTypes.set(toolId, 'builtin');

    // 默认禁用（用户需要手动启用）
    toolEnabled.set(toolId, false);

    // 添加到名称索引
    addToNameIndex(toolDefinition.name || toolId, toolId);

    console.log(`[Tools] 已注册内置工具: ${toolId}`);

    // 发布事件
    eventBus.emit('tool:registered', { toolId, type: 'builtin' });
    eventBus.emit('tools:added', { toolId });
}

/**
 * 注册 MCP 工具
 * @param {string} serverId - MCP 服务器 ID
 * @param {string} toolName - 工具名称
 * @param {Object} toolDefinition - 工具定义（MCP 格式）
 * @returns {string} 工具 ID
 */
export function registerMCPTool(serverId, toolName, toolDefinition) {
    // MCP 工具 ID 格式: {serverId}__{toolName}
    const toolId = `${serverId}__${toolName}`;

    // 转换 MCP 工具定义为通用格式
    const normalizedTool = {
        id: toolId,
        name: toolName,
        description: toolDefinition.description || '',
        inputSchema: toolDefinition.inputSchema || { type: 'object', properties: {} },
        type: 'mcp',
        serverId
    };

    toolRegistry.set(toolId, normalizedTool);
    toolTypes.set(toolId, 'mcp');
    toolEnabled.set(toolId, false);  // 默认禁用

    // 添加到名称索引
    addToNameIndex(toolName, toolId);

    console.log(`[Tools] 已注册 MCP 工具: ${toolId} (来自 ${serverId})`);

    // 发布事件
    eventBus.emit('tool:registered', { toolId, type: 'mcp', serverId });
    eventBus.emit('tools:added', { toolId });

    return toolId;
}

/**
 * 注册自定义工具（用户添加）
 * @param {Object} toolConfig - 工具配置
 * @param {boolean} skipSave - 是否跳过保存（加载时使用）
 * @returns {string} 工具 ID
 */
export function registerCustomTool(toolConfig, skipSave = false) {
    const toolId = toolConfig.id || `custom_${generateId()}`;

    toolRegistry.set(toolId, {
        ...toolConfig,
        id: toolId,
        type: 'custom'
    });

    toolTypes.set(toolId, 'custom');
    toolEnabled.set(toolId, toolConfig.enabled !== false);

    // 添加到名称索引
    addToNameIndex(toolConfig.name || toolId, toolId);

    console.log(`[Tools] 已注册自定义工具: ${toolId}`);

    // 保存到持久化存储（除非是加载时）
    if (!skipSave) {
        saveCustomTools();
    }

    eventBus.emit('tool:registered', { toolId, type: 'custom' });
    eventBus.emit('tools:added', { toolId });

    return toolId;
}

// ========== 工具查询 API ==========

/**
 * 获取所有工具（通用格式）
 * @returns {Array} 工具列表
 */
export function getAllTools() {
    return Array.from(toolRegistry.values());
}

/**
 * 获取所有已启用的工具
 * @returns {Array} 已启用工具列表
 */
export function getEnabledTools() {
    return Array.from(toolRegistry.values()).filter(tool =>
        toolEnabled.get(tool.id) === true
    );
}

/**
 * 根据 API 格式获取工具列表
 * @param {string} apiFormat - API 格式 ('openai' | 'gemini' | 'claude')
 * @returns {Array} 转换后的工具列表
 */
export function getToolsForAPI(apiFormat) {
    let enabledTools = getEnabledTools();

    // 特殊处理：Computer Use 工具
    // - Claude 原生模式: 使用原生 Computer Use（beta header），过滤掉自定义 computer 工具
    // - Claude XML 模式: 使用自定义 computer 工具（保留）
    // - OpenAI/Gemini: 使用自定义 computer 工具（如果启用了 computerUseEnabled）
    if (apiFormat === 'claude' && !state.xmlToolCallingEnabled) {
        // Claude 原生模式：过滤掉自定义 computer 工具（使用原生版本）
        enabledTools = enabledTools.filter(tool => tool.name !== 'computer');
    } else if (apiFormat === 'claude' && state.xmlToolCallingEnabled) {
        // Claude XML 模式：保留自定义 computer 工具
        // 不需要过滤，直接使用 enabledTools
    } else if (apiFormat !== 'claude') {
        // OpenAI/Gemini: 根据 state.computerUseEnabled 决定是否包含
        if (!state.computerUseEnabled) {
            enabledTools = enabledTools.filter(tool => tool.name !== 'computer');
        }
    }

    switch (apiFormat) {
        case 'openai':
        case 'openai-responses':  // Responses API 使用与 OpenAI 相同的工具格式
            return enabledTools.map(convertToOpenAIFormat);
        case 'gemini':
            return enabledTools.map(convertToGeminiFormat);
        case 'claude':
            return enabledTools.map(convertToClaudeFormat);
        default:
            console.warn(`[Tools] 未知 API 格式: ${apiFormat}`);
            return [];
    }
}

/**
 * 获取单个工具定义
 * @param {string} toolId - 工具 ID 或工具名称
 * @returns {Object|null} 工具定义
 */
export function getTool(toolId) {
    // 1. 尝试直接通过 ID 查找
    let tool = toolRegistry.get(toolId);
    if (tool) return tool;

    // 2. 通过名称索引查找（O(1)优化）
    // 这是为了兼容 MCP 工具的情况：
    // - 注册时 ID = "serverId__toolName"
    // - API 响应中 name = "toolName"
    if (toolNameIndex.has(toolId)) {
        const matchingIds = toolNameIndex.get(toolId);

        // 多个同名工具时，优先返回 MCP 工具
        if (matchingIds.size > 1) {
            console.warn(`[Tools] ⚠️ 发现 ${matchingIds.size} 个名为 "${toolId}" 的工具`);
            for (const id of matchingIds) {
                const t = toolRegistry.get(id);
                if (t && t.type === 'mcp') {
                    console.log(`[Tools] 🔍 使用 MCP 工具: ${id}`);
                    return t;
                }
            }
        }

        // 返回第一个匹配的工具
        const firstId = matchingIds.values().next().value;
        if (firstId) {
            tool = toolRegistry.get(firstId);
            console.log(`[Tools] 🔍 通过名称找到工具: "${toolId}" -> ${firstId}`);
            return tool;
        }
    }

    return null;
}

/**
 * 获取工具处理器
 * @param {string} toolId - 工具 ID
 * @returns {Function|null} 处理函数
 */
export function getToolHandler(toolId) {
    return toolHandlers.get(toolId) || null;
}

// ========== 格式转换 ==========

/**
 * 转换为 OpenAI 格式
 * @param {Object} tool - 通用工具定义
 * @returns {Object} OpenAI 格式
 */
function convertToOpenAIFormat(tool) {
    return {
        type: 'function',
        function: {
            name: tool.name || tool.id,
            description: tool.description,
            // 兼容多种字段命名: parameters (builtin), inputSchema (MCP), input_schema (Claude)
            parameters: tool.parameters || tool.inputSchema || tool.input_schema || { type: 'object', properties: {} }
        }
    };
}

/**
 * 转换为 Gemini 格式
 * @param {Object} tool - 通用工具定义
 * @returns {Object} Gemini 格式
 */
function convertToGeminiFormat(tool) {
    // 兼容多种字段命名: parameters (builtin), inputSchema (MCP), input_schema (Claude)
    const schema = tool.parameters || tool.inputSchema || tool.input_schema || { type: 'object', properties: {} };

    return {
        name: tool.name || tool.id,
        description: tool.description,
        parameters: cleanSchemaForGemini(schema)
    };
}

/**
 * 清理 JSON Schema，移除 Gemini 不支持的字段
 * @param {Object} schema - 原始 JSON Schema
 * @returns {Object} 清理后的 schema
 */
function cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    // Gemini 不支持的字段列表
    const unsupportedFields = [
        '$schema',
        'additionalProperties',
        'title',
        'examples',
        'default',
        '$defs',
        'definitions',
        'patternProperties',
        'dependencies',
        'allOf',
        'anyOf',
        'oneOf',
        'not'
    ];

    // 创建新对象（避免修改原对象）
    const cleaned = Array.isArray(schema) ? [...schema] : { ...schema };

    // 删除不支持的字段
    for (const field of unsupportedFields) {
        delete cleaned[field];
    }

    // 递归清理嵌套对象
    if (cleaned.properties && typeof cleaned.properties === 'object') {
        cleaned.properties = Object.fromEntries(
            Object.entries(cleaned.properties).map(([key, value]) => [
                key,
                cleanSchemaForGemini(value)
            ])
        );
    }

    // 递归清理数组项
    if (cleaned.items && typeof cleaned.items === 'object') {
        cleaned.items = cleanSchemaForGemini(cleaned.items);
    }

    return cleaned;
}

/**
 * 转换为 Claude 格式
 * @param {Object} tool - 通用工具定义
 * @returns {Object} Claude 格式
 */
function convertToClaudeFormat(tool) {
    // Claude 使用 input_schema，兼容多种字段命名
    const schema = tool.input_schema || tool.inputSchema || tool.parameters || { type: 'object', properties: {} };

    return {
        name: tool.name || tool.id,
        description: tool.description,
        input_schema: schema
    };
}

// ========== 工具管理 API ==========

/**
 * 启用/禁用工具
 * @param {string} toolId - 工具 ID
 * @param {boolean} enabled - 是否启用
 */
export function setToolEnabled(toolId, enabled) {
    if (!toolRegistry.has(toolId)) {
        console.warn(`[Tools] 工具不存在: ${toolId}`);
        return;
    }

    toolEnabled.set(toolId, enabled);

    console.log(`[Tools] 工具 "${toolId}" 已${enabled ? '启用' : '禁用'}`);

    // 发布事件
    eventBus.emit('tool:enabled:changed', { toolId, enabled });
    eventBus.emit('tools:updated', { toolId });

    // 保存状态
    saveToolStates();
}

/**
 * 检查工具是否启用
 * @param {string} toolId - 工具 ID
 * @returns {boolean}
 */
export function isToolEnabled(toolId) {
    return toolEnabled.get(toolId) === true;
}

/**
 * 移除工具
 * @param {string} toolId - 工具 ID
 */
export function removeTool(toolId) {
    if (!toolRegistry.has(toolId)) {
        console.warn(`[Tools] 工具不存在: ${toolId}`);
        return;
    }

    const tool = toolRegistry.get(toolId);
    const toolType = toolTypes.get(toolId);

    // 禁止移除内置工具
    if (toolType === 'builtin') {
        console.warn(`[Tools] 无法移除内置工具: ${toolId}`);
        return;
    }

    // 从名称索引中移除
    if (tool && tool.name) {
        removeFromNameIndex(tool.name, toolId);
    }

    toolRegistry.delete(toolId);
    toolHandlers.delete(toolId);
    toolTypes.delete(toolId);
    toolEnabled.delete(toolId);

    console.log(`[Tools] ❌ 已移除工具: ${toolId}`);

    // 保存到持久化存储（仅自定义工具）
    if (toolType === 'custom') {
        saveCustomTools();
    }

    // 发布事件
    eventBus.emit('tool:removed', { toolId });
    eventBus.emit('tools:removed', { toolId });
}

/**
 * 清空所有 MCP 工具（断开连接时调用）
 * @param {string} serverId - MCP 服务器 ID
 */
export function clearMCPTools(serverId) {
    const mcpTools = Array.from(toolRegistry.values()).filter(
        tool => tool.type === 'mcp' && tool.serverId === serverId
    );

    mcpTools.forEach(tool => {
        // 从名称索引中移除
        if (tool.name) {
            removeFromNameIndex(tool.name, tool.id);
        }

        toolRegistry.delete(tool.id);
        toolHandlers.delete(tool.id);
        toolTypes.delete(tool.id);
        toolEnabled.delete(tool.id);
    });

    console.log(`[Tools] 已清空 MCP 服务器 "${serverId}" 的 ${mcpTools.length} 个工具`);
}

// ========== 统计信息 ==========

/**
 * 获取工具统计信息
 * @returns {Object} 统计数据
 */
export function getToolStats() {
    const tools = Array.from(toolRegistry.values());
    // 过滤掉隐藏工具（如 Computer Use），仅统计用户可见工具
    const visibleTools = tools.filter(t => !t.hidden);

    return {
        total: visibleTools.length,
        enabled: visibleTools.filter(t => toolEnabled.get(t.id)).length,
        builtin: visibleTools.filter(t => t.type === 'builtin').length,
        mcp: visibleTools.filter(t => t.type === 'mcp').length,
        custom: visibleTools.filter(t => t.type === 'custom').length
    };
}

/**
 * 调试：打印工具列表
 */
export function debugTools() {
    console.log('📊 工具管理器状态:');
    console.log(getToolStats());
    console.log('已注册工具:');

    toolRegistry.forEach((tool, id) => {
        const enabled = toolEnabled.get(id);
        const type = toolTypes.get(id);
        console.log(`  ${enabled ? '' : '⭕'} [${type}] ${id} - ${tool.description}`);
    });
}

// ========== MCP 集成 ==========

/**
 * 同步 MCP 服务器的工具到管理器
 * @param {string} serverId - MCP 服务器 ID
 */
export function syncMCPTools(serverId) {
    // 先清空该服务器的旧工具
    clearMCPTools(serverId);

    // 从 MCP 客户端获取工具
    const mcpTools = mcpClient.getToolsByServer(serverId);

    // 注册每个工具
    mcpTools.forEach(tool => {
        registerMCPTool(serverId, tool.name, tool.mcpDefinition);
    });

    console.log(`[Tools] 🔄 已同步 ${mcpTools.length} 个工具 (MCP 服务器: ${serverId})`);
}

/**
 * 获取 MCP 工具的处理器（动态生成）
 * @param {string} toolId - 工具 ID
 * @returns {Function} 处理函数
 */
export function getMCPToolHandler(toolId) {
    const tool = toolRegistry.get(toolId);
    if (!tool || tool.type !== 'mcp') {
        return null;
    }

    // 返回一个调用 MCP 客户端的处理器
    return async (args) => {
        const fullToolId = `${tool.serverId}/${tool.name}`;
        return await mcpClient.callTool(fullToolId, args);
    };
}

// 监听 MCP 工具发现事件，自动注册工具
eventBus.on('mcp:tools-discovered', ({ serverId, tools }) => {
    console.log(`[Tools] 📡 检测到 MCP 工具发现事件: ${serverId} (${tools.length} 个工具)`);
    syncMCPTools(serverId);
});

// 监听 MCP 断开连接事件，清除工具
eventBus.on('mcp:disconnected', ({ serverId }) => {
    console.log(`[Tools] 🔌 检测到 MCP 断开连接: ${serverId}`);
    clearMCPTools(serverId);
});

// ========== 工具状态持久化 ==========

/**
 * 保存工具启用状态到持久化存储
 */
async function saveToolStates() {
    try {
        // 将 Map 转换为普通对象
        const states = {};
        toolEnabled.forEach((enabled, toolId) => {
            // 跳过隐藏工具的状态保存（由初始化代码控制）
            const tool = toolRegistry.get(toolId);
            if (tool && tool.hidden) {
                return; // forEach 的 return 相当于 continue
            }

            states[toolId] = enabled;
        });

        await savePreference('toolsEnabled', JSON.stringify(states));
        console.log('[Tools] 工具状态已保存');
    } catch (error) {
        console.error('[Tools] ❌ 保存工具状态失败:', error);
    }
}

/**
 * 从持久化存储加载工具启用状态
 */
export async function loadToolStates() {
    try {
        const statesJson = await loadPreference('toolsEnabled');
        if (!statesJson) {
            console.log('[Tools] 没有已保存的工具状态');
            return;
        }

        const states = JSON.parse(statesJson);
        let restoredCount = 0;

        // 恢复工具状态
        for (const [toolId, enabled] of Object.entries(states)) {
            if (toolRegistry.has(toolId)) {
                const tool = toolRegistry.get(toolId);

                // 跳过隐藏工具的状态加载（保持初始化时的设置）
                // 例如 computer 工具在 init.js 中被强制启用，不应被持久化状态覆盖
                if (tool.hidden) {
                    console.log(`[Tools] 跳过隐藏工具 "${toolId}" 的状态恢复（保持初始化设置）`);
                    continue;
                }

                toolEnabled.set(toolId, enabled);
                restoredCount++;
            }
        }

        console.log(`[Tools] 已恢复 ${restoredCount} 个工具的状态`);
    } catch (error) {
        console.error('[Tools] ❌ 加载工具状态失败:', error);
    }
}

/**
 * 保存所有自定义工具到持久化存储
 */
export async function saveCustomTools() {
    try {
        // 获取所有自定义工具
        const customTools = [];
        for (const [toolId, tool] of toolRegistry.entries()) {
            if (toolTypes.get(toolId) === 'custom') {
                customTools.push({
                    id: toolId,
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    enabled: toolEnabled.get(toolId),
                    permissions: tool.permissions,
                    rateLimit: tool.rateLimit
                });
            }
        }

        await savePreference('customTools', JSON.stringify(customTools));
        console.log(`[Tools] 已保存 ${customTools.length} 个自定义工具`);
    } catch (error) {
        console.error('[Tools] ❌ 保存自定义工具失败:', error);
    }
}

/**
 * 从持久化存储加载自定义工具
 */
export async function loadCustomTools() {
    try {
        const toolsJson = await loadPreference('customTools');
        if (!toolsJson) {
            console.log('[Tools] 没有已保存的自定义工具');
            return;
        }

        const tools = JSON.parse(toolsJson);
        let loadedCount = 0;

        for (const toolConfig of tools) {
            registerCustomTool(toolConfig, true); // skipSave = true，加载时不触发保存
            loadedCount++;
        }

        console.log(`[Tools] 已加载 ${loadedCount} 个自定义工具`);
    } catch (error) {
        console.error('[Tools] ❌ 加载自定义工具失败:', error);
    }
}
