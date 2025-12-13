/**
 * 消息格式转换器
 * 在 OpenAI、Gemini、Claude 三种 API 格式之间转换消息
 * 纯函数，无副作用
 */

/**
 * 转换为 OpenAI 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} images - 图片数组（data URLs）
 * @returns {Object} OpenAI 格式消息
 */
export function toOpenAIMessage(role, content, images = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理图片
    if (images && images.length > 0) {
        const parts = [];
        if (content) {
            parts.push({ type: 'text', text: content });
        }
        images.forEach(img => {
            parts.push({ type: 'image_url', image_url: { url: img } });
        });
        return { role: normalizedRole, content: parts };
    }

    return { role: normalizedRole, content: content || '' };
}

/**
 * 转换为 Gemini 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} images - 图片数组（data URLs）
 * @returns {Object} Gemini 格式消息
 */
export function toGeminiMessage(role, content, images = null) {
    const geminiRole = role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (content) {
        parts.push({ text: content });
    }

    if (images && images.length > 0) {
        images.forEach(img => {
            // 从 data URL 提取 base64
            const match = img.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inlineData: {
                        mimeType: match[1],
                        data: match[2]
                    }
                });
            }
        });
    }

    return { role: geminiRole, parts };
}

/**
 * 转换为 Claude 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} images - 图片数组（data URLs）
 * @returns {Object} Claude 格式消息
 */
export function toClaudeMessage(role, content, images = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理图片
    if (images && images.length > 0) {
        const parts = [];
        images.forEach(img => {
            const match = img.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                parts.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: match[1],
                        data: match[2]
                    }
                });
            }
        });
        if (content) {
            parts.push({ type: 'text', text: content });
        }
        return { role: normalizedRole, content: parts };
    }

    return { role: normalizedRole, content: content || '' };
}
