/**
 * Bash 命令执行模块
 * 使用 Node.js child_process
 */

const { exec } = require('child_process');
const path = require('path');

/**
 * 执行 Bash 命令
 * @param {string} command - 命令字符串
 * @param {Object} config - 配置对象
 * @param {string} config.workingDirectory - 工作目录
 * @param {number} config.timeout - 超时时间（秒）
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execute(command, config = {}) {
    const {
        workingDirectory = process.cwd(),
        timeout = 30
    } = config;

    // ✅ 如果 workingDirectory 为空字符串，使用 process.cwd()
    const cwd = workingDirectory && workingDirectory.trim() !== ''
        ? workingDirectory
        : process.cwd();

    return new Promise((resolve, reject) => {
        const options = {
            cwd: cwd,
            timeout: timeout * 1000,
            maxBuffer: 10 * 1024 * 1024, // 10 MB
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        };

        console.log(`[Bash] Executing: ${command}`);
        console.log(`[Bash] Working directory: ${cwd}`);
        console.log(`[Bash] Timeout: ${timeout}s`);

        const childProcess = exec(command, options, (error, stdout, stderr) => {
            const exitCode = error ? (error.code || 1) : 0;
            const result = {
                stdout: stdout.toString(),
                stderr: stderr.toString(),
                exitCode: exitCode,
                success: exitCode === 0  // ✅ 添加成功标志
            };

            if (error) {
                if (error.killed) {
                    console.error(`[Bash] Command timeout after ${timeout}s`);
                    result.stderr += `\nCommand timeout after ${timeout}s`;
                } else {
                    console.error(`[Bash] Command failed with code ${exitCode}`);
                }
            } else {
                console.log(`[Bash] Command completed successfully`);
            }

            // 即使有错误也 resolve，让调用方处理
            resolve(result);
        });

        // 处理进程意外终止
        childProcess.on('error', (err) => {
            console.error('[Bash] Process error:', err);
            reject(err);
        });
    });
}

/**
 * 执行多个命令（按顺序）
 * @param {string[]} commands - 命令数组
 * @param {Object} config - 配置对象
 */
async function executeSequence(commands, config = {}) {
    const results = [];

    for (const command of commands) {
        const result = await execute(command, config);
        results.push({ command, ...result });

        // 如果某个命令失败且退出码非0，停止执行后续命令
        if (result.exitCode !== 0) {
            console.warn(`[Bash] Command failed, stopping sequence`);
            break;
        }
    }

    return results;
}

/**
 * 获取当前工作目录
 */
async function getCurrentDirectory() {
    const command = process.platform === 'win32' ? 'cd' : 'pwd';
    const result = await execute(command);
    return result.stdout.trim();
}

/**
 * 列出目录内容
 */
async function listDirectory(directory = '.') {
    const command = process.platform === 'win32'
        ? `dir "${directory}"`
        : `ls -la "${directory}"`;

    const result = await execute(command);
    return result.stdout;
}

module.exports = {
    execute,
    executeSequence,
    getCurrentDirectory,
    listDirectory
};
