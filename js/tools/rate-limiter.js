/**
 * 工具速率限制器
 * 使用滑动窗口算法防止工具调用超过配置的速率限制
 *
 * 支持的时间单位：
 * - minute: 每分钟
 * - hour: 每小时
 * - day: 每天
 */

// ========== 配置 ==========

const TIME_UNITS = {
    minute: 60 * 1000,      // 60秒
    hour: 60 * 60 * 1000,   // 3600秒
    day: 24 * 60 * 60 * 1000 // 86400秒
};

// ========== 存储 ==========

/**
 * 速率限制存储
 * Map<toolId, { timestamps: number[], max: number, window: number }>
 */
const rateLimitStore = new Map();

// ========== 核心 API ==========

/**
 * 检查速率限制并记录调用
 * @param {string} toolId - 工具 ID
 * @param {Object} rateLimit - 速率限制配置 { max: number, window: number, unit: 'minute'|'hour'|'day' }
 * @throws {Error} 如果超过速率限制
 */
export function checkRateLimit(toolId, rateLimit) {
    if (!rateLimit || !rateLimit.max || !rateLimit.unit) {
        // 没有配置速率限制，直接通过
        return;
    }

    const { max, unit } = rateLimit;
    const windowMs = TIME_UNITS[unit];

    if (!windowMs) {
        console.warn(`[RateLimiter] 未知的时间单位: ${unit}`);
        return;
    }

    // 获取或初始化存储
    if (!rateLimitStore.has(toolId)) {
        rateLimitStore.set(toolId, {
            timestamps: [],
            max,
            window: windowMs
        });
    }

    const store = rateLimitStore.get(toolId);
    const now = Date.now();

    // 清理过期的时间戳（滑动窗口）
    store.timestamps = store.timestamps.filter(ts => now - ts < windowMs);

    // 检查是否超过限制
    if (store.timestamps.length >= max) {
        const oldestTimestamp = store.timestamps[0];
        const waitTimeMs = windowMs - (now - oldestTimestamp);
        const waitTimeSec = Math.ceil(waitTimeMs / 1000);

        const unitText = {
            minute: '分钟',
            hour: '小时',
            day: '天'
        }[unit] || unit;

        throw new Error(
            `速率限制: 工具 "${toolId}" 在 1 ${unitText} 内最多调用 ${max} 次，` +
            `请等待 ${waitTimeSec} 秒后重试`
        );
    }

    // 记录此次调用
    store.timestamps.push(now);

    console.log(`[RateLimiter] 工具 "${toolId}" 调用记录: ${store.timestamps.length}/${max} (${unit})`);
}

/**
 * 重置工具的速率限制
 * @param {string} toolId - 工具 ID
 */
export function resetRateLimit(toolId) {
    if (rateLimitStore.has(toolId)) {
        rateLimitStore.delete(toolId);
        console.log(`[RateLimiter] 已重置工具 "${toolId}" 的速率限制`);
    }
}

/**
 * 获取工具的速率限制状态
 * @param {string} toolId - 工具 ID
 * @returns {Object|null} { current: number, max: number, windowMs: number, nextResetMs: number }
 */
export function getRateLimitStatus(toolId) {
    if (!rateLimitStore.has(toolId)) {
        return null;
    }

    const store = rateLimitStore.get(toolId);
    const now = Date.now();

    // 清理过期的时间戳
    store.timestamps = store.timestamps.filter(ts => now - ts < store.window);

    if (store.timestamps.length === 0) {
        return {
            current: 0,
            max: store.max,
            windowMs: store.window,
            nextResetMs: 0
        };
    }

    const oldestTimestamp = store.timestamps[0];
    const nextResetMs = store.window - (now - oldestTimestamp);

    return {
        current: store.timestamps.length,
        max: store.max,
        windowMs: store.window,
        nextResetMs: Math.max(0, nextResetMs)
    };
}

/**
 * 清除所有速率限制数据
 */
export function clearAllRateLimits() {
    const count = rateLimitStore.size;
    rateLimitStore.clear();
    console.log(`[RateLimiter] 已清除 ${count} 个工具的速率限制数据`);
}

/**
 * 获取所有工具的速率限制状态
 * @returns {Map<string, Object>} Map<toolId, status>
 */
export function getAllRateLimitStatus() {
    const statusMap = new Map();

    for (const [toolId] of rateLimitStore) {
        const status = getRateLimitStatus(toolId);
        if (status) {
            statusMap.set(toolId, status);
        }
    }

    return statusMap;
}

// ========== 定时清理 ==========

/**
 * 定时清理过期的时间戳（每5分钟）
 */
function cleanupExpiredTimestamps() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [toolId, store] of rateLimitStore) {
        const beforeCount = store.timestamps.length;
        store.timestamps = store.timestamps.filter(ts => now - ts < store.window);
        const afterCount = store.timestamps.length;

        if (beforeCount > afterCount) {
            cleanedCount += (beforeCount - afterCount);
        }

        // 如果清理后没有时间戳了，移除整个存储
        if (store.timestamps.length === 0) {
            rateLimitStore.delete(toolId);
        }
    }

    if (cleanedCount > 0) {
        console.log(`[RateLimiter] 定时清理: 移除 ${cleanedCount} 个过期时间戳`);
    }
}

// 启动定时清理（每5分钟）
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(cleanupExpiredTimestamps, CLEANUP_INTERVAL);

console.log('[RateLimiter] 速率限制器已初始化');
