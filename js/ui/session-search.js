/**
 * 会话搜索模块
 * 支持全局搜索所有会话的消息内容（OpenAI/Gemini/Claude 三种格式）
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { escapeHtml } from '../utils/helpers.js';

// 搜索状态
let searchDebounceTimer = null;
let currentQuery = '';

/**
 * 初始化会话搜索
 */
export function initSessionSearch() {
    bindSearchEvents();
    console.log('Session Search initialized');
}

/**
 * 绑定搜索事件
 */
function bindSearchEvents() {
    // 输入事件（防抖 300ms）
    elements.sessionSearchInput?.addEventListener('input', (e) => {
        const query = e.target.value;
        currentQuery = query;

        // 显示/隐藏清除按钮
        if (elements.sessionSearchClear) {
            elements.sessionSearchClear.style.display = query ? 'block' : 'none';
        }

        // 防抖搜索
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            performSearch(query);
        }, 300);
    });

    // 清除按钮
    elements.sessionSearchClear?.addEventListener('click', clearSearch);

    // ESC 快捷键清除搜索
    elements.sessionSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            clearSearch();
        }
    });

    // 监听会话列表更新，如果有搜索则重新过滤
    eventBus.on('sessions:updated', () => {
        if (currentQuery) {
            performSearch(currentQuery);
        }
    });
}

/**
 * 清除搜索
 */
function clearSearch() {
    if (elements.sessionSearchInput) {
        elements.sessionSearchInput.value = '';
    }
    if (elements.sessionSearchClear) {
        elements.sessionSearchClear.style.display = 'none';
    }
    currentQuery = '';
    performSearch('');
}

/**
 * 执行搜索
 * @param {string} query - 搜索关键词
 */
function performSearch(query) {
    const searchResults = searchSessions(query);

    // 显示/隐藏搜索提示
    if (query && searchResults.length < state.sessions.length) {
        showSearchHint(searchResults.length, state.sessions.length);
    } else {
        hideSearchHint();
    }

    // 触发会话列表更新事件，携带搜索结果
    eventBus.emit('sessions:search-filter', {
        searchResults,
        query
    });
}

/**
 * 搜索所有会话
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的会话数组（增强版，包含匹配消息信息）
 */
export function searchSessions(query) {
    if (!query || query.trim() === '') {
        return state.sessions.map(s => ({ session: s, matchedMessages: [] }));
    }

    const lowerQuery = query.toLowerCase().trim();
    const results = [];

    for (const session of state.sessions) {
        let matchCount = 0;
        let matchedInName = false;
        const matchedMessages = []; // 存储匹配的消息信息

        // 1. 搜索会话名称
        if (session.name.toLowerCase().includes(lowerQuery)) {
            matchCount += 10; // 名称匹配权重更高
            matchedInName = true;
        }

        // 2. 搜索所有消息内容
        const messagesToSearch = session.messages || [];
        const geminiToSearch = session.geminiContents || [];
        const claudeToSearch = session.claudeContents || [];

        // 根据会话的 apiFormat 选择对应的消息数组
        let messagesArray = [];
        switch (session.apiFormat) {
            case 'gemini':
                messagesArray = geminiToSearch;
                break;
            case 'claude':
                messagesArray = claudeToSearch;
                break;
            default: // 'openai'
                messagesArray = messagesToSearch;
        }

        // 遍历消息，找出所有匹配的
        messagesArray.forEach((msg, index) => {
            const text = extractMessageText(msg, session.apiFormat);
            const lowerText = text.toLowerCase();

            if (lowerText.includes(lowerQuery)) {
                matchCount++;

                // 提取匹配的上下文（前后各50个字符）
                const matchIndex = lowerText.indexOf(lowerQuery);
                const contextStart = Math.max(0, matchIndex - 50);
                const contextEnd = Math.min(text.length, matchIndex + lowerQuery.length + 50);
                let preview = text.slice(contextStart, contextEnd);

                // 添加省略号
                if (contextStart > 0) preview = '...' + preview;
                if (contextEnd < text.length) preview = preview + '...';

                // 获取消息角色
                let role = 'unknown';
                if (session.apiFormat === 'openai' || session.apiFormat === 'openai-responses') {
                    role = msg.role || 'unknown';
                } else if (session.apiFormat === 'gemini') {
                    role = msg.role || 'unknown';
                } else if (session.apiFormat === 'claude') {
                    role = msg.role || 'unknown';
                }

                matchedMessages.push({
                    index,           // 消息索引
                    messageId: msg.id || `msg_${index}`, // 消息ID
                    role,            // 角色
                    preview,         // 预览文本
                    fullText: text   // 完整文本（用于后续高亮）
                });
            }
        });

        if (matchCount > 0) {
            results.push({
                session,
                matchCount,
                matchedInName,
                matchedMessages: matchedMessages.slice(0, 3) // 只保留前3条匹配消息
            });
        }
    }

    // 按相关性排序：名称匹配 > 匹配次数
    results.sort((a, b) => {
        if (a.matchedInName && !b.matchedInName) return -1;
        if (!a.matchedInName && b.matchedInName) return 1;
        return b.matchCount - a.matchCount;
    });

    return results;
}

