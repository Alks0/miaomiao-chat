/**
 * 文件处理工具
 * 统一的文件类型判断和文件名处理逻辑
 */

/**
 * 文件类别枚举
 */
export const FileCategory = {
    IMAGE: 'image',
    PDF: 'pdf',
    TEXT: 'text',
    UNKNOWN: 'unknown'
};

/**
 * 支持的图片 MIME 类型
 */
export const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
];

/**
 * 支持的文本 MIME 类型
 */
export const SUPPORTED_TEXT_TYPES = [
    'text/plain',
    'text/markdown',
    'text/html',
    'text/csv',
    'text/xml'
];

/**
 * 判断文件的 MIME 类型类别
 * @param {string} mimeType - MIME 类型
 * @returns {'image'|'pdf'|'text'|'unknown'} 文件类别
 */
export function categorizeFile(mimeType) {
    if (!mimeType) return FileCategory.UNKNOWN;

    if (mimeType.startsWith('image/')) return FileCategory.IMAGE;
    if (mimeType === 'application/pdf') return FileCategory.PDF;
    if (mimeType === 'text/plain' ||
        mimeType === 'text/markdown' ||
        mimeType.startsWith('text/')) {
        return FileCategory.TEXT;
    }

    return FileCategory.UNKNOWN;
}

/**
 * 检查是否为图片类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isImage(mimeType) {
    return mimeType && mimeType.startsWith('image/');
}

/**
 * 检查是否为 PDF 类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isPDF(mimeType) {
    return mimeType === 'application/pdf';
}

/**
 * 检查是否为文本类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isText(mimeType) {
    return mimeType && (
        mimeType === 'text/plain' ||
        mimeType === 'text/markdown' ||
        mimeType.startsWith('text/')
    );
}

/**
 * 截断文件名以适应显示
 * @param {string} name - 文件名
 * @param {number} maxLen - 最大长度（默认 20）
 * @returns {string} 截断后的文件名
 */
export function truncateFileName(name, maxLen = 20) {
    if (!name || name.length <= maxLen) return name || '';

    // 提取扩展名
    const lastDotIndex = name.lastIndexOf('.');
    if (lastDotIndex === -1) {
        // 无扩展名，直接截断
        return name.slice(0, maxLen - 3) + '...';
    }

    const ext = name.slice(lastDotIndex + 1);
    const baseName = name.slice(0, lastDotIndex);

    // 计算基础名称可用长度（保留 3 个字符给 "..." 和扩展名的 "."）
    const availableLength = maxLen - ext.length - 4;
    if (availableLength < 1) {
        // 扩展名太长，仅保留部分
        return name.slice(0, maxLen - 3) + '...';
    }

    const truncatedBase = baseName.slice(0, availableLength) + '...';
    return `${truncatedBase}.${ext}`;
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小字符串
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = bytes / Math.pow(k, i);

    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 从 Data URL 中提取 MIME 类型和 Base64 数据
 * @param {string} dataUrl - Data URL
 * @returns {{mimeType: string, base64: string} | null} 提取结果
 */
export function parseDataURL(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;

    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) return null;

    return {
        mimeType: match[1],
        base64: match[2]
    };
}

/**
 * 检查文件是否为 Data URL 格式
 * @param {string} url - URL 字符串
 * @returns {boolean}
 */
export function isDataURL(url) {
    return typeof url === 'string' && url.startsWith('data:');
}

/**
 * 检查文件是否为 HTTP(S) URL
 * @param {string} url - URL 字符串
 * @returns {boolean}
 */
export function isHttpURL(url) {
    return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * 从文件名获取扩展名
 * @param {string} filename - 文件名
 * @returns {string} 扩展名（小写，不含点）
 */
export function getFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return '';

    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) return '';

    return filename.slice(lastDotIndex + 1).toLowerCase();
}

/**
 * 根据扩展名猜测 MIME 类型
 * @param {string} filename - 文件名
 * @returns {string} MIME 类型
 */
export function guessMimeType(filename) {
    const ext = getFileExtension(filename);

    const mimeMap = {
        // 图片
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'svg': 'image/svg+xml',

        // 文档
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'html': 'text/html',
        'htm': 'text/html',
        'csv': 'text/csv',
        'xml': 'text/xml',

        // 代码
        'js': 'text/javascript',
        'json': 'application/json',
        'css': 'text/css',

        // 默认
        '': 'application/octet-stream'
    };

    return mimeMap[ext] || 'application/octet-stream';
}
