/**
 * 消息格式转换器
 * 在 OpenAI、Gemini、Claude 三种 API 格式之间转换消息
 * 纯函数，无副作用
 *
 * 支持的附件类型：
 * - 图片: image/jpeg, image/png, image/gif, image/webp
 * - PDF: application/pdf
 * - 文本: text/plain
 */

/**
 * 判断 MIME 类型的文件类别
 * @param {string} mimeType - MIME 类型
 * @returns {'image'|'pdf'|'text'|'unknown'} 文件类别
 */
export function getFileCategory(mimeType) {
    if (!mimeType) return 'unknown';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType.startsWith('text/')) return 'text';
    return 'unknown';
}

/**
 * 转换为 OpenAI 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} OpenAI 格式消息
 */
export function toOpenAIMessage(role, content, attachments = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理附件
    if (attachments && attachments.length > 0) {
        const parts = [];
        if (content) {
            parts.push({ type: 'text', text: content });
        }
        attachments.forEach(att => {
            // 检查是否是 data URL
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image') {
                    // 图片使用 image_url 格式
                    parts.push({ type: 'image_url', image_url: { url: att } });
                } else if (category === 'pdf') {
                    // PDF 使用 file 格式（OpenAI 2025.3 新增）
                    parts.push({
                        type: 'file',
                        file: {
                            filename: 'document.pdf',
                            file_data: `data:${mimeType};base64,${base64Data}`
                        }
                    });
                } else if (category === 'text') {
                    // 文本文件：解码后作为文本内容插入
                    try {
                        const textContent = decodeURIComponent(escape(atob(base64Data)));
                        parts.push({
                            type: 'text',
                            text: `<document>\n${textContent}\n</document>`
                        });
                    } catch (e) {
                        console.warn('无法解码文本文件:', e);
                    }
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容（不是 Data URL）
                parts.push({
                    type: 'text',
                    text: `<document>\n${att}\n</document>`
                });
            } else {
                // 兼容旧格式（纯 URL）
                parts.push({ type: 'image_url', image_url: { url: att } });
            }
        });
        return { role: normalizedRole, content: parts };
    }

    return { role: normalizedRole, content: content || '' };
}

/**
 * 转换为 Gemini 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} Gemini 格式消息
 */
export function toGeminiMessage(role, content, attachments = null) {
    const geminiRole = role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (content) {
        parts.push({ text: content });
    }

    if (attachments && attachments.length > 0) {
        attachments.forEach(att => {
            // 从 data URL 提取 base64
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image' || category === 'pdf') {
                    // 图片和 PDF 都使用 inlineData 格式
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                } else if (category === 'text') {
                    // 文本文件：Gemini 支持 text/plain 的 inlineData
                    parts.push({
                        inlineData: {
                            mimeType: 'text/plain',
                            data: base64Data
                        }
                    });
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容，需要编码为 base64
                const base64 = btoa(unescape(encodeURIComponent(att)));
                parts.push({
                    inlineData: {
                        mimeType: 'text/plain',
                        data: base64
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
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} Claude 格式消息
 */
export function toClaudeMessage(role, content, attachments = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理附件
    if (attachments && attachments.length > 0) {
        const parts = [];
        attachments.forEach(att => {
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image') {
                    // 图片使用 image 类型
                    parts.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64Data
                        }
                    });
                } else if (category === 'pdf') {
                    // PDF 使用 document 类型
                    parts.push({
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: base64Data
                        }
                    });
                } else if (category === 'text') {
                    // 文本文件：解码后作为文本内容插入
                    try {
                        const textContent = decodeURIComponent(escape(atob(base64Data)));
                        parts.push({
                            type: 'text',
                            text: `<document>\n${textContent}\n</document>`
                        });
                    } catch (e) {
                        console.warn('无法解码文本文件:', e);
                    }
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容（不是 Data URL）
                parts.push({
                    type: 'text',
                    text: `<document>\n${att}\n</document>`
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
