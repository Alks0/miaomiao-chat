/**
 * 预填充消息处理模块
 * 处理预填充消息的格式转换
 */

import { state } from '../core/state.js';
import { processVariables } from './variables.js';

/**
 * 获取预填充消息（根据 API 格式转换）
 * @param {string} format - API 格式 ('openai'|'gemini'|'claude')
 * @returns {Array} 预填充消息数组
 */
export function getPrefillMessages(format = state.apiFormat) {
    if (!state.prefillEnabled || !state.prefillMessages.length) return [];

    return state.prefillMessages
        .filter(m => m.role !== 'system')  // 过滤 system，避免混入对话
        .map(m => {
            const content = processVariables(m.content);

            if (format === 'gemini') {
                // Gemini 只支持 user 和 model 角色
                return {
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: content }]
                };
            }
            // OpenAI 和 Claude 格式相同
            return {
                role: m.role,
                content: content
            };
        });
}
