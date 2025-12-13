/**
 * DOM 同步模块
 * 封装消息索引设置逻辑,避免代码重复
 */

import { state } from '../core/state.js';

/**
 * 统一的消息索引设置函数
 * @param {HTMLElement} messageEl - 消息元素
 * @param {number} messageIndex - 消息索引
 * @returns {boolean} 是否设置成功
 */
export function setMessageIndex(messageEl, messageIndex) {
    if (!messageEl || messageIndex === undefined || messageIndex === null) {
        console.warn('[setMessageIndex] 无效参数', { messageEl, messageIndex });
        return false;
    }

    messageEl.dataset.messageIndex = messageIndex;
    return true;
}

/**
 * 从 state.currentAssistantMessage 获取消息元素并设置索引
 * @param {number} messageIndex - 消息索引
 * @returns {boolean} 是否设置成功
 */
export function setCurrentMessageIndex(messageIndex) {
    if (!state.currentAssistantMessage) {
        console.warn('[setCurrentMessageIndex] state.currentAssistantMessage 为 null');
        return false;
    }

    const messageEl = state.currentAssistantMessage.closest('.message');
    return setMessageIndex(messageEl, messageIndex);
}
