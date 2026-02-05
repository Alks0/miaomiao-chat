/**
 * 图片懒加载管理器
 * 优化大量图片加载性能，特别是4K图片场景
 */

import { eventBus } from '../core/events.js';

/**
 * 图片懒加载管理器类
 */
export class LazyImageManager {
    constructor() {
        this.observer = null;
        this.loadedImages = new WeakSet(); // 使用WeakSet避免内存泄漏
        this.loadingImages = new Set(); // 正在加载的图片
        this.imageStats = {
            total: 0,
            loaded: 0,
            failed: 0
        };
        this.init();
    }

    init() {
        // 创建交叉观察器
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                }
            });
        }, {
            // 提前加载视口外的图片，改善滚动体验
            rootMargin: '200px',
            // 只有图片10%可见时才开始加载
            threshold: 0.1
        });

        // 监听会话切换事件，清理旧图片
        eventBus.on('session:before-switch', () => {
            this.cleanup();
        });
    }

    /**
     * 观察图片元素
     * @param {HTMLImageElement} img - 图片元素
     */
    observe(img) {
        if (this.loadedImages.has(img)) return;

        this.imageStats.total++;
        this.observer.observe(img);

        // 添加占位符样式
        img.classList.add('lazy-image');

        // 添加加载指示器
        const wrapper = img.parentElement;
        if (wrapper && !wrapper.querySelector('.image-loader')) {
            const loader = document.createElement('div');
            loader.className = 'image-loader';
            loader.innerHTML = '<div class="spinner"></div>';
            wrapper.appendChild(loader);
        }
    }

    /**
     * 加载图片
     * @param {HTMLImageElement} img - 图片元素
     */
    loadImage(img) {
        const src = img.dataset.src;
        if (!src || this.loadedImages.has(img) || this.loadingImages.has(img)) return;

        this.loadingImages.add(img);
        img.classList.add('loading');

        // 创建临时图片对象进行预加载
        const tempImg = new Image();

        // 加载成功
        tempImg.onload = () => {
            // 淡入动画
            img.style.opacity = '0';
            img.src = src;

            requestAnimationFrame(() => {
                img.style.transition = 'opacity 0.3s ease';
                img.style.opacity = '1';

                img.classList.remove('loading');
                img.classList.add('loaded');

                // 移除加载指示器
                const loader = img.parentElement?.querySelector('.image-loader');
                if (loader) {
                    loader.remove();
                }

                this.loadedImages.add(img);
                this.loadingImages.delete(img);
                this.observer.unobserve(img);

                this.imageStats.loaded++;
                this.logStats();
            });
        };

        // 加载失败
        tempImg.onerror = () => {
            img.classList.remove('loading');
            img.classList.add('error');

            // 显示错误占位图
            img.src = 'data:image/svg+xml,%3Csvg width="400" height="300" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100%25" height="100%25" fill="%23fee" stroke="%23c00" stroke-width="2"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23c00"%3E图片加载失败%3C/text%3E%3C/svg%3E';

            // 移除加载指示器
            const loader = img.parentElement?.querySelector('.image-loader');
            if (loader) {
                loader.remove();
            }

            this.loadingImages.delete(img);
            this.imageStats.failed++;
            this.logStats();

            console.error('[LazyImage] 图片加载失败:', src);
        };

        // 开始加载
        tempImg.src = src;
    }

    /**
     * 清理所有观察
     */
    cleanup() {
        this.observer.disconnect();
        this.loadingImages.clear();
        this.imageStats = { total: 0, loaded: 0, failed: 0 };
        console.log('[LazyImage] 清理完成');
    }

    /**
     * 卸载所有图片（释放内存）
     */
    unloadAll() {
        document.querySelectorAll('img.lazy-image.loaded').forEach(img => {
            // 保存原始src
            img.dataset.src = img.src;
            // 恢复占位图
            img.src = 'data:image/svg+xml,%3Csvg width="400" height="300" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100%25" height="100%25" fill="%23f0f0f0"/%3E%3C/svg%3E';
            img.classList.remove('loaded');
            // 重新观察
            this.observe(img);
        });

        this.loadedImages = new WeakSet();
        console.log('[LazyImage] 卸载所有图片以释放内存');
    }

    /**
     * 打印统计信息
     */
    logStats() {
        const { total, loaded, failed } = this.imageStats;
        const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
        console.log(`[LazyImage] 统计 - 总数: ${total}, 已加载: ${loaded} (${percentage}%), 失败: ${failed}`);
    }

    /**
     * 预加载指定范围内的图片
     * @param {number} startIndex - 起始索引
     * @param {number} endIndex - 结束索引
     */
    preloadRange(startIndex, endIndex) {
        const images = document.querySelectorAll(`[data-message-index] img.lazy-image:not(.loaded)`);
        images.forEach(img => {
            const messageEl = img.closest('[data-message-index]');
            if (messageEl) {
                const index = parseInt(messageEl.dataset.messageIndex);
                if (index >= startIndex && index <= endIndex) {
                    this.loadImage(img);
                }
            }
        });
    }
}

// 创建全局实例
export const lazyImageManager = new LazyImageManager();

// 导出给虚拟滚动使用的预加载函数
export function preloadImagesInRange(start, end) {
    lazyImageManager.preloadRange(start, end);
}