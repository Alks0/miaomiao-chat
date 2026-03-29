/**
 * 媒体工具函数
 * 统一处理图片/视频类型判断与下载逻辑
 */

/**
 * 常见视频 MIME 类型与扩展名映射
 */
const VIDEO_MIME_TO_EXT = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
    'video/mpeg': 'mpeg'
};

/**
 * 常见图片 MIME 类型与扩展名映射
 */
const IMAGE_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
};

/**
 * 判断是否为 Data URL
 * @param {string} url - URL
 * @returns {boolean}
 */
export function isDataUrl(url) {
    return typeof url === 'string' && url.startsWith('data:');
}

/**
 * 提取 Data URL 的 MIME 类型
 * @param {string} dataUrl - Data URL
 * @returns {string}
 */
export function extractDataUrlMimeType(dataUrl) {
    if (!isDataUrl(dataUrl)) return '';

    const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
    return (match?.[1] || '').toLowerCase();
}

/**
 * 判断是否为视频 MIME 类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isVideoMimeType(mimeType) {
    return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('video/');
}

/**
 * 判断是否为图片 MIME 类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isImageMimeType(mimeType) {
    return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

/**
 * 判断是否为音频 MIME 类型
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
export function isAudioMimeType(mimeType) {
    return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('audio/');
}

/**
 * 判断 Data URL 是否为视频
 * @param {string} dataUrl - Data URL
 * @returns {boolean}
 */
export function isVideoDataUrl(dataUrl) {
    return isVideoMimeType(extractDataUrlMimeType(dataUrl));
}

/**
 * 获取 URL 的扩展名（忽略 query/hash）
 * @param {string} url - URL
 * @returns {string}
 */
function getExtensionFromUrl(url) {
    if (!url || typeof url !== 'string') return '';

    try {
        const parsed = new URL(url, window.location.href);
        const pathname = parsed.pathname || '';
        const dotIndex = pathname.lastIndexOf('.');
        if (dotIndex === -1) return '';
        return pathname.slice(dotIndex + 1).toLowerCase();
    } catch {
        // 非标准 URL（如裸路径）
        const sanitized = url.split('?')[0].split('#')[0];
        const dotIndex = sanitized.lastIndexOf('.');
        if (dotIndex === -1) return '';
        return sanitized.slice(dotIndex + 1).toLowerCase();
    }
}

/**
 * 判断是否为 Capacitor 本地文件映射 URL
 * @param {string} url - URL
 * @returns {boolean}
 */
function isCapacitorLocalMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.includes('/_capacitor_file_/');
}

/**
 * 根据 MIME 类型获取扩展名
 * @param {string} mimeType - MIME 类型
 * @param {string} fallback - 兜底扩展名
 * @returns {string}
 */
export function getExtensionFromMimeType(mimeType, fallback = 'bin') {
    if (!mimeType || typeof mimeType !== 'string') return fallback;

    const normalized = mimeType.toLowerCase();
    if (VIDEO_MIME_TO_EXT[normalized]) return VIDEO_MIME_TO_EXT[normalized];
    if (IMAGE_MIME_TO_EXT[normalized]) return IMAGE_MIME_TO_EXT[normalized];

    const simple = normalized.split('/')[1] || '';
    if (!simple) return fallback;

    // 统一 jpeg 扩展名
    if (simple === 'jpeg') return 'jpg';
    return simple;
}

/**
 * 根据 URL/MIME 推断扩展名
 * @param {string} url - 媒体 URL
 * @param {string} mimeType - MIME 类型（可选）
 * @param {string} fallback - 兜底扩展名
 * @returns {string}
 */
export function getMediaExtension(url, mimeType = '', fallback = 'bin') {
    if (mimeType) {
        return getExtensionFromMimeType(mimeType, fallback);
    }

    if (isDataUrl(url)) {
        return getExtensionFromMimeType(extractDataUrlMimeType(url), fallback);
    }

    const ext = getExtensionFromUrl(url);
    return ext || fallback;
}

/**
 * 判断 URL 是否应按视频处理
 * @param {string} url - 媒体 URL
 * @param {string} mimeType - MIME 类型提示
 * @returns {boolean}
 */
export function isVideoUrl(url, mimeType = '') {
    if (isVideoMimeType(mimeType)) return true;

    if (isDataUrl(url)) {
        return isVideoDataUrl(url);
    }

    const ext = getExtensionFromUrl(url);
    return ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'mpeg', 'mpg', 'm4v'].includes(ext);
}

/**
 * 将 base64 转换为 Blob
 * @param {string} base64Data - base64 数据
 * @param {string} mimeType - MIME 类型
 * @returns {Blob}
 */
function base64ToBlob(base64Data, mimeType) {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

/**
 * 触发浏览器下载
 * @param {Blob} blob - 文件 Blob
 * @param {string} filename - 文件名
 */
function triggerBlobDownload(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || `download-${Date.now()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
}

/**
 * 下载通用媒体（图片/视频）
 * - data URL: 本地解码后下载
 * - file URL (Electron): 通过 IPC 读取后下载
 * - 其他 URL: 直接触发浏览器下载
 *
 * @param {string} mediaUrl - 媒体 URL
 * @param {string} filename - 建议文件名
 */
export async function downloadMedia(mediaUrl, filename = '') {
    try {
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            throw new Error('无效的媒体 URL');
        }

        // Data URL：直接解码
        if (isDataUrl(mediaUrl)) {
            const mimeType = extractDataUrlMimeType(mediaUrl) || 'application/octet-stream';
            const base64Data = mediaUrl.split(',')[1] || '';
            const blob = base64ToBlob(base64Data, mimeType);

            const finalName = filename || `media-${Date.now()}.${getExtensionFromMimeType(mimeType, 'bin')}`;
            triggerBlobDownload(blob, finalName);
            return;
        }

        // file:// URL：Electron 下通过主进程读取，保证下载可靠
        if (mediaUrl.startsWith('file://') && window.electron?.ipcRenderer) {
            const readResult = await window.electron.ipcRenderer.invoke('mcp:read-media-file', {
                fileUrl: mediaUrl
            });

            if (readResult?.success && readResult.base64) {
                const mimeType = readResult.mimeType || 'application/octet-stream';
                const blob = base64ToBlob(readResult.base64, mimeType);
                const finalName = filename || readResult.fileName || `media-${Date.now()}.${getExtensionFromMimeType(mimeType, 'bin')}`;
                triggerBlobDownload(blob, finalName);
                return;
            }
        }

        // Capacitor 本地文件 URL（Android）：先 fetch 成 Blob 再下载
        if (isCapacitorLocalMediaUrl(mediaUrl)) {
            const response = await fetch(mediaUrl);
            if (!response.ok) {
                throw new Error(`读取本地媒体失败: ${response.status}`);
            }

            const blob = await response.blob();
            const inferredMimeType = blob.type || 'application/octet-stream';
            const finalName = filename || `media-${Date.now()}.${getMediaExtension(mediaUrl, inferredMimeType, 'bin')}`;
            triggerBlobDownload(blob, finalName);
            return;
        }

        // HTTP/HTTPS/blob/file（非 Electron）等：回退到链接下载
        const link = document.createElement('a');
        link.href = mediaUrl;
        if (filename) {
            link.download = filename;
        }
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('[Media] 下载失败:', error);
        try {
            window.open(mediaUrl, '_blank');
        } catch {
            // ignore
        }
    }
}