/**
 * 提取消息文本（支持三种格式）
 * @param {Object} message - 消息对象
 * @param {string} format - 'openai' | 'gemini' | 'claude'
 * @returns {string} 提取的文本
 */
function extractMessageText(message, format) {
    if (!message) return '';

    switch (format) {
        case 'openai':
        case 'openai-responses':  // Responses API 消息格式与 OpenAI 相同
            // OpenAI 格式：content 可以是字符串或数组
            if (typeof message.content === 'string') {
                return message.content;
            }
            if (Array.isArray(message.content)) {
                return message.content
                    .filter(part => part.type === 'text')
                    .map(part => part.text)
                    .join(' ');
            }
            return '';

        case 'gemini':
            // Gemini 格式：parts 数组中的 text 字段
            if (Array.isArray(message.parts)) {
                return message.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join(' ');
            }
            return '';

        case 'claude':
            // Claude 格式：content 数组中 type=text 的项
            if (typeof message.content === 'string') {
                return message.content;
            }
            if (Array.isArray(message.content)) {
                return message.content
                    .filter(part => part.type === 'text')
                    .map(part => part.text)
                    .join(' ');
            }
            return '';

        default:
            return '';
    }
}

/**
 * 高亮匹配文本（安全的HTML高亮）
 * @param {string} text - 原始文本
 * @param {string} query - 搜索关键词
 * @returns {string} 高亮后的 HTML
 */
export function highlightMatch(text, query) {
    if (!query || !text) return escapeHtml(text);

    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 转义正则特殊字符

    // 使用正则替换（不区分大小写）
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return escapedText.replace(regex, '<mark>$1</mark>');
}

/**
 * 显示搜索提示
 * @param {number} resultCount - 搜索结果数量
 * @param {number} totalCount - 总会话数量
 */
function showSearchHint(resultCount, totalCount) {
    let hint = document.getElementById('session-search-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'session-search-hint';
        hint.className = 'session-search-hint';
        // 插入到搜索框后面
        const searchBar = elements.sessionSearchInput?.parentElement;
        if (searchBar) {
            searchBar.after(hint);
        }
    }
    hint.textContent = `找到 ${resultCount} / ${totalCount} 个会话`;
    hint.style.display = 'block';
}

/**
 * 隐藏搜索提示
 */
function hideSearchHint() {
    const hint = document.getElementById('session-search-hint');
    if (hint) {
        hint.style.display = 'none';
    }
}

/**
 * 获取当前搜索关键词（用于高亮显示）
 * @returns {string} 当前搜索关键词
 */
export function getCurrentQuery() {
    return currentQuery;
}
