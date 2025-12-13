/**
 * 流式渲染辅助函数
 * 处理流式消息的实时更新和最终渲染
 */

import { state, elements } from '../core/state.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { escapeHtml } from '../utils/helpers.js';
import { renderThinkingBlock, enhanceCodeBlocks } from '../messages/renderer.js';

// ✅ 性能优化：防抖渲染（避免每个 token 都触发重绘）
let renderDebounceTimer = null;
let pendingRenderData = null;
let rafId = null;

/**
 * 滚动到底部
 */
function scrollToBottom() {
    elements.messagesArea.scrollTo({
        top: elements.messagesArea.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * 实际的渲染函数
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 */
function doRender(textContent, thinkingContent) {
    if (!state.currentAssistantMessage) return;

    let html = '';

    // 渲染思维链（流式中显示）
    if (thinkingContent) {
        html += renderThinkingBlock(thinkingContent, true);
    }

    // 渲染文本内容
    if (textContent) {
        html += safeMarkedParse(textContent);
    }

    // 添加打字光标
    html += '<span class="typing-cursor"></span>';

    state.currentAssistantMessage.innerHTML = html;
    scrollToBottom();
}

/**
 * 实时更新流式消息内容
 * ✅ 性能优化：使用 requestAnimationFrame + 防抖，避免过度渲染
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 */
export function updateStreamingMessage(textContent, thinkingContent) {
    // 保存最新的渲染数据
    pendingRenderData = { textContent, thinkingContent };

    // 取消之前的防抖定时器
    if (renderDebounceTimer) {
        clearTimeout(renderDebounceTimer);
    }

    // 取消之前的 RAF
    if (rafId) {
        cancelAnimationFrame(rafId);
    }

    // ✅ 使用 requestAnimationFrame 在下一帧渲染（60fps 限制）
    rafId = requestAnimationFrame(() => {
        if (pendingRenderData) {
            doRender(pendingRenderData.textContent, pendingRenderData.thinkingContent);
            pendingRenderData = null;
        }
        rafId = null;
    });
}

/**
 * 渲染最终的文本和思维链内容
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 * @param {Object} groundingMetadata - 搜索结果元数据（可选）
 */
export function renderFinalTextWithThinking(textContent, thinkingContent, groundingMetadata = null) {
    if (!state.currentAssistantMessage) return;

    let html = '';

    if (thinkingContent) {
        html += renderThinkingBlock(thinkingContent, false);
    }

    if (textContent) {
        html += safeMarkedParse(textContent);
    }

    if (groundingMetadata) {
        html += renderSearchGrounding(groundingMetadata);
    }

    state.currentAssistantMessage.innerHTML = html;
    enhanceCodeBlocks();
    scrollToBottom();
}

/**
 * 渲染包含图片的最终内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} thinkingContent - 思维链内容
 * @param {Object} groundingMetadata - 搜索结果元数据（可选）
 */
export function renderFinalContentWithThinking(contentParts, thinkingContent, groundingMetadata = null) {
    if (!state.currentAssistantMessage) return;

    let html = '';

    // ✅ 检查 contentParts 中是否有 thinking 类型
    const hasInlineThinking = contentParts.some(p => p.type === 'thinking');

    if (hasInlineThinking) {
        // ✅ 新模式：按 contentParts 顺序渲染（thinking 内联）
        for (const part of contentParts) {
            if (part.type === 'thinking') {
                html += renderThinkingBlock(part.text, false);
            } else if (part.type === 'text') {
                html += safeMarkedParse(part.text);
            } else if (part.type === 'image_url' && part.complete) {
                const match = part.url.match(/^data:image\/(\w+);/);
                const ext = match ? match[1] : 'png';
                html += `<div class="image-wrapper">
                    <img src="${part.url}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${part.url}')" style="cursor:pointer;">
                    <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${part.url}', 'image-${Date.now()}.${ext}')" title="下载原图">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                    </button>
                </div>`;
            }
        }
    } else {
        // ✅ 旧模式（向后兼容）：thinking 在顶部，然后是 contentParts
        if (thinkingContent) {
            html += renderThinkingBlock(thinkingContent, false);
        }

        for (const part of contentParts) {
            if (part.type === 'text') {
                html += safeMarkedParse(part.text);
            } else if (part.type === 'image_url' && part.complete) {
                const match = part.url.match(/^data:image\/(\w+);/);
                const ext = match ? match[1] : 'png';
                html += `<div class="image-wrapper">
                    <img src="${part.url}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${part.url}')" style="cursor:pointer;">
                    <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${part.url}', 'image-${Date.now()}.${ext}')" title="下载原图">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                    </button>
                </div>`;
            }
        }
    }

    if (groundingMetadata) {
        html += renderSearchGrounding(groundingMetadata);
    }

    state.currentAssistantMessage.innerHTML = html;
    enhanceCodeBlocks();
    scrollToBottom();
}

/**
 * 渲染搜索引用信息
 * @param {Object} groundingMetadata - 搜索结果元数据
 * @returns {string} 引用 HTML
 */
function renderSearchGrounding(groundingMetadata) {
    if (!groundingMetadata?.groundingChunks && !groundingMetadata?.webSearchQueries) return '';

    const chunks = groundingMetadata.groundingChunks || [];
    const sources = chunks
        .filter(chunk => chunk.web)
        .map(chunk => `
            <a href="${chunk.web.uri}" target="_blank" rel="noopener" class="search-source">
                ${escapeHtml(chunk.web.title || new URL(chunk.web.uri).hostname)}
            </a>
        `);

    if (sources.length === 0) return '';

    return `
        <div class="search-sources">
            <span class="sources-label">🔍 来源:</span>
            ${sources.join('')}
        </div>
    `;
}

/**
 * 清理所有未完成的图片（流结束时调用）
 * @param {Array} contentParts - 内容部分数组
 */
export function cleanupAllIncompleteImages(contentParts) {
    // TODO: 实现图片缓冲区清理逻辑
    // 由于图片分块处理比较复杂，暂时简化实现
    if (state.imageBuffers) {
        state.imageBuffers.clear();
    }
}

/**
 * 处理 content 数组（文本 + 图片）
 * @param {Array} deltaContentArray - delta 内容数组
 * @param {Array} contentParts - 内容部分数组
 * @returns {number} 添加的字符数（用于长度限制检查）
 */
export async function handleContentArray(deltaContentArray, contentParts) {
    // TODO: 实现完整的图片分块处理逻辑
    // 暂时简化：只处理文本和完整图片
    let addedLength = 0; // ✅ 追踪添加的字符数

    for (const part of deltaContentArray) {
        if (part.type === 'text') {
            // 查找或创建文本部分
            let lastTextPart = contentParts.find(p => p.type === 'text' && !p.complete);
            if (!lastTextPart) {
                lastTextPart = { type: 'text', text: '' };
                contentParts.push(lastTextPart);
            }
            lastTextPart.text += part.text;
            addedLength += part.text.length; // ✅ 计数文本长度
        }
        else if (part.type === 'image_url') {
            const imageUrl = part.image_url?.url;
            if (imageUrl && !part.image_url?.partial) {
                // 只处理完整图片，分块图片暂时跳过
                contentParts.push({ type: 'image_url', url: imageUrl, complete: true });

                // ✅ 修复：计数 base64 数据长度（防止超长）
                // 如果是 data URL，提取 base64 部分的长度
                const base64Match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
                if (base64Match) {
                    addedLength += base64Match[1].length;
                }
            }
        }
    }

    return addedLength;
}
