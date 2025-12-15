/**
 * Electron MCP 管理器
 * 在主进程中管理本地 MCP 服务器的子进程
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * MCP 服务器进程管理器
 */
class MCPManager extends EventEmitter {
    constructor() {
        super();
        this.processes = new Map(); // serverId -> process info
        this.messageHandlers = new Map(); // serverId -> message handler
        this.requestQueue = new Map(); // requestId -> {resolve, reject, timeout}
        this.requestIdCounter = 0;

        // ✅ 重启配置
        this.restartConfig = {
            enabled: true,           // 启用自动重启
            maxRestarts: 3,          // 最大重启次数（每分钟）
            resetInterval: 60000,    // 重置计数器时间窗口（1 分钟）
            restartDelay: 2000       // 重启延迟（2 秒）
        };

        // ✅ 重启计数器
        this.restartCounts = new Map(); // serverId -> { count, lastRestart, config }
    }

    /**
     * 启动 MCP 服务器
     * @param {Object} config - 配置
     * @param {string} config.serverId - 服务器 ID
     * @param {string} config.command - 命令
     * @param {string[]} config.args - 参数
     * @param {Object} [config.env] - 环境变量
     * @param {string} [config.cwd] - 工作目录
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async startServer(config) {
        const { serverId, command, args = [], env = {}, cwd } = config;

        // 检查是否已运行
        if (this.processes.has(serverId)) {
            console.warn(`[MCP Manager] 服务器已运行: ${serverId}`);
            return { success: false, error: '服务器已运行' };
        }

        try {
            // 合并环境变量
            const processEnv = {
                ...process.env,
                ...env
            };

            // 启动子进程
            const childProcess = spawn(command, args, {
                cwd: cwd || process.cwd(),
                env: processEnv,
                stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
            });

            // 存储进程信息
            const processInfo = {
                process: childProcess,
                serverId,
                command,
                args,
                env: processEnv,  // ✅ 保存环境变量
                cwd,              // ✅ 保存工作目录
                buffer: '', // 用于累积 stdout 数据
                startTime: Date.now(),
                status: 'starting'
            };

            this.processes.set(serverId, processInfo);

            // ✅ 初始化重启计数器（保存配置以便重启）
            if (!this.restartCounts.has(serverId)) {
                this.restartCounts.set(serverId, {
                    count: 0,
                    lastRestart: 0,
                    config: { serverId, command, args, env, cwd }
                });
            }

            // 设置 stdout 处理器
            childProcess.stdout.on('data', (data) => {
                this.handleStdout(serverId, data);
            });

            // 设置 stderr 处理器
            childProcess.stderr.on('data', (data) => {
                console.error(`[MCP Manager] [${serverId}] stderr:`, data.toString());
            });

            // 设置退出处理器
            childProcess.on('exit', (code, signal) => {
                console.log(`[MCP Manager] [${serverId}] 进程退出: code=${code}, signal=${signal}`);
                this.handleProcessExit(serverId, code, signal);
            });

            // 设置错误处理器
            childProcess.on('error', (error) => {
                console.error(`[MCP Manager] [${serverId}] 进程错误:`, error);
                processInfo.status = 'error';
                this.emit('server-error', { serverId, error: error.message });
            });

            // 等待进程启动
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('启动超时'));
                }, 10000);

                // 假设进程成功启动（实际应等待初始化消息）
                setTimeout(() => {
                    clearTimeout(timeout);
                    processInfo.status = 'running';
                    resolve();
                }, 1000);
            });

            console.log(`[MCP Manager] ✅ 已启动 MCP 服务器: ${serverId}`);
            this.emit('server-started', { serverId });

            return { success: true };

        } catch (error) {
            console.error(`[MCP Manager] ❌ 启动失败: ${serverId}`, error);
            this.processes.delete(serverId);
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止 MCP 服务器
     * @param {string} serverId - 服务器 ID
     * @returns {Promise<void>}
     */
    async stopServer(serverId) {
        const processInfo = this.processes.get(serverId);
        if (!processInfo) {
            console.warn(`[MCP Manager] 服务器未运行: ${serverId}`);
            return;
        }

        try {
            // 发送终止信号
            processInfo.process.kill('SIGTERM');

            // 等待进程退出（最多5秒）
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    // 强制杀死
                    console.warn(`[MCP Manager] 强制终止: ${serverId}`);
                    processInfo.process.kill('SIGKILL');
                    resolve();
                }, 5000);

