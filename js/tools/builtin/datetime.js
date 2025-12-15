/**
 * 时间日期工具
 * 获取当前时间、格式化日期、时区转换等
 */

/**
 * 工具定义（OpenAI 格式）
 */
export const datetimeTool = {
    name: 'datetime',
    description: '获取当前时间、格式化日期、时区转换。支持操作: current（当前时间）、format（格式化）、timezone（时区转换）、calculate（日期计算）。',
    parameters: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['current', 'format', 'timezone', 'calculate'],
                description: '操作类型: current-获取当前时间, format-格式化日期, timezone-时区转换, calculate-日期计算'
            },
            format: {
                type: 'string',
                description: '日期格式（可选）: "iso"（ISO 8601）, "locale"（本地化）, "timestamp"（Unix 时间戳）, "custom"（自定义格式）。默认: "iso"'
            },
            timezone: {
                type: 'string',
                description: '目标时区（可选），例如: "UTC", "America/New_York", "Asia/Shanghai"。默认: 本地时区'
            },
            date: {
                type: 'string',
                description: '输入日期（ISO 8601 格式或时间戳），用于 format/timezone/calculate 操作'
            },
            calculation: {
                type: 'object',
                properties: {
                    amount: {
                        type: 'number',
                        description: '增减的数量'
                    },
                    unit: {
                        type: 'string',
                        enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'],
                        description: '时间单位'
                    }
                },
                description: '日期计算参数（用于 calculate 操作）'
            }
        },
        required: ['operation']
    }
};

/**
 * 工具处理器
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 结果
 */
export async function datetimeHandler(args) {
    const { operation, format = 'iso', timezone, date, calculation } = args;

    console.log(`[DateTime] 执行操作: ${operation}`, args);

    try {
        let result;

        switch (operation) {
            case 'current':
                result = getCurrentTime(format, timezone);
                break;

            case 'format':
                if (!date) {
                    throw new Error('format 操作需要 date 参数');
                }
                result = formatDate(date, format, timezone);
                break;

            case 'timezone':
                if (!date || !timezone) {
                    throw new Error('timezone 操作需要 date 和 timezone 参数');
                }
                result = convertTimezone(date, timezone);
                break;

            case 'calculate':
                if (!date || !calculation) {
                    throw new Error('calculate 操作需要 date 和 calculation 参数');
                }
                result = calculateDate(date, calculation);
                break;

            default:
                throw new Error(`不支持的操作: ${operation}`);
        }

        return {
            operation,
            success: true,
            ...result
        };

    } catch (error) {
        console.error(`[DateTime] 错误:`, error);
        throw new Error(`日期时间操作失败: ${error.message}`);
    }
}

/**
 * 获取当前时间
 * @param {string} format - 格式
 * @param {string} timezone - 时区
 * @returns {Object}
 */
function getCurrentTime(format, timezone) {
    const now = new Date();

    return {
        timestamp: now.getTime(),
        iso: now.toISOString(),
        locale: now.toLocaleString(),
        formatted: formatDateByType(now, format),
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        utcOffset: -now.getTimezoneOffset() / 60
    };
}

/**
 * 格式化日期
 * @param {string} dateStr - 日期字符串
 * @param {string} format - 格式类型
 * @param {string} timezone - 时区
 * @returns {Object}
 */
function formatDate(dateStr, format, timezone) {
    const date = parseDate(dateStr);

    return {
        input: dateStr,
        timestamp: date.getTime(),
        iso: date.toISOString(),
        locale: date.toLocaleString(),
        formatted: formatDateByType(date, format),
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    };
}

/**
 * 转换时区
 * @param {string} dateStr - 日期字符串
 * @param {string} targetTimezone - 目标时区
 * @returns {Object}
 */
function convertTimezone(dateStr, targetTimezone) {
    const date = parseDate(dateStr);

    // 使用 Intl.DateTimeFormat 进行时区转换
    const options = {
        timeZone: targetTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(date);

    const converted = {};
    parts.forEach(part => {
        if (part.type !== 'literal') {
            converted[part.type] = part.value;
        }
    });

    return {
        input: dateStr,
        sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        targetTimezone,
        timestamp: date.getTime(),
        iso: date.toISOString(),
        converted: formatter.format(date),
        parts: converted
    };
}

/**
 * 日期计算
 * @param {string} dateStr - 日期字符串
 * @param {Object} calc - 计算参数
 * @returns {Object}
 */
function calculateDate(dateStr, calc) {
    const { amount, unit } = calc;
    const date = parseDate(dateStr);
    const result = new Date(date);

    switch (unit) {
        case 'seconds':
            result.setSeconds(result.getSeconds() + amount);
            break;
        case 'minutes':
            result.setMinutes(result.getMinutes() + amount);
            break;
        case 'hours':
            result.setHours(result.getHours() + amount);
            break;
        case 'days':
            result.setDate(result.getDate() + amount);
            break;
        case 'weeks':
            result.setDate(result.getDate() + amount * 7);
            break;
        case 'months':
            result.setMonth(result.getMonth() + amount);
            break;
        case 'years':
            result.setFullYear(result.getFullYear() + amount);
            break;
        default:
            throw new Error(`不支持的时间单位: ${unit}`);
    }

    const diff = result.getTime() - date.getTime();

    return {
        input: dateStr,
        calculation: `${amount > 0 ? '+' : ''}${amount} ${unit}`,
        original: date.toISOString(),
        result: result.toISOString(),
        difference: {
            milliseconds: diff,
            seconds: Math.floor(diff / 1000),
            minutes: Math.floor(diff / 60000),
            hours: Math.floor(diff / 3600000),
            days: Math.floor(diff / 86400000)
        }
    };
}

/**
 * 解析日期字符串
 * @param {string} dateStr - 日期字符串
 * @returns {Date}
 */
function parseDate(dateStr) {
    // 尝试解析为时间戳
    const timestamp = Number(dateStr);
    if (!isNaN(timestamp) && timestamp > 0) {
        return new Date(timestamp);
    }

    // 尝试解析为 ISO 字符串
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw new Error(`无效的日期格式: ${dateStr}`);
    }

    return date;
}

/**
 * 按类型格式化日期
 * @param {Date} date - 日期对象
 * @param {string} formatType - 格式类型
 * @returns {string}
 */
function formatDateByType(date, formatType) {
    switch (formatType) {
        case 'iso':
            return date.toISOString();
        case 'locale':
            return date.toLocaleString();
        case 'timestamp':
            return date.getTime().toString();
        case 'date':
            return date.toLocaleDateString();
        case 'time':
            return date.toLocaleTimeString();
        case 'custom':
            // 自定义格式：YYYY-MM-DD HH:MM:SS
            return formatCustomDate(date);
        default:
            return date.toISOString();
    }
}

/**
 * 自定义日期格式化
 * @param {Date} date - 日期对象
 * @returns {string} YYYY-MM-DD HH:MM:SS 格式
 */
function formatCustomDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

console.log('[DateTime Tool] 📅 时间日期工具已加载');
