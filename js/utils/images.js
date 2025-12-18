/**
 * 图片处理工具模块
 * 压缩图片、下载图片等功能
 */

import { detectImageFormat } from './helpers.js';
import { API_FILE_SIZE_LIMITS } from './constants.js';

/**
 * API 图片大小限制配置
 * Note: Claude has a stricter limit of 5MB per image
 */
const API_IMAGE_LIMITS = {
    'gemini': API_FILE_SIZE_LIMITS.gemini,
    'openai': API_FILE_SIZE_LIMITS.openai,
    'claude': 5 * 1024 * 1024     // 5 MB (单张图片限制) - Claude specific
};

/**
 * 计算 base64 字符串的字节大小
 * @param {string} base64String - Base64 字符串
 * @returns {number} 字节大小
 */
function getBase64Size(base64String) {
    // Base64 每 4 个字符代表 3 字节，padding 会影响最后的字节数
    const padding = (base64String.match(/=/g) || []).length;
    return Math.floor((base64String.length * 3) / 4) - padding;
}

/**
 * 智能压缩图片
 * @param {string} base64Data - Base64 编码的图片数据
 * @param {string} mimeType - MIME 类型
 * @param {Object} options - 压缩选项
 * @param {boolean} options.fastMode - 高速压缩模式（512px）
 * @param {string} options.apiFormat - API 格式 ('gemini' | 'openai' | 'claude')
 * @returns {Promise<{data: string, mimeType: string, originalSize: number, compressedSize: number}>}
 */
export function compressImage(base64Data, mimeType, options = {}) {
    const { fastMode = false, apiFormat = 'openai' } = options;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const originalSize = getBase64Size(base64Data);
            const sizeLimit = API_IMAGE_LIMITS[apiFormat] || API_IMAGE_LIMITS['openai'];

            let targetWidth = img.width;
            let targetHeight = img.height;
            let quality = 0.92;

            // ⚡ 高速压缩模式：固定 512px, 质量 0.7
            if (fastMode) {
                const maxSize = 512;
                if (targetWidth > maxSize || targetHeight > maxSize) {
                    if (targetWidth > targetHeight) {
                        targetHeight = Math.round(targetHeight * maxSize / targetWidth);
                        targetWidth = maxSize;
                    } else {
                        targetWidth = Math.round(targetWidth * maxSize / targetHeight);
                        targetHeight = maxSize;
                    }
                }
                quality = 0.7;
            }
            // 🎯 智能压缩模式：根据文件大小和 API 限制动态调整
            else {
                // 如果原图小于限制的 80%，尽量保留原图
                if (originalSize < sizeLimit * 0.8) {
                    // 保持原始尺寸，仅调整质量
                    quality = 0.92;
                }
                // 如果原图在 80%-100% 之间，轻度压缩
                else if (originalSize < sizeLimit) {
                    const maxDim = Math.max(targetWidth, targetHeight);
                    if (maxDim > 2048) {
                        const scale = 2048 / maxDim;
                        targetWidth = Math.round(targetWidth * scale);
                        targetHeight = Math.round(targetHeight * scale);
                    }
                    quality = 0.85;
                }
                // 如果原图超过限制，需要压缩
                else {
                    // 根据超出程度决定压缩强度
                    const ratio = originalSize / sizeLimit;

                    if (ratio < 1.5) {
                        // 轻度超出：压缩到 1536px
                        const maxDim = Math.max(targetWidth, targetHeight);
                        if (maxDim > 1536) {
                            const scale = 1536 / maxDim;
                            targetWidth = Math.round(targetWidth * scale);
                            targetHeight = Math.round(targetHeight * scale);
                        }
                        quality = 0.80;
                    } else if (ratio < 2.5) {
                        // 中度超出：压缩到 1024px
                        const maxDim = Math.max(targetWidth, targetHeight);
                        if (maxDim > 1024) {
                            const scale = 1024 / maxDim;
                            targetWidth = Math.round(targetWidth * scale);
                            targetHeight = Math.round(targetHeight * scale);
                        }
                        quality = 0.75;
                    } else {
                        // 严重超出：压缩到 768px
                        const maxDim = Math.max(targetWidth, targetHeight);
                        if (maxDim > 768) {
                            const scale = 768 / maxDim;
                            targetWidth = Math.round(targetWidth * scale);
                            targetHeight = Math.round(targetHeight * scale);
                        }
                        quality = 0.70;
                    }
                }
            }

            // 创建 canvas 压缩
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            // 转换为 JPEG
            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            const compressedBase64 = compressedDataUrl.split(',')[1];
            const compressedSize = getBase64Size(compressedBase64);

            console.log(`[图片压缩] ${fastMode ? '⚡ 高速模式' : '🎯 智能模式'} | API: ${apiFormat} | 原始: ${(originalSize / 1024 / 1024).toFixed(2)}MB | 压缩后: ${(compressedSize / 1024 / 1024).toFixed(2)}MB | 尺寸: ${img.width}x${img.height} → ${targetWidth}x${targetHeight} | 质量: ${quality}`);

            resolve({
                data: compressedBase64,
                mimeType: 'image/jpeg',
                originalSize,
                compressedSize
            });
        };
        img.onerror = () => {
            // 压缩失败，返回原数据
            console.warn('[图片压缩] 加载失败，返回原数据');
            resolve({
                data: base64Data,
                mimeType,
                originalSize: getBase64Size(base64Data),
                compressedSize: getBase64Size(base64Data)
            });
        };
        img.src = `data:${mimeType};base64,${base64Data}`;
    });
}

