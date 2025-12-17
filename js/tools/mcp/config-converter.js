/**
 * MCP 配置格式转换器
 * 支持标准 MCP JSON 格式（Claude Desktop、Cursor 等）与内部格式的双向转换
 */

/**
 * 标准 MCP JSON 格式 → 内部格式
 * @param {Object} standardConfig - 标准格式 { mcpServers: { ... } }
 * @returns {Array} 内部格式的服务器数组
 */
export function standardToInternal(standardConfig) {
    const servers = [];

    if (!standardConfig || !standardConfig.mcpServers) {
        throw new Error('无效的配置格式：缺少 mcpServers 字段');
    }

    const mcpServers = standardConfig.mcpServers;

    for (const [serverName, config] of Object.entries(mcpServers)) {
        try {
            const internalServer = convertSingleServer(serverName, config);
            servers.push(internalServer);
        } catch (error) {
            console.warn(`[MCP Config] 跳过无效服务器 "${serverName}": ${error.message}`);
        }
    }

    return servers;
}

// ID 生成计数器（避免短时间内重复）
let idCounter = 0;

/**
 * 生成唯一的服务器 ID
 * @returns {string} 唯一 ID
 */
function generateServerId() {
    // 使用时间戳 + 计数器 + 随机数三重保障
    const timestamp = Date.now();
    const counter = (idCounter++ % 10000).toString().padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 11);
    return `mcp_${timestamp}_${counter}_${random}`;
}

/**
 * 转换单个服务器配置
 * @param {string} serverName - 服务器名称
 * @param {Object} config - 标准配置对象
 * @returns {Object} 内部格式的服务器对象
 */
