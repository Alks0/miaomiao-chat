/**
 * 事件监听器管理系统
 * 解决内存泄漏问题：自动追踪和清理事件监听器
 *
 * 使用方法:
 * 1. 创建管理器: const manager = new EventListenerManager();
 * 2. 添加监听器: manager.add(element, 'click', handler);
 * 3. 清理所有监听器: manager.cleanup();
 */

export class EventListenerManager {
    constructor() {
        this.listeners = [];
    }

    /**
     * 添加事件监听器（自动追踪）
     * @param {Element|Window|Document} element - 目标元素
     * @param {string} event - 事件名称
     * @param {Function} handler - 处理函数
     * @param {Object|Boolean} options - 事件选项
     * @returns {Function} 移除监听器的函数
     */
    add(element, event, handler, options = false) {
        if (!element || !event || !handler) {
            console.warn('[EventListenerManager] 无效的参数', { element, event, handler });
            return () => {};
        }

        element.addEventListener(event, handler, options);

        const listener = { element, event, handler, options };
        this.listeners.push(listener);

        // 返回移除函数（可选）
        return () => this.remove(element, event, handler);
    }

    /**
     * 移除单个事件监听器
     * @param {Element|Window|Document} element - 目标元素
     * @param {string} event - 事件名称
     * @param {Function} handler - 处理函数
     */
    remove(element, event, handler) {
        const index = this.listeners.findIndex(
            l => l.element === element && l.event === event && l.handler === handler
        );

        if (index !== -1) {
            const listener = this.listeners[index];
            listener.element.removeEventListener(listener.event, listener.handler, listener.options);
            this.listeners.splice(index, 1);
        }
    }

    /**
     * 清理所有事件监听器
     */
    cleanup() {
        this.listeners.forEach(({ element, event, handler, options }) => {
            try {
                element.removeEventListener(event, handler, options);
            } catch (error) {
                console.warn('[EventListenerManager] 清理监听器失败:', error);
            }
        });

        this.listeners = [];
    }

    /**
     * 获取当前监听器数量（调试用）
     */
    getCount() {
        return this.listeners.length;
    }

    /**
     * 获取监听器详情（调试用）
     */
    getDetails() {
        return this.listeners.map(l => ({
            element: l.element.tagName || l.element.constructor.name,
            event: l.event,
            handler: l.handler.name || 'anonymous'
        }));
    }
}

/**
 * 使用 AbortController 管理事件监听器（推荐方式）
 *
 * 使用方法:
 * const controller = createAbortController();
 * element.addEventListener('click', handler, { signal: controller.signal });
 * // 清理时: controller.abort();
 */
export function createAbortController() {
    return new AbortController();
}

/**
 * 为元素添加一次性事件监听器（自动清理）
 * @param {Element|Window|Document} element - 目标元素
 * @param {string} event - 事件名称
 * @param {Function} handler - 处理函数
 */
export function addOnceListener(element, event, handler) {
    element.addEventListener(event, handler, { once: true });
}

/**
 * 创建带自动清理的事件监听器组
 * 用于临时组件/模态框等场景
 *
 * @example
 * const cleanup = createListenerGroup(modal, [
 *   ['click', handleClick, '.close-btn'],
 *   ['submit', handleSubmit, 'form']
 * ]);
 * // 清理时: cleanup();
 *
 * @param {Element} container - 容器元素
 * @param {Array} listeners - 监听器配置数组 [[event, handler, selector?], ...]
 * @returns {Function} 清理函数
 */
export function createListenerGroup(container, listeners) {
    const abortController = new AbortController();
    const { signal } = abortController;

    listeners.forEach(([event, handler, selector]) => {
        if (selector) {
            // 委托事件
            const delegateHandler = (e) => {
                const target = e.target.closest(selector);
                if (target) {
                    handler.call(target, e);
                }
            };
            container.addEventListener(event, delegateHandler, { signal });
        } else {
            // 直接事件
            container.addEventListener(event, handler, { signal });
        }
    });

    return () => abortController.abort();
}

/**
 * 全局事件监听器管理器（单例）
 * 用于追踪全局/长期存在的监听器
 */
export const globalListenerManager = new EventListenerManager();