                processInfo.process.on('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            this.processes.delete(serverId);
            console.log(`[MCP Manager] 🔌 已停止 MCP 服务器: ${serverId}`);
            this.emit('server-stopped', { serverId });

        } catch (error) {
            console.error(`[MCP Manager] 停止失败: ${serverId}`, error);
        }
    }

    /**
     * 发送请求到 MCP 服务器
     * @param {string} serverId - 服务器 ID
     * @param {string} method - MCP 方法
     * @param {Object} [params] - 参数
     * @returns {Promise<Object>} 响应结果
     */
    async sendRequest(serverId, method, params = {}) {
        const processInfo = this.processes.get(serverId);
        if (!processInfo) {
            throw new Error(`服务器未运行: ${serverId}`);
        }

        if (processInfo.status !== 'running') {
            throw new Error(`服务器状态异常: ${processInfo.status}`);
        }

        // 生成请求 ID
        const requestId = `req_${++this.requestIdCounter}`;

        // 构建 JSON-RPC 请求
        const request = {
            jsonrpc: '2.0',
            id: requestId,
            method,
            params
        };

        // 创建 Promise
        return new Promise((resolve, reject) => {
            // ✅ 根据方法类型设置超时时间
            const timeoutDuration = method === 'tools/call' ? 30000 : 10000; // 工具调用 30s，其他 10s

            const timeout = setTimeout(() => {
                this.requestQueue.delete(requestId);
                reject(new Error(`请求超时 (${timeoutDuration}ms): ${method}`));
            }, timeoutDuration);

            // 存储请求回调
            this.requestQueue.set(requestId, { resolve, reject, timeout });

            // 发送请求（通过 stdin）
            try {
                const requestStr = JSON.stringify(request) + '\n';
                processInfo.process.stdin.write(requestStr);
                console.log(`[MCP Manager] [${serverId}] 发送请求:`, method);
            } catch (error) {
                clearTimeout(timeout);
                this.requestQueue.delete(requestId);
                reject(error);
            }
        });
    }

    /**
     * 处理 stdout 数据
     * @private
     */
    handleStdout(serverId, data) {
        const processInfo = this.processes.get(serverId);
        if (!processInfo) return;

        // 累积数据
        processInfo.buffer += data.toString();

        // 尝试解析完整的 JSON 消息（以换行符分隔）
        const lines = processInfo.buffer.split('\n');
        processInfo.buffer = lines.pop() || ''; // 保留未完成的行

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const message = JSON.parse(line);
                this.handleMessage(serverId, message);
            } catch (error) {
                console.error(`[MCP Manager] [${serverId}] JSON 解析失败:`, line);
            }
        }
    }

    /**
     * 处理 MCP 消息
     * @private
     */
    handleMessage(serverId, message) {
        console.log(`[MCP Manager] [${serverId}] 收到消息:`, message);

        // 响应消息（包含 id）
        if (message.id) {
            const pending = this.requestQueue.get(message.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.requestQueue.delete(message.id);

                if (message.error) {
                    pending.reject(new Error(message.error.message || '未知错误'));
                } else {
                    pending.resolve(message.result);
                }
            }
        } else {
            // 通知消息（无 id）
            this.emit('notification', { serverId, message });
        }
    }

    /**
     * 处理进程退出
     * @private
     */
    handleProcessExit(serverId, code, signal) {
        const processInfo = this.processes.get(serverId);
        if (processInfo) {
            processInfo.status = 'stopped';
        }

        // 清理未完成的请求
        for (const [requestId, pending] of this.requestQueue.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('服务器进程已退出'));
        }
        this.requestQueue.clear();

        console.log(`[MCP Manager] [${serverId}] 进程已退出: code=${code}, signal=${signal}`);
        this.emit('server-exited', { serverId, code, signal });

        // ✅ 检查是否应该自动重启
        if (this._shouldRestart(serverId, code)) {
            console.log(`[MCP Manager] [${serverId}] 准备自动重启...`);
            setTimeout(() => {
                this._attemptRestart(serverId);
            }, this.restartConfig.restartDelay);
        } else {
            // 不重启，清理进程信息
            this.processes.delete(serverId);
        }
    }

    /**
     * ✅ 判断是否应该重启
     * @private
     */
    _shouldRestart(serverId, exitCode) {
        // 退出码 0 = 正常退出，不重启
        if (exitCode === 0) {
            console.log(`[MCP Manager] [${serverId}] 正常退出，不重启`);
            return false;
        }

        // 未启用自动重启
        if (!this.restartConfig.enabled) {
            console.log(`[MCP Manager] [${serverId}] 自动重启已禁用`);
            return false;
        }

        const restartInfo = this.restartCounts.get(serverId);
        if (!restartInfo) {
            console.log(`[MCP Manager] [${serverId}] 无重启信息，不重启`);
            return false;
        }

        const now = Date.now();
        const timeSinceLastRestart = now - restartInfo.lastRestart;

        // 重置计数器（距上次重启超过重置间隔）
        if (timeSinceLastRestart > this.restartConfig.resetInterval) {
            console.log(`[MCP Manager] [${serverId}] 重置重启计数器`);
            restartInfo.count = 0;
            restartInfo.lastRestart = now;
        }

        // 检查最大重启次数（断路器模式）
        if (restartInfo.count >= this.restartConfig.maxRestarts) {
            console.error(`[MCP Manager] [${serverId}] 已达最大重启次数 (${this.restartConfig.maxRestarts})，停止重启`);
            this.emit('restart-limit-exceeded', { serverId, count: restartInfo.count });
            return false;
        }

        // 增加重启计数
        restartInfo.count++;
        restartInfo.lastRestart = now;

        console.log(`[MCP Manager] [${serverId}] 重启次数: ${restartInfo.count}/${this.restartConfig.maxRestarts}`);
        return true;
    }

    /**
     * ✅ 尝试重启服务器
     * @private
     */
    async _attemptRestart(serverId) {
        const restartInfo = this.restartCounts.get(serverId);
        if (!restartInfo || !restartInfo.config) {
            console.error(`[MCP Manager] [${serverId}] 无重启配置`);
            return;
        }

        console.log(`[MCP Manager] [${serverId}] 正在重启...`);
        this.emit('server-restarting', { serverId, attempt: restartInfo.count });

        try {
            // 先停止旧进程（如果还存在）
            if (this.processes.has(serverId)) {
                await this.stopServer(serverId);
            }

            // 使用保存的配置重新启动
            const result = await this.startServer(restartInfo.config);

            if (result.success) {
                console.log(`[MCP Manager] ✅ [${serverId}] 重启成功`);
                this.emit('server-restarted', { serverId, attempt: restartInfo.count });
            } else {
                console.error(`[MCP Manager] ❌ [${serverId}] 重启失败:`, result.error);
                this.emit('server-restart-failed', { serverId, error: result.error, attempt: restartInfo.count });
            }
        } catch (error) {
            console.error(`[MCP Manager] ❌ [${serverId}] 重启异常:`, error);
            this.emit('server-restart-failed', { serverId, error: error.message, attempt: restartInfo.count });
        }
    }

    /**
     * 获取服务器状态
     * @param {string} serverId - 服务器 ID
     * @returns {Object|null} 状态信息
     */
    getStatus(serverId) {
        const processInfo = this.processes.get(serverId);
        if (!processInfo) return null;

        return {
            serverId,
            status: processInfo.status,
            pid: processInfo.process.pid,
            uptime: Date.now() - processInfo.startTime,
            command: processInfo.command,
            args: processInfo.args
        };
    }

    /**
     * 获取所有服务器状态
     * @returns {Array<Object>} 状态列表
     */
    getAllStatus() {
        const statuses = [];
        for (const serverId of this.processes.keys()) {
            statuses.push(this.getStatus(serverId));
        }
        return statuses;
    }

    /**
     * 停止所有服务器
     * @returns {Promise<void>}
     */
    async stopAll() {
        const promises = [];
        for (const serverId of this.processes.keys()) {
            promises.push(this.stopServer(serverId));
        }
        await Promise.all(promises);
    }
}

// 导出单例
const mcpManager = new MCPManager();

module.exports = { mcpManager };
