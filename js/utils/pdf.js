/**
 * PDF 渲染工具模块
 * 使用 pdf.js 将 PDF 文件逐页渲染为图片
 */

/**
 * pdf.js 库的懒加载引用
 * @type {Object|null}
 */
let pdfjsLib = null;

/**
 * 动态加载 pdf.js 库
 * @returns {Promise<Object>} pdfjsLib 模块
 */
async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;

    try {
        pdfjsLib = await import('../../libs/pdfjs/pdf.min.mjs');

        // 设置 worker 路径
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/pdf.worker.min.mjs';

        console.log('[PDF] pdf.js 已加载, 版本:', pdfjsLib.version);
        return pdfjsLib;
    } catch (error) {
        console.error('[PDF] pdf.js 加载失败:', error);
        throw new Error('PDF 渲染库加载失败，请检查 libs/pdfjs/ 目录');
    }
}

/**
 * 将 PDF 文件的 Data URL 逐页渲染为图片
 *
 * @param {string} pdfDataUrl - PDF 文件的 Data URL (data:application/pdf;base64,...)
 * @param {Object} options - 渲染选项
 * @param {number} options.scale - 渲染缩放比例，默认 1.5（约 150 DPI）
 * @param {string} options.format - 输出图片格式，'image/png' 或 'image/jpeg'
 * @param {number} options.quality - JPEG 质量（0-1），仅 format='image/jpeg' 时有效
 * @param {number} options.maxPages - 最大渲染页数，默认 20
 * @param {Function} options.onProgress - 进度回调 (currentPage, totalPages)
 * @returns {Promise<Array<{data: string, name: string, type: string, category: string, size: number}>>}
 *          返回图片数组，每个元素与 state.uploadedImages 中的格式兼容
 */
export async function renderPdfToImages(pdfDataUrl, options = {}) {
    const {
        scale = 1.5,
        format = 'image/jpeg',
        quality = 0.85,
        maxPages = 20,
        onProgress = null,
    } = options;

    // 加载 pdf.js
    const pdfjs = await loadPdfJs();

    // data URL → ArrayBuffer（避免 atob 的中间字符串拷贝）
    const response = await fetch(pdfDataUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());

    // 加载 PDF 文档
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const totalPages = Math.min(pdf.numPages, maxPages);

    console.log(`[PDF] 开始渲染: 共 ${pdf.numPages} 页, 将渲染 ${totalPages} 页, scale=${scale}`);

    if (pdf.numPages > maxPages) {
        console.warn(`[PDF] PDF 共 ${pdf.numPages} 页，超过上限 ${maxPages}，只渲染前 ${maxPages} 页`);
    }

    const images = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            // 获取页面
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });

            // 设置 canvas 尺寸
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // 渲染到 canvas
            await page.render({
                canvasContext: ctx,
                viewport: viewport,
            }).promise;

            // 转换为图片 Data URL
            const imageDataUrl = canvas.toDataURL(format, quality);

            // 计算图片大小（近似）
            const imageBase64 = imageDataUrl.split(',')[1];
            const imageSize = Math.floor((imageBase64.length * 3) / 4);

            const ext = format === 'image/jpeg' ? 'jpg' : 'png';

            images.push({
                data: imageDataUrl,
                name: `pdf_page_${pageNum}.${ext}`,
                type: format,
                category: 'image',
                size: imageSize,
            });

            console.log(
                `[PDF] 第 ${pageNum}/${totalPages} 页渲染完成: ${viewport.width}x${viewport.height} → ${(imageSize / 1024).toFixed(0)}KB`
            );

            // 进度回调
            if (onProgress) {
                onProgress(pageNum, totalPages);
            }
        } catch (err) {
            console.error(`[PDF] 第 ${pageNum} 页渲染失败:`, err);
            // 继续渲染其他页
        }
    }

    // 清理
    await pdf.destroy();
    canvas.width = 0;
    canvas.height = 0;

    console.log(`[PDF] 渲染完成: ${images.length} 张图片`);
    return images;
}
