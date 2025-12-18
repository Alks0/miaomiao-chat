/**
 * Computer Use 操作审计日志
 * 记录所有 Computer Use 操作用于安全审计和调试
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class AuditLogger {
    constructor() {
        // 审计日志文件路径（在用户主目录下）
        this.logDir = path.join(os.homedir(), '.computer-use');
        this.logFile = path.join(this.logDir, 'audit.log');
        this.initialized = false;
    }

    /**
     * 初始化审计日志目录
     */
    async initialize() {
        if (this.initialized) return;

        try {
            await fs.mkdir(this.logDir, { recursive: true });
            this.initialized = true;
        } catch (error) {
            console.error('[Audit] Failed to initialize log directory:', error);
        }
    }

    /**
     * 记录操作
     * @param {string} action - 操作名称
     * @param {Object} params - 操作参数
     * @param {Object} result - 操作结果
     */
    async log(action, params = {}, result = {}) {
        await this.initialize();

        const entry = {
            timestamp: new Date().toISOString(),
            action,
            params: this.sanitizeParams(params),
            success: result.success !== false,
            error: result.error || null,
            duration: result.duration || null
        };

        const logLine = JSON.stringify(entry) + '\n';

        try {
            await fs.appendFile(this.logFile, logLine, 'utf-8');
        } catch (error) {
            console.error('[Audit] Failed to write audit log:', error);
        }
    }

    /**
     * 清理敏感参数
     * @param {Object} params - 原始参数
     * @returns {Object} 清理后的参数
     */
    sanitizeParams(params) {
        const sanitized = { ...params };

        // 如果是 bash 命令，记录但标记为敏感
        if (sanitized.command && typeof sanitized.command === 'string') {
            if (sanitized.command.length > 200) {
                sanitized.command = sanitized.command.substring(0, 200) + '... (truncated)';
            }
        }

        // 如果是文件内容，不记录完整内容
        if (sanitized.file_text || sanitized.content) {
            sanitized.file_text = '[FILE CONTENT - not logged]';
            sanitized.content = '[CONTENT - not logged]';
        }

        return sanitized;
    }

    /**
     * 读取审计日志
     * @param {number} limit - 读取的最大行数
     * @returns {Promise<Array>} 审计日志条目数组
     */
    async read(limit = 100) {
        await this.initialize();

        try {
            const content = await fs.readFile(this.logFile, 'utf-8');
            const lines = content.trim().split('\n');
            const entries = lines
                .slice(-limit)
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return null;
                    }
                })
                .filter(entry => entry !== null);

            return entries;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return []; // 文件不存在，返回空数组
            }
            console.error('[Audit] Failed to read audit log:', error);
            return [];
        }
    }

    /**
     * 清除审计日志
     */
    async clear() {
        await this.initialize();

        try {
            await fs.writeFile(this.logFile, '', 'utf-8');
        } catch (error) {
            console.error('[Audit] Failed to clear audit log:', error);
        }
    }

    /**
     * 获取审计日志统计信息
     * @returns {Promise<Object>} 统计信息
     */
    async getStats() {
        const entries = await this.read(1000); // 读取最近 1000 条

        const stats = {
            total: entries.length,
            successful: entries.filter(e => e.success).length,
            failed: entries.filter(e => !e.success).length,
            byAction: {}
        };

        entries.forEach(entry => {
            if (!stats.byAction[entry.action]) {
                stats.byAction[entry.action] = { total: 0, successful: 0, failed: 0 };
            }
            stats.byAction[entry.action].total++;
            if (entry.success) {
                stats.byAction[entry.action].successful++;
            } else {
                stats.byAction[entry.action].failed++;
            }
        });

        return stats;
    }
}

// 导出单例
module.exports = new AuditLogger();
