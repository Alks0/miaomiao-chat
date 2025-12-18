/**
 * DOM 查询缓存工具
 * 减少重复的 querySelector 调用，提升性能
 *
 * 使用方法:
 * import { DOMCache } from './dom-cache.js';
 *
 * // 创建缓存实例
 * const cache = new DOMCache(containerElement);
 *
 * // 查询并缓存
 * const button = cache.query('.my-button'); // 第一次查询 DOM
 * const button2 = cache.query('.my-button'); // 从缓存获取
 *
 * // 失效缓存
 * cache.invalidate('.my-button');
 * cache.invalidateAll();
 */

/**
 * DOM 元素缓存类
 * 用于在特定容器内缓存 querySelector 结果
 */
export class DOMCache {
    /**
     * @param {HTMLElement} container - 容器元素（可选，默认为 document）
     */
    constructor(container = document) {
        this.container = container;
        this.cache = new Map();
    }

    /**
     * 查询元素（带缓存）
     * @param {string} selector - CSS 选择器
     * @returns {HTMLElement|null}
     */
    query(selector) {
        if (this.cache.has(selector)) {
            const cached = this.cache.get(selector);
            // 验证缓存的元素是否仍在 DOM 中
            if (cached && cached.isConnected) {
                return cached;
            }
            // 如果已失效，从缓存中移除
            this.cache.delete(selector);
        }

        // 执行实际查询
        const element = this.container.querySelector(selector);
        if (element) {
            this.cache.set(selector, element);
        }
        return element;
    }

    /**
     * 查询所有元素（带缓存）
     * @param {string} selector - CSS 选择器
     * @returns {NodeList}
     */
    queryAll(selector) {
        const cacheKey = `all:${selector}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            // 验证第一个元素是否仍在 DOM 中
            if (cached && cached.length > 0 && cached[0].isConnected) {
                return cached;
            }
            this.cache.delete(cacheKey);
        }

        const elements = this.container.querySelectorAll(selector);
        if (elements.length > 0) {
            this.cache.set(cacheKey, elements);
        }
        return elements;
    }

    /**
     * 失效单个缓存
     * @param {string} selector - CSS 选择器
     */
    invalidate(selector) {
        this.cache.delete(selector);
        this.cache.delete(`all:${selector}`);
    }

    /**
     * 失效所有缓存
     */
    invalidateAll() {
        this.cache.clear();
    }

    /**
     * 获取缓存大小
     */
    get size() {
        return this.cache.size;
    }
}

/**
 * 全局 DOM 缓存助手
 * 提供常用的缓存查询方法
 */
class GlobalDOMCacheHelper {
    constructor() {
        // 按容器分组的缓存
        this.caches = new Map();
    }

    /**
     * 获取或创建容器的缓存实例
     * @param {HTMLElement} container
     */
    getCache(container = document) {
        if (!this.caches.has(container)) {
            this.caches.set(container, new DOMCache(container));
        }
        return this.caches.get(container);
    }

    /**
     * 查询元素（全局）
     * @param {string} selector
     * @param {HTMLElement} container
     */
    query(selector, container = document) {
        return this.getCache(container).query(selector);
    }

    /**
     * 查询所有元素（全局）
     * @param {string} selector
     * @param {HTMLElement} container
     */
    queryAll(selector, container = document) {
        return this.getCache(container).queryAll(selector);
    }

    /**
     * 失效容器的所有缓存
     * @param {HTMLElement} container
     */
    invalidateContainer(container) {
        const cache = this.caches.get(container);
        if (cache) {
            cache.invalidateAll();
        }
    }

    /**
     * 清理所有缓存
     */
    clearAll() {
        this.caches.forEach(cache => cache.invalidateAll());
        this.caches.clear();
    }
}

// 导出全局实例
export const domCache = new GlobalDOMCacheHelper();

/**
 * 创建作用域缓存（用于函数内部）
 *
 * 使用场景：函数内部需要多次查询同一元素
 *
 * @example
 * function renderList() {
 *   const cache = createScopedCache();
 *
 *   items.forEach(item => {
 *     const container = cache.query('#list-container'); // 缓存
 *     container.appendChild(createItem(item));
 *   });
 *
 *   cache.cleanup(); // 函数结束时清理
 * }
 *
 * @param {HTMLElement} container - 容器元素
 * @returns {Object} { query, queryAll, cleanup }
 */
export function createScopedCache(container = document) {
    const cache = new Map();

    return {
        /**
         * 查询单个元素
         */
        query(selector) {
            if (cache.has(selector)) {
                return cache.get(selector);
            }
            const element = container.querySelector(selector);
            if (element) {
                cache.set(selector, element);
            }
            return element;
        },

        /**
         * 查询所有元素
         */
        queryAll(selector) {
            const key = `all:${selector}`;
            if (cache.has(key)) {
                return cache.get(key);
            }
            const elements = container.querySelectorAll(selector);
            if (elements.length > 0) {
                cache.set(key, elements);
            }
            return elements;
        },

        /**
         * 清理缓存
         */
        cleanup() {
            cache.clear();
        }
    };
}
