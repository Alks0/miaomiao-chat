/**
 * Markdown 图片解析工具
 * 处理 OpenAI 格式返回的 markdown 图片：![image](data:image/jpeg;base64,...)
 */

/**
 * 检测文本中是否包含 markdown 图片
 * @param {string} text - 文本内容
 * @returns {boolean}
 */
export function containsMarkdownImage(text) {
    if (!text || typeof text !== 'string') return false;
    return /!\[.*?\]\(data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(text);
}

/**
 * 解析文本中的 markdown 图片
 * @param {string} text - 包含 markdown 图片的文本
 * @returns {Array<Object>} 解析后的内容部分
 * @example
 * // 输入: "这是文本 ![image](data:image/jpeg;base64,/9j/4AAQ...) 更多文本"
 * // 输出: [
 * //   { type: 'text', text: '这是文本 ' },
 * //   { type: 'image_url', url: 'data:image/jpeg;base64,/9j/4AAQ...', complete: true },
 * //   { type: 'text', text: ' 更多文本' }
 * // ]
 */
export function parseMarkdownImages(text) {
    if (!text || typeof text !== 'string') {
        return [{ type: 'text', text: text || '' }];
    }

    const parts = [];
    // 匹配 markdown 图片格式：![任意文本](data:image/类型;base64,数据)
    const imageRegex = /!\[([^\]]*)\]\((data:image\/(jpeg|jpg|png|gif|webp);base64,[^)]+)\)/g;

    let lastIndex = 0;
    let match;

    while ((match = imageRegex.exec(text)) !== null) {
        // 添加图片前的文本
        if (match.index > lastIndex) {
            const textBefore = text.substring(lastIndex, match.index);
            if (textBefore) {
                parts.push({ type: 'text', text: textBefore });
            }
        }

        // 添加图片
        const altText = match[1];  // 图片的 alt 文本
        const dataUrl = match[2];  // data URL

        parts.push({
            type: 'image_url',
            url: dataUrl,
            alt: altText || 'Generated Image',
            complete: true
        });

        lastIndex = imageRegex.lastIndex;
    }

    // 添加剩余的文本
    if (lastIndex < text.length) {
        const textAfter = text.substring(lastIndex);
        if (textAfter) {
            parts.push({ type: 'text', text: textAfter });
        }
    }

    // 如果没有匹配到图片，返回原文本
    if (parts.length === 0) {
        return [{ type: 'text', text: text }];
    }

    return parts;
}

/**
 * 处理流式内容片段，累积并解析 markdown 图片
 * @param {string} chunk - 当前接收到的文本片段
 * @param {string} buffer - 缓冲区（用于暂存不完整的图片）
 * @returns {Object} { parts: Array<Object>, newBuffer: string }
 */
export function parseStreamingMarkdownImages(chunk, buffer = '') {
    if (!chunk || typeof chunk !== 'string') {
        return { parts: [], newBuffer: buffer };
    }

    // 合并缓冲区和新块
    const fullText = buffer + chunk;

    // 检查是否包含完整的图片
    const imageRegex = /!\[([^\]]*)\]\((data:image\/(jpeg|jpg|png|gif|webp);base64,[^)]+)\)/g;

    const parts = [];
    let lastIndex = 0;
    let match;
    const hasIncompleteImage = false;

    while ((match = imageRegex.exec(fullText)) !== null) {
        // 添加图片前的文本
        if (match.index > lastIndex) {
            const textBefore = fullText.substring(lastIndex, match.index);
            if (textBefore) {
                parts.push({ type: 'text', text: textBefore });
            }
        }

        // 添加图片
        parts.push({
            type: 'image_url',
            url: match[2],
            alt: match[1] || 'Generated Image',
            complete: true
        });

        lastIndex = imageRegex.lastIndex;
    }

    // 检查是否有不完整的图片开始标记
    const remainingText = fullText.substring(lastIndex);
    const incompleteImageStart = remainingText.match(/!\[([^\]]*)\]?\(?(?:data:image\/[^)]*)?$/);

    if (incompleteImageStart) {
        // 有不完整的图片，将其保留在缓冲区
        const textBeforeIncomplete = remainingText.substring(0, incompleteImageStart.index);
        if (textBeforeIncomplete) {
            parts.push({ type: 'text', text: textBeforeIncomplete });
        }

        return {
            parts: parts,
            newBuffer: remainingText.substring(incompleteImageStart.index)
        };
    } else {
        // 没有不完整的图片，清空缓冲区
        if (remainingText) {
            parts.push({ type: 'text', text: remainingText });
        }

        return {
            parts: parts,
            newBuffer: ''
        };
    }
}

/**
 * 合并文本部分（优化 contentParts）
 * @param {Array<Object>} parts - 内容部分数组
 * @returns {Array<Object>} 合并后的数组
 */
export function mergeTextParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) return parts;

    const merged = [];
    let currentText = null;

    for (const part of parts) {
        if (part.type === 'text') {
            if (currentText === null) {
                currentText = { type: 'text', text: part.text };
            } else {
                currentText.text += part.text;
            }
        } else {
            // 遇到非文本部分，先保存累积的文本
            if (currentText !== null) {
                merged.push(currentText);
                currentText = null;
            }
            merged.push(part);
        }
    }

    // 保存最后的文本
    if (currentText !== null) {
        merged.push(currentText);
    }

    return merged;
}
