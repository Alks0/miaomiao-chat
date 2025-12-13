/**
 * 图片处理工具模块
 * 压缩图片、下载图片等功能
 */

import { detectImageFormat } from './helpers.js';

/**
 * 压缩图片到指定尺寸
 * @param {string} base64Data - Base64 编码的图片数据
 * @param {string} mimeType - MIME 类型
 * @param {number} maxSize - 最大尺寸（宽或高）
 * @returns {Promise<{data: string, mimeType: string}>} 压缩后的图片数据
 */
export function compressImage(base64Data, mimeType, maxSize = 512) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // 计算缩放比例
            let width = img.width;
            let height = img.height;

            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }

            // 创建 canvas 压缩
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 转换为 JPEG 以减小体积（质量 0.7）
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            const compressedBase64 = compressedDataUrl.split(',')[1];

            resolve({
                data: compressedBase64,
                mimeType: 'image/jpeg'
            });
        };
        img.onerror = () => {
            // 压缩失败，返回原数据
            resolve({ data: base64Data, mimeType });
        };
        img.src = `data:${mimeType};base64,${base64Data}`;
    });
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
