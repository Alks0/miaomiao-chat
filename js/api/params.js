/**
 * API 请求参数构建器
 * 根据不同 API 格式构建请求参数
 */

import { state } from '../core/state.js';

/**
 * 构建模型参数
 * @param {string} format - API 格式 ('openai'|'gemini'|'claude')
 * @returns {Object} 格式化的参数对象
 */
export function buildModelParams(format) {
    const params = state.modelParams[format];
    const result = {};

    switch (format) {
        case 'openai':
            // OpenAI：仅添加非空参数
            if (params.temperature !== null) result.temperature = params.temperature;
            if (params.max_tokens !== null) result.max_tokens = params.max_tokens;
            if (params.top_p !== null) result.top_p = params.top_p;
            if (params.frequency_penalty !== null) result.frequency_penalty = params.frequency_penalty;
            if (params.presence_penalty !== null) result.presence_penalty = params.presence_penalty;
            break;

        case 'gemini':
            // Gemini：所有参数都包含，使用默认值
            result.temperature = params.temperature !== null ? params.temperature : 1;
            result.topK = params.topK !== null ? params.topK : 40;
            result.topP = params.topP !== null ? params.topP : 0.95;
            result.maxOutputTokens = params.maxOutputTokens !== null ? params.maxOutputTokens : 8192;
            break;

        case 'claude':
            // Claude：max_tokens 有默认值，其他仅非空时添加
            result.max_tokens = params.max_tokens !== null ? params.max_tokens : 8192;
            if (params.temperature !== null) result.temperature = params.temperature;
            if (params.top_p !== null) result.top_p = params.top_p;
            if (params.top_k !== null) result.top_k = params.top_k;
            break;
    }

    return result;
}

/**
 * 构建 Responses API 思维链配置
 */
function buildResponsesAPIThinking() {
    if (!state.thinkingEnabled) {
        // 关闭思维链：根据 thinkingNoneMode 决定行为
        if (state.thinkingNoneMode) {
            // 开启 None 模式：明确发送 none
            return {
                reasoning: { effort: 'none' }
            };
        } else {
            // 关闭 None 模式：不发送参数
            return null;
        }
    }

    // 启用时：low/medium/high
    const effort = state.thinkingStrength === 'custom'
        ? 'high'
        : state.thinkingStrength;

    return {
        reasoning: {
            effort,
            summary: 'auto'  // 获取推理摘要
        }
    };
}

/**
 * 构建思维链配置
 * @param {string} format - API 格式 ('openai'|'openai-responses'|'gemini'|'claude')
 * @param {string} model - 模型名称（Gemini 需要判断版本）
 * @returns {Object|null} 思维链配置对象，或 null（如果未启用）
 */
export function buildThinkingConfig(format, model = '') {
    // 通用 budget 映射
    const budgetMaps = {
        openai: null, // OpenAI 使用 effort 而非 budget
        'openai-responses': null, // Responses API 使用 effort
        gemini: { low: 4096, medium: 8192, high: 16384 },
        claude: { low: 2048, medium: 8192, high: 16384 }
    };

    const budget = state.thinkingStrength === 'custom'
        ? state.thinkingBudget
        : (budgetMaps[format]?.[state.thinkingStrength] || 16384);

    switch (format) {
        case 'openai':
            // Chat Completions API 格式
            if (!state.thinkingEnabled) return null;
            const effort = state.thinkingStrength === 'custom' ? 'high' : state.thinkingStrength;
            return { reasoning_effort: effort };

        case 'openai-responses':
            // Responses API 格式（嵌套的 reasoning 对象）
            return buildResponsesAPIThinking();

        case 'gemini':
            // ✅ 修复：检查是否启用思考链
            if (!state.thinkingEnabled) return null;

            // Gemini 需要检测版本
            const isGemini3 = model.includes('gemini-3') || model.includes('gemini3');

            if (isGemini3) {
                const level = state.thinkingStrength === 'low' ? 'LOW' : 'HIGH';
                return { thinkingConfig: { thinkingLevel: level, includeThoughts: true } };
            }
            // Gemini 2.5 或其他版本使用 thinkingBudget
            return { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } };

        case 'claude':
            // ✅ 修复：检查是否启用思考链
            if (!state.thinkingEnabled) return null;
            return { thinking: { type: 'enabled', budget_tokens: budget } };

        default:
            return null;
    }
}

/**
 * 构建输出详细度配置
 * 注意：所有格式都发送此参数，由 API 自行判断是否支持
 * @returns {Object|null} 详细度配置对象，或 null（如果未启用）
 */
export function buildVerbosityConfig() {
    // 只有启用时才发送参数
    if (state.verbosityEnabled && state.outputVerbosity) {
        return {
            text: {
                verbosity: state.outputVerbosity
            }
        };
    }
    return null;
}

/**
 * 获取自定义请求头对象
 * @returns {Object} 自定义请求头
 */
export function getCustomHeadersObject() {
    const headers = {};
    state.customHeaders.forEach(h => {
        if (h.key && h.value) {
            headers[h.key] = h.value;
        }
    });
    return headers;
}
