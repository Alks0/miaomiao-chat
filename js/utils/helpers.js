/**
 * 通用工具函数
 * 纯函数，无副作用，不依赖全局状态
 */

/**
 * HTML 转义，防止 XSS 攻击
 * @param {string} text - 需要转义的文本
 * @returns {string} 转义后的 HTML 安全文本
 */
export function escapeHtml(text) {
    // 增强：处理 null/undefined
    if (text === null || text === undefined) {
        return '';
    }

    // 增强：非字符串转为字符串
    if (typeof text !== 'string') {
        text = String(text);
    }

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 检测图片实际格式（通过文件头魔数）
 * @param {Uint8Array} bytes - 图片字节数据
 * @returns {{mime: string, ext: string}} 图片MIME类型和扩展名
 */
export function detectImageFormat(bytes) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return { mime: 'image/gif', ext: 'gif' };
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return { mime: 'image/webp', ext: 'webp' };
    }
    // 默认
    return { mime: 'image/png', ext: 'png' };
}

/**
 * 从文本中提取 base64 图片
 * @param {string} text - 包含 markdown 图片的文本
 * @returns {{text: string, images: Array}} 提取后的文本和图片数组
 */
export function extractBase64Images(text) {
    const images = [];

    // 匹配 markdown 图片语法: ![alt](data:image/...;base64,...)
    const imgRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;

    const result = text.replace(imgRegex, (match, alt, dataUrl) => {
        const index = images.length;
        images.push({ alt, dataUrl });
        // 使用 HTML 注释作为占位符，不会被 markdown 解析
        return `<!--IMG_PLACEHOLDER_${index}-->`;
    });

    return { text: result, images };
}

/**
 * 还原 base64 图片为 HTML img 标签
 * @param {string} html - 包含占位符的 HTML
 * @param {Array} images - 图片数组
 * @returns {string} 还原后的 HTML
 */
export function restoreBase64Images(html, images) {
    images.forEach((img, index) => {
        const imgTag = `<img src="${img.dataUrl}" alt="${img.alt || 'Generated image'}" style="max-width: 100%; height: auto;">`;
        html = html.replace(`<!--IMG_PLACEHOLDER_${index}-->`, imgTag);
    });
    return html;
}

/**
 * 生成唯一的会话 ID
 * @returns {string} 会话 ID
 */
export function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 生成唯一的消息 ID
 * @returns {string} 消息 ID
 */
export function generateMessageId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 生成通用的唯一 ID
 * @param {string} prefix - ID 前缀 (可选)
 * @returns {string} 唯一 ID
 */
export function generateId(prefix = 'id') {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 智能生成会话名称
 * @param {string} content - 会话内容
 * @param {number} maxLength - 最大长度
 * @returns {string} 会话名称
 */
export function generateSessionName(content, maxLength = 25) {
    if (!content) return '新会话';

    // 1. 清理内容：合并换行和多余空白
    const cleaned = content
        .replace(/\n+/g, ' ')           // 换行转空格
        .replace(/\s+/g, ' ')           // 多个空白合并为一个
        .replace(/[^\w\u4e00-\u9fff\s]/g, '') // 保留字母、数字、中文和空格
        .trim();

    if (!cleaned) return '新会话';

    // 2. 如果内容短于最大长度，直接返回
    if (cleaned.length <= maxLength) {
        return cleaned;
    }

    // 3. 智能截断：优先在空格/标点处截断
    const truncated = cleaned.substring(0, maxLength);

    // 找最后一个合适的断点（空格、中文后）
    let breakPoint = -1;

    // 优先在空格处截断
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.6) {
        breakPoint = lastSpace;
    }

    // 如果没找到好的断点，就在中文字符后截断（中文不需要在词边界）
    if (breakPoint === -1) {
        // 检查是否大部分是中文
        const chineseCount = (truncated.match(/[\u4e00-\u9fff]/g) || []).length;
        if (chineseCount > truncated.length * 0.5) {
            // 主要是中文，直接截断
            breakPoint = maxLength;
        } else {
            // 混合内容，尝试在最后一个中文字符后截断
            for (let i = maxLength - 1; i >= maxLength * 0.6; i--) {
                if (/[\u4e00-\u9fff]/.test(truncated[i])) {
                    breakPoint = i + 1;
                    break;
                }
            }
        }
    }

    // 如果还是没找到，就强制截断
    if (breakPoint === -1) {
        breakPoint = maxLength;
    }

    return truncated.substring(0, breakPoint).trim() + '...';
}

/**
 * 下载图片
 * @param {string} dataUrl - 图片 data URL
 * @param {string} filename - 文件名
 */
export function downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