function convertSingleServer(serverName, config) {
    const serverId = generateServerId();

    // 判断服务器类型
    const isLocal = !!(config.command || config.args);
    const isRemote = !!(config.url || config.type);

    if (isLocal && isRemote) {
        throw new Error('配置同时包含本地和远程字段，请选择其中一种');
    }

    if (!isLocal && !isRemote) {
        throw new Error('配置缺少必要字段（command/args 或 url/type）');
    }

    // 构建内部格式
    const internalServer = {
        id: serverId,
        name: serverName,
        enabled: config.enabled !== false, // 默认启用
        type: isLocal ? 'local' : 'remote',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    if (isLocal) {
        // STDIO 本地服务器
        if (!config.command) {
            throw new Error('本地服务器缺少 command 字段');
        }

        internalServer.command = config.command;
        internalServer.args = config.args || [];
        internalServer.env = config.env || {};
        internalServer.cwd = config.cwd || '';
    } else {
        // 远程服务器
        if (!config.url) {
            throw new Error('远程服务器缺少 url 字段');
        }

        internalServer.url = config.url;

        // 确定传输类型
        if (config.type === 'sse') {
            internalServer.transportType = 'sse';
        } else if (config.type === 'streamable-http') {
            internalServer.transportType = 'streamable-http';
        } else if (!config.type) {
            // 自动检测：WebSocket 还是 HTTP
            if (internalServer.url.startsWith('ws://') || internalServer.url.startsWith('wss://')) {
                internalServer.transportType = 'websocket';
            } else {
                internalServer.transportType = 'http';
            }
        } else {
            throw new Error(`不支持的传输类型: ${config.type}`);
        }

        // 处理 API Key / Headers
        if (config.headers) {
            // 从 headers 中提取 Authorization
            const authHeader = config.headers['Authorization'] || config.headers['authorization'];
            if (authHeader) {
                // Bearer token
                const match = authHeader.match(/Bearer\s+(.+)/i);
                if (match) {
                    internalServer.apiKey = match[1];
                } else {
                    internalServer.apiKey = authHeader;
                }
            }
            // 保存其他 headers
            internalServer.customHeaders = config.headers;
        } else if (config.apiKey) {
            internalServer.apiKey = config.apiKey;
        }
    }

    return internalServer;
}

/**
 * 内部格式 → 标准 MCP JSON 格式
 * @param {Array} internalServers - 内部格式的服务器数组
 * @returns {Object} 标准格式 { mcpServers: { ... } }
 */
export function internalToStandard(internalServers) {
    const standardConfig = {
        mcpServers: {}
    };

    if (!Array.isArray(internalServers)) {
        throw new Error('internalServers 必须是数组');
    }

    for (const server of internalServers) {
        const serverName = server.name || server.id;

        try {
            const standardServer = convertToStandardFormat(server);
            standardConfig.mcpServers[serverName] = standardServer;
        } catch (error) {
            console.warn(`[MCP Config] 跳过无效服务器 "${serverName}": ${error.message}`);
        }
    }

    return standardConfig;
}

/**
 * 转换单个服务器到标准格式
 * @param {Object} server - 内部格式的服务器对象
 * @returns {Object} 标准格式的配置对象
 */
function convertToStandardFormat(server) {
    const standardServer = {};

    if (server.type === 'local') {
        // STDIO 本地服务器
        if (!server.command) {
            throw new Error('本地服务器缺少 command 字段');
        }

        standardServer.command = server.command;

        if (server.args && server.args.length > 0) {
            standardServer.args = server.args;
        }

        if (server.env && Object.keys(server.env).length > 0) {
            standardServer.env = server.env;
        }

        if (server.cwd) {
            standardServer.cwd = server.cwd;
        }
    } else if (server.type === 'remote') {
        // 远程服务器
        if (!server.url) {
            throw new Error('远程服务器缺少 url 字段');
        }

        standardServer.url = server.url;

        // 添加 type 字段
        if (server.transportType === 'sse') {
            standardServer.type = 'sse';
        } else if (server.transportType === 'streamable-http') {
            standardServer.type = 'streamable-http';
        }
        // 注意：websocket 和 http 不需要显式 type（通过 URL 推断）

        // 添加 headers
        if (server.customHeaders) {
            standardServer.headers = server.customHeaders;
        } else if (server.apiKey) {
            standardServer.headers = {
                'Authorization': `Bearer ${server.apiKey}`
            };
        }
    } else {
        throw new Error(`未知的服务器类型: ${server.type}`);
    }

    // 添加启用状态（非标准字段，但有些工具支持）
    if (server.enabled !== undefined) {
        standardServer.enabled = server.enabled;
    }

    return standardServer;
}

/**
 * 验证标准 MCP JSON 配置
 * @param {Object} config - 要验证的配置对象
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateStandardConfig(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
        return { valid: false, errors: ['配置必须是一个对象'] };
    }

    if (!config.mcpServers) {
        return { valid: false, errors: ['配置缺少 mcpServers 字段'] };
    }

    if (typeof config.mcpServers !== 'object') {
        return { valid: false, errors: ['mcpServers 必须是一个对象'] };
    }

    const serverNames = Object.keys(config.mcpServers);

    if (serverNames.length === 0) {
        return { valid: false, errors: ['mcpServers 不能为空'] };
    }

    // 验证每个服务器
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
        if (!serverConfig || typeof serverConfig !== 'object') {
            errors.push(`服务器 "${serverName}" 的配置无效（必须是对象）`);
            continue;
        }

        const isLocal = !!(serverConfig.command || serverConfig.args);
        const isRemote = !!(serverConfig.url || serverConfig.type);

        if (isLocal && isRemote) {
            errors.push(`服务器 "${serverName}" 同时包含本地和远程字段`);
        } else if (!isLocal && !isRemote) {
            errors.push(`服务器 "${serverName}" 缺少必要字段（command/args 或 url/type）`);
        }

        // 本地服务器验证
        if (isLocal && !serverConfig.command) {
            errors.push(`本地服务器 "${serverName}" 缺少 command 字段`);
        }

        // 远程服务器验证
        if (isRemote && !serverConfig.url) {
            errors.push(`远程服务器 "${serverName}" 缺少 url 字段`);
        }

        // 传输类型验证
        if (serverConfig.type && !['sse', 'streamable-http'].includes(serverConfig.type)) {
            errors.push(`服务器 "${serverName}" 的传输类型 "${serverConfig.type}" 无效（支持: sse, streamable-http）`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 生成 MCP 配置模板
 * @param {string} templateName - 模板名称
 * @returns {Object} 标准格式的配置模板
 */
export function generateTemplate(templateName) {
    const templates = {
        'empty': {
            mcpServers: {}
        },

        'filesystem': {
            mcpServers: {
                'filesystem': {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/directory'],
                    enabled: true
                }
            }
        },

        'memory': {
            mcpServers: {
                'memory': {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-memory'],
                    enabled: true
                }
            }
        },

        'fetch': {
            mcpServers: {
                'fetch': {
                    command: 'uvx',
                    args: ['mcp-server-fetch', '--ignore-robots-txt'],
                    enabled: true
                }
            }
        },

        'sqlite': {
            mcpServers: {
                'sqlite': {
                    command: 'uvx',
                    args: ['mcp-server-sqlite', '--db-path', '/path/to/database.db'],
                    enabled: true
                }
            }
        },

        'github': {
            mcpServers: {
                'github': {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-github'],
                    env: {
                        'GITHUB_PERSONAL_ACCESS_TOKEN': 'your-token-here'
                    },
                    enabled: true
                }
            }
        },

        'sse': {
            mcpServers: {
                'my-sse-server': {
                    type: 'sse',
                    url: 'http://localhost:8001/sse',
                    headers: {
                        'Authorization': 'Bearer your-token-here'
                    },
                    enabled: true
                }
            }
        },

        'streamable-http': {
            mcpServers: {
                'my-http-server': {
                    type: 'streamable-http',
                    url: 'http://localhost:8002/mcp',
                    enabled: true
                }
            }
        }
    };

    return templates[templateName] || templates['empty'];
}

/**
 * 获取可用的模板列表
 * @returns {Array} 模板信息数组
 */
export function getAvailableTemplates() {
    return [
        { id: 'empty', name: '空模板', description: '创建一个空的配置文件' },
        { id: 'filesystem', name: 'Filesystem (NPX)', description: '文件系统访问服务器' },
        { id: 'memory', name: 'Memory (NPX)', description: '记忆存储服务器' },
        { id: 'fetch', name: 'Fetch (UVX)', description: 'Web 抓取服务器' },
        { id: 'sqlite', name: 'SQLite (UVX)', description: 'SQLite 数据库服务器' },
        { id: 'github', name: 'GitHub (NPX)', description: 'GitHub API 服务器' },
        { id: 'sse', name: 'SSE 远程服务器', description: '使用 Server-Sent Events 的远程服务器' },
        { id: 'streamable-http', name: 'Streamable HTTP 远程服务器', description: '使用 Streamable HTTP 的远程服务器' }
    ];
}
