/**
 * 错误处理模块
 * 提供人性化的错误消息和错误序列化
 */

import { escapeHtml } from './helpers.js';

// 人性化错误消息映射
const ERROR_MESSAGES = {
    // HTTP 状态码
    400: { title: '请求格式错误', hint: '请检查消息内容是否符合要求' },
    401: { title: '认证失败', hint: '请检查 API Key 是否正确' },
    403: { title: '访问被拒绝', hint: '您的账户可能没有访问此模型的权限' },
    404: { title: '资源未找到', hint: '请检查端点地址或模型名称' },
    429: { title: '请求过于频繁', hint: '请稍后再试，或检查配额限制' },
    500: { title: '服务器内部错误', hint: '服务端出现问题，请稍后重试' },
    502: { title: '网关错误', hint: '服务暂时不可用，请稍后重试' },
    503: { title: '服务不可用', hint: '服务器过载或维护中' },
    504: { title: '网关超时', hint: '请求超时，请重试' },

    // 常见错误类型
    'invalid_api_key': { title: 'API Key 无效', hint: '请检查密钥是否正确' },
    'insufficient_quota': { title: '配额不足', hint: '请检查账户余额或升级计划' },
    'rate_limit_exceeded': { title: '速率限制', hint: '请求太频繁，请稍等片刻' },
    'context_length_exceeded': { title: '消息过长', hint: '请减少对话历史或消息长度' },
    'model_not_found': { title: '模型不存在', hint: '请检查模型名称是否正确' },
    'overloaded': { title: '服务繁忙', hint: '当前请求量大，请稍后再试' },
    'authentication_error': { title: '认证错误', hint: '请检查 API Key' },
    'permission_denied': { title: '权限不足', hint: '您没有使用此模型的权限' },

    // Gemini 特有
    'SAFETY': { title: '内容安全过滤', hint: '消息触发了安全过滤，请修改内容' },
    'RECITATION': { title: '引用限制', hint: '回复可能包含受版权保护的内容' },
    'OTHER': { title: '生成中断', hint: '模型停止了生成' },

    // 网络错误
    'NetworkError': { title: '网络连接失败', hint: '请检查网络连接' },
    'TypeError': { title: '请求失败', hint: '可能是跨域或网络问题' },
    'AbortError': { title: '请求已取消', hint: '请求被手动中断' },
    'TimeoutError': { title: '请求超时', hint: '服务响应太慢，请重试' }
};

/**
 * 获取人性化错误信息
 * @param {Object|Error} error - 错误对象
 * @param {number} httpStatus - HTTP 状态码
 * @returns {Object} { title, hint }
 */
export function getHumanizedError(error, httpStatus = null) {
    // 尝试从 HTTP 状态码获取
    if (httpStatus && ERROR_MESSAGES[httpStatus]) {
        return ERROR_MESSAGES[httpStatus];
    }

    // 尝试从错误对象提取类型/代码
    const errorType = error?.error?.type || error?.type || error?.code || error?.name;
    const errorStatus = error?.error?.status || error?.status;
    const errorMessage = error?.error?.message || error?.message || '';

    // 匹配错误类型
    if (errorType && ERROR_MESSAGES[errorType]) {
        return ERROR_MESSAGES[errorType];
    }
    if (errorStatus && ERROR_MESSAGES[errorStatus]) {
        return ERROR_MESSAGES[errorStatus];
    }

    // 尝试从消息内容匹配
    const msgLower = errorMessage.toLowerCase();
    if (msgLower.includes('api key') || msgLower.includes('apikey') || msgLower.includes('unauthorized')) {
        return ERROR_MESSAGES['invalid_api_key'];
    }
    if (msgLower.includes('quota') || msgLower.includes('billing')) {
        return ERROR_MESSAGES['insufficient_quota'];
    }
    if (msgLower.includes('rate limit') || msgLower.includes('too many')) {
        return ERROR_MESSAGES['rate_limit_exceeded'];
    }
    if (msgLower.includes('context_length') || msgLower.includes('context length') ||
        msgLower.includes('max_tokens') || msgLower.includes('token limit') ||
        msgLower.includes('too long') || msgLower.includes('too many tokens')) {
        return ERROR_MESSAGES['context_length_exceeded'];
    }
    if (msgLower.includes('not found') || msgLower.includes('does not exist')) {
        return ERROR_MESSAGES['model_not_found'];
    }
    if (msgLower.includes('overloaded') || msgLower.includes('capacity')) {
        return ERROR_MESSAGES['overloaded'];
    }

    // 默认
    return { title: '请求失败', hint: errorMessage || '发生未知错误' };
}

