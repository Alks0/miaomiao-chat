/**
 * 预填充消息处理模块
 * 处理预填充消息的格式转换
 */

import { state } from '../core/state.js';
import { processVariables } from './variables.js';

/**
 * 获取开场对话消息（在 System Prompt 之后、对话历史之前插入）
 * @param {string} format - API 格式 ('openai'|'gemini'|'claude')
 * @returns {Array} 开场对话消息数组
 */
export function getOpeningMessages(format = state.apiFormat) {
    if (!state.prefillEnabled || !state.systemPrefillMessages || !state.systemPrefillMessages.length) return [];

    return state.systemPrefillMessages
        .filter(m => m.role !== 'system' && m.content && m.content.trim())  // 过滤 system 和空内容
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

/**
 * 获取预填充消息（在用户最新输入之后插入）
 * @param {string} format - API 格式 ('openai'|'gemini'|'claude')
 * @returns {Array} 预填充消息数组
 */
export function getPrefillMessages(format = state.apiFormat) {
    if (!state.prefillEnabled || !state.prefillMessages.length) return [];

    return state.prefillMessages
        .filter(m => m.role !== 'system' && m.content && m.content.trim())  // 过滤 system 和空内容
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
