/**
 * 内存管理器
 * 监控和管理图片内存占用，防止内存泄漏
 */

import { eventBus } from '../core/events.js';
import { lazyImageManager } from './lazy-image.js';

class MemoryManager {
    constructor() {
        // 配置
        this.config = {
            memoryCheckInterval: 30000, // 30秒检查一次
            memoryThreshold: 300 * 1024 * 1024, // 300MB阈值
            unloadThreshold: 200 * 1024 * 1024, // 200MB开始卸载
            performanceObserverSupported: 'memory' in performance
        };

        // 状态
        this.checkTimer = null;
        this.lastMemoryUsage = 0;
        this.imageCount = 0;

        this.init();
    }

    init() {
        // 启动定期内存检查
        this.startMemoryMonitoring();

        // 监听相关事件
        eventBus.on('session:before-switch', () => {
            this.cleanupBeforeSwitch();
        });

        // 页面卸载时清理
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // 监听内存压力事件（如果浏览器支持）
        if ('memory' in navigator && navigator.memory) {
            this.setupMemoryPressureListener();
        }
    }

    /**
     * 开始内存监控
     */
    startMemoryMonitoring() {
        if (this.checkTimer) return;

        // 立即执行一次检查
        this.checkMemory();

        // 定期检查
        this.checkTimer = setInterval(() => {
            this.checkMemory();
        }, this.config.memoryCheckInterval);
    }

    /**
     * 停止内存监控
     */
    stopMemoryMonitoring() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }

    /**
     * 检查内存使用情况
     */
    async checkMemory() {
        if (!this.config.performanceObserverSupported) return;

        try {
            // 获取内存信息
            const memory = performance.memory;
            const usedJSHeapSize = memory.usedJSHeapSize;
            const totalJSHeapSize = memory.totalJSHeapSize;
            const jsHeapSizeLimit = memory.jsHeapSizeLimit;

            // 计算使用率
            const memoryUsagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;

            // 统计图片
            const loadedImages = document.querySelectorAll('img.lazy-image.loaded').length;
            const totalImages = document.querySelectorAll('img.lazy-image').length;

            console.log(`[MemoryManager] 内存使用: ${this.formatBytes(usedJSHeapSize)}/${this.formatBytes(jsHeapSizeLimit)} (${memoryUsagePercent.toFixed(1)}%) | 图片: ${loadedImages}/${totalImages} 已加载`);

            // 如果内存使用超过阈值
            if (usedJSHeapSize > this.config.memoryThreshold) {
                console.warn('[MemoryManager] 内存使用过高，开始清理...');
                await this.performMemoryCleanup();
            }

            this.lastMemoryUsage = usedJSHeapSize;
            this.imageCount = loadedImages;
        } catch (error) {
            console.error('[MemoryManager] 检查内存失败:', error);
        }
    }

    /**
     * 执行内存清理
     */
    async performMemoryCleanup() {
        console.log('[MemoryManager] 开始内存清理...');

        // 1. 强制垃圾回收（如果可用）
        if (window.gc) {
            window.gc();
        }

        // 2. 卸载不可见的图片
        const visibleRect = {
            top: window.scrollY - 500,
            bottom: window.scrollY + window.innerHeight + 500
        };

        const images = document.querySelectorAll('img.lazy-image.loaded');
        let unloadedCount = 0;

        images.forEach(img => {
            const rect = img.getBoundingClientRect();
            const absoluteTop = rect.top + window.scrollY;

            // 如果图片不在可见范围内
            if (absoluteTop < visibleRect.top || absoluteTop > visibleRect.bottom) {
                // 卸载图片
                this.unloadImage(img);
                unloadedCount++;
            }
        });

        // 3. 清理已删除消息的引用
        this.cleanupOrphanedReferences();

        console.log(`[MemoryManager] 清理完成，卸载了 ${unloadedCount} 张图片`);

        // 4. 通知用户
        if (unloadedCount > 0) {
            eventBus.emit('ui:notification', {
                message: `已释放 ${unloadedCount} 张图片内存`,
                type: 'info',
                duration: 3000
            });
        }
    }

    /**
     * 卸载单个图片
     */
    unloadImage(img) {
        if (!img.classList.contains('loaded')) return;

        // 保存原始 src
        img.dataset.src = img.src;

        // 恢复占位图
        img.src = 'data:image/svg+xml,%3Csvg width="400" height="300" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100%25" height="100%25" fill="%23f5f5f5"/%3E%3C/svg%3E';

        // 更新类名
        img.classList.remove('loaded', 'observed');
        img.classList.add('unloaded');

        // 重新观察（当再次进入视口时会重新加载）
        lazyImageManager.observe(img);
    }

    /**
     * 清理孤立引用
     */
    cleanupOrphanedReferences() {
        // 清理已删除的图片元素引用
        if (lazyImageManager.loadedImages) {
            // WeakSet 会自动清理
        }
    }

    /**
     * 会话切换前的清理
     */
    cleanupBeforeSwitch() {
        console.log('[MemoryManager] 会话切换，执行清理...');

        // 卸载所有图片
        const images = document.querySelectorAll('img.lazy-image.loaded');
        images.forEach(img => {
            this.unloadImage(img);
        });

        // 清理懒加载管理器
        lazyImageManager.cleanup();
    }

    /**
     * 设置内存压力监听器
     */
    setupMemoryPressureListener() {
        // Chrome 实验性 API
        if ('addEventListener' in navigator.memory) {
            navigator.memory.addEventListener('pressure', (event) => {
                console.warn('[MemoryManager] 收到内存压力事件:', event);
                this.performMemoryCleanup();
            });
        }
    }

    /**
     * 格式化字节数
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 获取内存统计信息
     */
    getMemoryStats() {
        if (!this.config.performanceObserverSupported) {
            return { supported: false };
        }

        const memory = performance.memory;
        return {
            supported: true,
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize,
            limit: memory.jsHeapSizeLimit,
            usagePercent: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
            imageCount: this.imageCount,
            lastCheck: new Date().toISOString()
        };
    }

    /**
     * 清理
     */
    cleanup() {
        this.stopMemoryMonitoring();
    }
}

// 创建全局实例
export const memoryManager = new MemoryManager();

// 导出工具函数
export function checkMemoryUsage() {
    return memoryManager.getMemoryStats();
}