/**
 * 序列化错误对象（包括 Error 实例）
 * @param {Object|Error} error - 错误对象
 * @returns {string} 序列化后的字符串
 */
function serializeError(error) {
    // ✅ 增强：检查 null/undefined
    if (!error || error === null || error === undefined) {
        return JSON.stringify({ error: { message: 'Unknown error' } }, null, 2);
    }

    if (typeof error === 'string') {
        return error;
    }

    // 如果是 Error 实例，提取其属性
    if (error instanceof Error) {
        const serialized = {
            name: error.name || 'Error',
            message: error.message || 'Unknown error',
        };
        if (error.stack) {
            serialized.stack = error.stack;
        }
        // 复制其他可枚举属性
        Object.keys(error).forEach(key => {
            serialized[key] = error[key];
        });
        return JSON.stringify(serialized, null, 2);
    }

    // 普通对象直接序列化
    try {
        return JSON.stringify(error, null, 2);
    } catch (e) {
        return String(error || 'Serialization failed');
    }
}

/**
 * 渲染人性化错误块
 * @param {Object|Error} error - 错误对象
 * @param {number} httpStatus - HTTP 状态码
 * @param {boolean} showDetails - 是否显示技术详情
 * @returns {string} 错误 HTML
 */
export function renderHumanizedError(error, httpStatus = null, showDetails = true) {
    // ✅ 增强：防御性检查
    if (!error) {
        error = { error: { message: 'Unknown error' } };
    }

    const humanized = getHumanizedError(error, httpStatus);

    // ✅ 增强：确保 title 和 hint 存在
    const title = humanized?.title || '请求失败';
    const hint = humanized?.hint || '发生未知错误';

    let html = `<div class="error-humanized">
        <div class="error-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
        </div>
        <div class="error-humanized-content">
            <div class="error-humanized-title">${escapeHtml(title)}</div>
            <div class="error-humanized-hint">${escapeHtml(hint)}</div>
        </div>
    </div>`;

    // 可折叠的技术细节 - 始终显示原始错误
    if (showDetails) {
        const rawError = serializeError(error);

        // 检查是否有多个错误（allErrors）
        const allErrors = error?.error?.allErrors || error?.allErrors;
        let detailsContent = '';

        if (allErrors && allErrors.length > 0) {
            // 格式化显示每个错误的详细信息
            detailsContent = '<div class="error-all-errors"><strong>所有错误详情：</strong><br><br>';
            allErrors.forEach((err, idx) => {
                const requestLabel = err.request ? `请求 #${err.request}` : err.stream ? `流 #${err.stream}` : `错误 #${idx + 1}`;
                detailsContent += `<div class="error-item"><strong>${requestLabel}:</strong><br>`;
                detailsContent += `&nbsp;&nbsp;状态: ${err.status || 'N/A'}<br>`;
                detailsContent += `&nbsp;&nbsp;类型: ${err.type || 'N/A'}<br>`;
                detailsContent += `&nbsp;&nbsp;代码: ${err.code || 'N/A'}<br>`;
                detailsContent += `&nbsp;&nbsp;消息: ${err.message || 'N/A'}<br>`;
                if (err.fullError) {
                    detailsContent += `&nbsp;&nbsp;完整错误: <pre>${escapeHtml(JSON.stringify(err.fullError, null, 2))}</pre>`;
                }
                detailsContent += '</div><br>';
            });
            detailsContent += '</div><hr><strong>原始错误对象：</strong><br>';
        }

        html += `<details class="error-technical">
            <summary>技术详情 <span class="details-hint">（点击展开）</span></summary>
            ${detailsContent}
            <pre class="error-content">${escapeHtml(rawError)}</pre>
        </details>`;
    }

    return html;
}
