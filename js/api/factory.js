/**
 * API 工厂模块
 * 根据 API 格式返回对应的请求处理器
 */

import { sendOpenAIRequest } from './openai.js';
import { sendGeminiRequest } from './gemini.js';
import { sendClaudeRequest } from './claude.js';

/**
 * 根据 API 格式获取对应的发送函数
 * @param {string} format - API 格式 ('openai'|'openai-responses'|'gemini'|'claude')
 * @returns {Function} 发送函数
 */
export function getSendFunction(format) {
    const senders = {
        openai: sendOpenAIRequest,
        'openai-responses': sendOpenAIRequest,  // Responses API 使用相同的函数
        gemini: sendGeminiRequest,
        claude: sendClaudeRequest,
    };

    const sender = senders[format];
    if (!sender) {
        throw new Error(`Unsupported API format: ${format}`);
    }

    return sender;
}
