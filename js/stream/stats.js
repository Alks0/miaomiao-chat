/**
 * 流统计模块
 * 记录流式生成的性能指标（TTFT、TPS 等）
 */

import { state } from '../core/state.js';

/**
 * 估算 token 数（与 recordTokens 使用相同的粗略规则）
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherText = text.replace(/[\u4e00-\u9fff]/g, ' ');
    const words = otherText.split(/\s+/).filter(w => w.length > 0).length;
    return chineseChars + words;
}

/**
 * 重置流统计
 */
export function resetStreamStats() {
    state.streamStats = {
        requestStartTime: Date.now(),
        firstTokenTime: 0,
        endTime: 0,
        tokenCount: 0,
        isFirstToken: true
    };
}

/**
 * 记录首个 token 到达时间
 */
export function recordFirstToken() {
    if (state.streamStats.isFirstToken) {
        state.streamStats.firstTokenTime = Date.now();
        state.streamStats.isFirstToken = false;
    }
}

/**
 * 记录 token 数量（估算）
 * @param {string} text - 文本内容
 */
export function recordTokens(text) {
    // 简单估算：按空格和标点分词，中文按字符计数
    if (!text) return;
    state.streamStats.tokenCount += estimateTokenCount(text);
}

/**
 * 在流结束时根据最终内容重算 token 数，避免因解析分支漏记导致 token 统计停在工具调用前
 * @param {Object} params
 * @param {string} params.textContent
 * @param {string} params.thinkingContent
 * @param {Array} params.contentParts
 * @returns {number} 重算后的 token 数
 */
export function recalculateStreamTokenCount({ textContent = '', thinkingContent = '', contentParts = [] } = {}) {
    const TOOL_PLACEHOLDER = '(调用工具)';

    // 优先用文本变量（避免与 contentParts 里的 thinking/text 重复）
    let combinedText = [thinkingContent, textContent]
        .filter(Boolean)
        .join('\n');

    if (combinedText === TOOL_PLACEHOLDER) {
        combinedText = '';
    }

    // 回退：如果变量为空但 contentParts 有内容，从 contentParts 提取文本
    if (!combinedText && Array.isArray(contentParts) && contentParts.length > 0) {
        combinedText = contentParts
            .filter(p => (p?.type === 'text' || p?.type === 'thinking') && typeof p.text === 'string' && p.text && p.text !== TOOL_PLACEHOLDER)
            .map(p => p.text)
            .join('\n');
    }

    state.streamStats.tokenCount = estimateTokenCount(combinedText);
    return state.streamStats.tokenCount;
}

/**
 * 结束流统计
 */
export function finalizeStreamStats() {
    state.streamStats.endTime = Date.now();
}

/**
 * 获取当前流统计数据（用于保存）
 * @returns {Object|null} 统计数据
 */
export function getCurrentStreamStatsData() {
    const stats = state.streamStats;
    if (!stats.requestStartTime) return null;

    const ttft = stats.firstTokenTime ? ((stats.firstTokenTime - stats.requestStartTime) / 1000).toFixed(2) : '-';
    const totalTime = stats.endTime ? ((stats.endTime - stats.requestStartTime) / 1000).toFixed(2) : '-';
    const tokens = stats.tokenCount || 0;
    const tps = (stats.endTime && stats.firstTokenTime && stats.endTime > stats.firstTokenTime)
        ? (tokens / ((stats.endTime - stats.firstTokenTime) / 1000)).toFixed(1)
        : '-';

    return { ttft, totalTime, tokens, tps };
}

/**
 * 获取部分流统计数据（用于工具调用时保存，不结束统计）
 * 与 getCurrentStreamStatsData 的区别：不需要 endTime，返回当前进行中的统计
 * @returns {Object|null} 部分统计数据
 */
export function getPartialStreamStatsData() {
    const stats = state.streamStats;
    if (!stats.requestStartTime) return null;

    const ttft = stats.firstTokenTime ? ((stats.firstTokenTime - stats.requestStartTime) / 1000).toFixed(2) : '-';
    const tokens = stats.tokenCount || 0;

    // 部分统计：totalTime 和 tps 暂时为 '-'，等待 continuation 完成后更新
    return {
        ttft,
        totalTime: '-',  // 工具调用进行中，总时间待定
        tokens,
        tps: '-',        // 工具调用进行中，TPS 待定
        isPartial: true  // 标记为部分统计，供 continuation 聚合时识别
    };
}

/**
 * 从保存的数据生成统计 HTML
 * @param {Object} statsData - 统计数据
 * @returns {string} 统计 HTML
 */
export function renderStreamStatsFromData(statsData) {
    if (!statsData) return '';

    const { ttft, totalTime, tokens, tps } = statsData;

    return `<div class="stream-stats">
        <span title="首字时间 (TTFT)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            ${ttft}s
        </span>
        <span title="总耗时">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
            </svg>
            ${totalTime}s
        </span>
        <span title="输出 tokens">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            ${tokens}
        </span>
        <span title="生成速度 (tokens/s)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            ${tps} t/s
        </span>
    </div>`;
}

/**
 * 获取当前流统计 HTML
 * @returns {string} 统计 HTML
 */
export function getStreamStatsHTML() {
    const stats = state.streamStats;
    if (!stats.requestStartTime) return '';

    const ttft = stats.firstTokenTime ? ((stats.firstTokenTime - stats.requestStartTime) / 1000).toFixed(2) : '-';
    const totalTime = stats.endTime ? ((stats.endTime - stats.requestStartTime) / 1000).toFixed(2) : '-';
    const tokens = stats.tokenCount || 0;
    const tps = (stats.endTime && stats.firstTokenTime && stats.endTime > stats.firstTokenTime)
        ? (tokens / ((stats.endTime - stats.firstTokenTime) / 1000)).toFixed(1)
        : '-';

    return `<div class="stream-stats">
        <span title="首字时间 (TTFT)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            ${ttft}s
        </span>
        <span title="总耗时">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
            </svg>
            ${totalTime}s
        </span>
        <span title="输出 tokens">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            ${tokens}
        </span>
        <span title="生成速度 (tokens/s)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            ${tps} t/s
        </span>
    </div>`;
}

/**
 * 将统计信息追加到消息末尾
 * 支持多种获取消息容器的方式，防止 state.currentAssistantMessage 被清空时失败
 */
export function appendStreamStats() {
    const statsHTML = getStreamStatsHTML();
    if (!statsHTML) return;

    // 尝试多种方式获取消息容器
    let wrapper = null;

    // 方式1：使用 state.currentAssistantMessage
    if (state.currentAssistantMessage) {
        wrapper = state.currentAssistantMessage.closest('.message-content-wrapper');
    }

    // 方式2：如果方式1失败，找到 DOM 中最后一条助手消息
    if (!wrapper) {
        const allAssistantMsgs = document.querySelectorAll('.message.assistant');
        if (allAssistantMsgs.length > 0) {
            const lastAssistantMsg = allAssistantMsgs[allAssistantMsgs.length - 1];
            wrapper = lastAssistantMsg.querySelector('.message-content-wrapper');
        }
    }

    if (wrapper) {
        // 移除旧的统计（如果有）
        const oldStats = wrapper.querySelector('.stream-stats');
        if (oldStats) oldStats.remove();
        wrapper.insertAdjacentHTML('beforeend', statsHTML);
    }
}
