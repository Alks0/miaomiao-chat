/**
 * Computer Use 工具
 * 允许 AI 执行 bash 命令和编辑文件
 * ⚠️ 仅在 Electron 环境中可用
 */

/**
 * 工具定义（OpenAI 格式）
 */
export const computerUseTool = {
    name: 'computer',
    description: '执行计算机操作：bash 命令执行和文本文件编辑。',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['bash', 'str_replace_editor'],
                description: '要执行的操作类型：bash（执行命令）或 str_replace_editor（编辑文件）'
            },
            // Bash 参数
            text: {
                type: 'string',
                description: 'Bash 命令（用于 bash 动作）'
            },
            command: {
                type: 'string',
                description: '编辑器命令（用于 str_replace_editor 动作）或 bash 命令'
            },
            bash_command: {
                type: 'string',
                description: 'Bash 命令（备用字段）'
            },
            // 文本编辑器参数
            path: {
                type: 'string',
                description: '文件路径（用于文本编辑器操作）'
            },
            file_text: {
                type: 'string',
                description: '文件完整内容（用于 create 命令或 insert 命令的插入内容）'
            },
            old_str: {
                type: 'string',
                description: '要替换的旧字符串（用于 str_replace 命令）'
            },
            new_str: {
                type: 'string',
                description: '新字符串（用于 str_replace 命令）'
            },
            insert_line: {
                type: 'number',
                description: '插入位置行号（用于 insert 命令）'
            }
        },
        required: ['action']
    },
    // 标记为隐藏工具（不在工具管理面板显示）
    hidden: true
};

/**
 * 工具处理器
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 执行结果
 */
export async function computerUseHandler(args) {
    const { action } = args;

    console.log(`[Computer Use] Action: ${action}`, args);

    // 检查是否在 Electron 环境
    if (!window.electronAPI || !window.electronAPI.isElectron()) {
        throw new Error('Computer Use 仅在 Electron 环境中可用');
    }

    try {
        switch (action) {
            case 'bash':
                return await handleBash(args);

            case 'str_replace_editor':
                return await handleTextEditor(args);

            default:
                throw new Error(`Unknown action: ${action}. Only 'bash' and 'str_replace_editor' are supported.`);
        }
    } catch (error) {
        console.error(`[Computer Use] Error in ${action}:`, error);
        throw error;
    }
}

// ========== 操作处理函数 ==========

/**
 * 执行 Bash 命令
 */
async function handleBash(args) {
    // 支持多种参数字段名（向后兼容）
    // - text: 原始定义
    // - command: 常用名称
    // - bash_command: 明确的bash命令字段
    const command = args.text || args.command || args.bash_command;

    if (!command) {
        throw new Error('Missing bash command parameter. Expected one of: text, command, or bash_command');
    }

    const result = await window.electronAPI.computerUse_executeBash(command);

    if (!result.success) {
        throw new Error(result.error || 'Bash execution failed');
    }

    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
    };
}

/**
 * 文本编辑器操作
 */
async function handleTextEditor(args) {
    const { command, path, file_text, old_str, new_str, insert_line } = args;

    if (!command) {
        throw new Error('command is required for str_replace_editor action');
    }

    switch (command) {
        case 'view':
            return await viewFile(path);

        case 'create':
            return await createFile(path, file_text);

        case 'str_replace':
            return await replaceString(path, old_str, new_str);

        case 'insert':
            return await insertLine(path, insert_line, file_text);

        default:
            throw new Error(`Unknown editor command: ${command}`);
    }
}

/**
 * 查看文件
 */
async function viewFile(path) {
    if (!path) {
        throw new Error('path is required for view command');
    }

    const result = await window.electronAPI.computerUse_readFile(path);

    if (!result.success) {
        throw new Error(result.error || 'Read file failed');
    }

    return {
        content: result.content,
        size: result.size
    };
}

/**
 * 创建文件
 */
async function createFile(path, content) {
    if (!path || !content) {
        throw new Error('path and file_text are required for create command');
    }

    const result = await window.electronAPI.computerUse_writeFile(path, content);

    if (!result.success) {
        throw new Error(result.error || 'Create file failed');
    }

    return {
        path: result.path,
        size: result.size
    };
}

/**
 * 替换字符串
 */
async function replaceString(path, oldStr, newStr) {
    if (!path || oldStr === undefined || newStr === undefined) {
        throw new Error('path, old_str, and new_str are required for str_replace command');
    }

    // 读取文件
    const readResult = await window.electronAPI.computerUse_readFile(path);
    if (!readResult.success) {
        throw new Error(readResult.error || 'Read file failed');
    }

    // 替换字符串
    const newContent = readResult.content.replace(oldStr, newStr);

    // 写回文件
    const writeResult = await window.electronAPI.computerUse_writeFile(path, newContent);
    if (!writeResult.success) {
        throw new Error(writeResult.error || 'Write file failed');
    }

    return {
        path: writeResult.path,
        size: writeResult.size,
        replaced: true
    };
}

/**
 * 插入行
 */
async function insertLine(path, lineNumber, text) {
    if (!path || lineNumber === undefined || !text) {
        throw new Error('path, insert_line, and file_text are required for insert command');
    }

    // 读取文件
    const readResult = await window.electronAPI.computerUse_readFile(path);
    if (!readResult.success) {
        throw new Error(readResult.error || 'Read file failed');
    }

    // 插入行
    const lines = readResult.content.split('\n');
    lines.splice(lineNumber, 0, text);
    const newContent = lines.join('\n');

    // 写回文件
    const writeResult = await window.electronAPI.computerUse_writeFile(path, newContent);
    if (!writeResult.success) {
        throw new Error(writeResult.error || 'Write file failed');
    }

    return {
        path: writeResult.path,
        size: writeResult.size,
        inserted: true
    };
}