/**
 * 检测是否为图片大小超限错误
 * @param {Error|Object} error - 错误对象
 * @returns {boolean} 是否为图片大小超限错误
 */
export function isImageSizeError(error) {
    const errorMessage = error?.message || error?.error?.message || JSON.stringify(error);
    const errorString = errorMessage.toLowerCase();

    // OpenAI 错误模式
    if (errorString.includes('image') && (
        errorString.includes('exceeds') ||
        errorString.includes('too large') ||
        errorString.includes('20971520') ||  // 20MB in bytes
        errorString.includes('size limit')
    )) {
        return true;
    }

    // Gemini 错误模式
    if (errorString.includes('413') ||
        errorString.includes('request entity too large') ||
        errorString.includes('payload') && errorString.includes('20') ||
        errorString.includes('request size exceeds')
    ) {
        return true;
    }

    // Claude 错误模式
    if (errorString.includes('image') && (
        errorString.includes('5') && errorString.includes('mb') ||
        errorString.includes('5242880') ||  // 5MB in bytes
        errorString.includes('exceeds the limit')
    )) {
        return true;
    }

    return false;
}

/**
 * 压缩消息中的所有图片
 * @param {Array} messages - 消息数组
 * @param {string} apiFormat - API 格式
 * @param {boolean} fastMode - 是否使用高速压缩
 * @returns {Promise<Array>} 压缩后的消息数组
 */
export async function compressImagesInMessages(messages, apiFormat, fastMode = false) {
    const compressedMessages = [];

    for (const msg of messages) {
        const compressedMsg = { ...msg };

        // 处理不同格式的图片
        if (msg.content && Array.isArray(msg.content)) {
            // OpenAI/Claude 格式：content 是数组
            compressedMsg.content = [];
            for (const part of msg.content) {
                if (part.type === 'image_url' && part.image_url?.url) {
                    // OpenAI 格式
                    const url = part.image_url.url;
                    const match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        const [, mimeType, base64Data] = match;
                        const compressed = await compressImage(base64Data, mimeType, { fastMode, apiFormat });
                        compressedMsg.content.push({
                            ...part,
                            image_url: {
                                ...part.image_url,
                                url: `data:${compressed.mimeType};base64,${compressed.data}`
                            }
                        });
                        console.log(`[重试] 压缩图片: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB`);
                    } else {
                        compressedMsg.content.push(part);
                    }
                } else if (part.type === 'image' && part.source?.data) {
                    // Claude 格式
                    const compressed = await compressImage(part.source.data, part.source.media_type, { fastMode, apiFormat });
                    compressedMsg.content.push({
                        ...part,
                        source: {
                            ...part.source,
                            media_type: compressed.mimeType,
                            data: compressed.data
                        }
                    });
                    console.log(`[重试] 压缩图片: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB`);
                } else {
                    compressedMsg.content.push(part);
                }
            }
        } else if (msg.parts && Array.isArray(msg.parts)) {
            // Gemini 格式：parts 数组
            compressedMsg.parts = [];
            for (const part of msg.parts) {
                if (part.inlineData) {
                    const compressed = await compressImage(part.inlineData.data, part.inlineData.mimeType, { fastMode, apiFormat });
                    compressedMsg.parts.push({
                        ...part,
                        inlineData: {
                            mimeType: compressed.mimeType,
                            data: compressed.data
                        }
                    });
                    console.log(`[重试] 压缩图片: ${(compressed.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressed.compressedSize / 1024 / 1024).toFixed(2)}MB`);
                } else {
                    compressedMsg.parts.push(part);
                }
            }
        } else {
            // 无图片内容
            compressedMessages.push(msg);
            continue;
        }

        compressedMessages.push(compressedMsg);
    }

    return compressedMessages;
}

/**
 * 下载图片（保持原始格式）
 * @param {string} dataUrl - Data URL
 * @param {string} filename - 文件名
 */
export function downloadImage(dataUrl, filename) {
    try {
        // 解析 data URL
        const [header, base64Data] = dataUrl.split(',');
        const declaredMime = header.match(/data:([^;]+)/)?.[1] || 'image/png';

        // 将 base64 转换为二进制数据
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 检测实际格式（不信任声明的 MIME 类型）
        const detected = detectImageFormat(bytes);

        // 修正文件名扩展名
        const baseName = filename.replace(/\.[^.]+$/, '');
        const correctFilename = `${baseName}.${detected.ext}`;

        // 创建 Blob（使用检测到的实际格式）
        const blob = new Blob([bytes], { type: detected.mime });

        // 创建下载链接
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = correctFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 释放 URL
        URL.revokeObjectURL(url);

        console.log(`下载图片: ${correctFilename}`);
        console.log(`  声明格式: ${declaredMime}`);
        console.log(`  实际格式: ${detected.mime}`);
        console.log(`  文件大小: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
        console.error('下载图片失败:', e);
        window.open(dataUrl, '_blank');
    }
}
