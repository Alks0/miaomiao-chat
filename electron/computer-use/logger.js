/**
 * 统一日志工具
 * 为 Computer Use 模块提供格式化的日志输出
 */

class ComputerUseLogger {
    /**
     * 格式化日志前缀
     * @param {string} module - 模块名称
     * @param {string} level - 日志级别
     * @returns {string}
     */
    static formatPrefix(module, level) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [Computer Use:${module}] [${level}]`;
    }

    /**
     * INFO 级别日志
     * @param {string} module - 模块名称
     * @param {string} message - 日志消息
     * @param {any} data - 可选的额外数据
     */
    static info(module, message, data = null) {
        const prefix = this.formatPrefix(module, 'INFO');
        if (data) {
            console.log(`${prefix} ${message}`, data);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    /**
     * WARN 级别日志
     * @param {string} module - 模块名称
     * @param {string} message - 日志消息
     * @param {any} data - 可选的额外数据
     */
    static warn(module, message, data = null) {
        const prefix = this.formatPrefix(module, 'WARN');
        if (data) {
            console.warn(`${prefix} ${message}`, data);
        } else {
            console.warn(`${prefix} ${message}`);
        }
    }

    /**
     * ERROR 级别日志
     * @param {string} module - 模块名称
     * @param {string} message - 日志消息
     * @param {any} error - 错误对象或额外数据
     */
    static error(module, message, error = null) {
        const prefix = this.formatPrefix(module, 'ERROR');
        if (error) {
            console.error(`${prefix} ${message}`, error);
        } else {
            console.error(`${prefix} ${message}`);
        }
    }

    /**
     * DEBUG 级别日志
     * @param {string} module - 模块名称
     * @param {string} message - 日志消息
     * @param {any} data - 可选的额外数据
     */
    static debug(module, message, data = null) {
        const prefix = this.formatPrefix(module, 'DEBUG');
        if (data) {
            console.debug(`${prefix} ${message}`, data);
        } else {
            console.debug(`${prefix} ${message}`);
        }
    }
}

module.exports = ComputerUseLogger;
