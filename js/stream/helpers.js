/**
 * 流式渲染辅助函数
 * 处理流式消息的实时更新和最终渲染
 */

import { state, elements } from '../core/state.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { escapeHtml } from '../utils/helpers.js';
import { renderThinkingBlock, enhanceCodeBlocks, enhanceThinkingBlocks } from '../messages/renderer.js';
import { getMediaExtension, isVideoUrl } from '../utils/media.js';

// 性能优化：防抖渲染（避免每个 token 都触发重绘）
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
 * 清理残留的流式状态
 * 确保流结束后移除所有流式相关的 class 和元素
 * @param {HTMLElement} container - 消息容器
 */
function cleanupStreamingState(container) {
    if (!container) return;

    // 移除所有 .streaming class（思维链流式动画）
    const streamingBlocks = container.querySelectorAll('.thinking-block.streaming');
    streamingBlocks.forEach(block => {
        block.classList.remove('streaming');
    });

    // 移除所有打字光标
    const typingCursors = container.querySelectorAll('.typing-cursor');
    typingCursors.forEach(cursor => {
        cursor.remove();
    });

    // 移除残留的 continuation-loading
    const continuationLoading = container.querySelectorAll('.continuation-loading');
    continuationLoading.forEach(loading => {
        loading.remove();
    });

    // 移除残留的 continuation-content 容器
    const continuationContent = container.querySelectorAll('.continuation-content');
    continuationContent.forEach(content => {
        content.remove();
    });

    // 清除 continuation 标记
    delete container.dataset.isContinuation;
}

/**
 * 实际的渲染函数
 * @param {string} textContent - 文本内容
 * @param {string} thinkingContent - 思维链内容
 */
function doRender(textContent, thinkingContent) {
    if (!state.currentAssistantMessage) return;

    // 检测是否是 continuation 模式（有工具调用 UI 或持久标记）
    const hasToolCallUI = state.currentAssistantMessage.querySelector('.tool-calls-group');
    const hasContinuationLoading = state.currentAssistantMessage.querySelector('.continuation-loading');
    const isContinuation = state.currentAssistantMessage.dataset.isContinuation === 'true';

    if (hasToolCallUI || hasContinuationLoading || isContinuation) {
        // Continuation 模式：只更新 continuation 部分
        console.log('[doRender] Continuation 流式模式：更新追加内容');

        // 移除之前的 continuation-content（如果存在）
        const oldContinuation = state.currentAssistantMessage.querySelector('.continuation-content');
        if (oldContinuation) {
            oldContinuation.remove();
        }

        // 移除 continuation-loading 提示
        if (hasContinuationLoading) {
            hasContinuationLoading.remove();
        }

        // 创建 continuation 容器
        const continuationDiv = document.createElement('div');
        continuationDiv.className = 'continuation-content';

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

        continuationDiv.innerHTML = html;
        state.currentAssistantMessage.appendChild(continuationDiv);

        // 重新绑定思维链事件监听器
        if (thinkingContent) {
            enhanceThinkingBlocks(state.currentAssistantMessage.parentElement);
        }

        // 增强代码块（流式渲染时折叠）
        enhanceCodeBlocks(continuationDiv);
    } else {
        // 正常模式：优先增量更新，避免 DOM 重建
        const existingThinkingBlock = state.currentAssistantMessage.querySelector('.thinking-block');

        // 🔧 增量更新思考链（避免滚动重置）
        if (existingThinkingBlock && thinkingContent) {
            const thinkingContentEl = existingThinkingBlock.querySelector('.thinking-content');

            if (thinkingContentEl) {
                // 保存当前滚动位置
                const currentScrollTop = thinkingContentEl.scrollTop;
                const isScrolledToBottom = thinkingContentEl.scrollHeight - thinkingContentEl.scrollTop <= thinkingContentEl.clientHeight + 10;

                // 只更新内容，不重建 DOM
                thinkingContentEl.innerHTML = safeMarkedParse(thinkingContent);

                // 恢复滚动位置（如果用户在查看，保持位置；如果在底部，跟随新内容）
                if (isScrolledToBottom) {
                    thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                } else {
                    thinkingContentEl.scrollTop = currentScrollTop;
                }
            }

            // 更新文本内容部分（移除旧的文本和光标）
            const nodes = Array.from(state.currentAssistantMessage.childNodes);
            nodes.forEach(node => {
                if (node !== existingThinkingBlock) {
                    node.remove();
                }
            });

            // 添加新的文本内容
            if (textContent) {
                const textDiv = document.createElement('div');
                textDiv.innerHTML = safeMarkedParse(textContent);
                state.currentAssistantMessage.appendChild(textDiv);
            }

            // 添加打字光标
            const cursor = document.createElement('span');
            cursor.className = 'typing-cursor';
            state.currentAssistantMessage.appendChild(cursor);

            // 增强代码块（流式渲染时折叠）
            enhanceCodeBlocks(state.currentAssistantMessage);
        } else {
            // 首次渲染或无思考链：使用完整渲染
            // 保存思维链展开状态和滚动位置
            const expandedStates = [];
            const scrollPositions = [];
            if (thinkingContent) {
                const existingBlocks = state.currentAssistantMessage.querySelectorAll('.thinking-block');
                existingBlocks.forEach((block, index) => {
                    expandedStates[index] = !block.classList.contains('collapsed');
                    const content = block.querySelector('.thinking-content');
                    scrollPositions[index] = content ? content.scrollTop : 0;
                });
            }

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

            // 重新绑定思维链事件监听器（innerHTML 会销毁原有监听器）
            if (thinkingContent) {
                enhanceThinkingBlocks(state.currentAssistantMessage.parentElement);

                // 恢复展开状态和滚动位置
                const newBlocks = state.currentAssistantMessage.querySelectorAll('.thinking-block');
                newBlocks.forEach((block, index) => {
                    if (expandedStates[index]) {
                        block.classList.remove('collapsed');
                        const header = block.querySelector('.thinking-header');
                        if (header) {
                            header.setAttribute('aria-expanded', 'true');
                            const icon = header.querySelector('.thinking-toggle-icon');
                            if (icon) {
                                icon.textContent = '▼';
                            }
                        }

                        // 恢复滚动位置
                        const content = block.querySelector('.thinking-content');
                        if (content && scrollPositions[index]) {
                            content.scrollTop = scrollPositions[index];
                        }
                    }
                });
            }

            // 增强代码块（流式渲染时折叠）
            enhanceCodeBlocks(state.currentAssistantMessage);
        }
    }

    scrollToBottom();
}

/**
 * 实时更新流式消息内容
 * 性能优化：使用 requestAnimationFrame + 防抖，避免过度渲染
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

    // 使用 requestAnimationFrame 在下一帧渲染（60fps 限制）
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

    // 检测是否是 continuation 模式（有工具调用 UI 或持久标记）
    const hasToolCallUI = state.currentAssistantMessage.querySelector('.tool-calls-group');
    const hasContinuationLoading = state.currentAssistantMessage.querySelector('.continuation-loading');
    const isContinuation = state.currentAssistantMessage.dataset.isContinuation === 'true';

    if (hasToolCallUI || hasContinuationLoading || isContinuation) {
        // Continuation 模式：追加新内容，保留现有内容
        console.log('[renderFinalTextWithThinking] Continuation 模式：追加内容');

        // 移除 continuation-loading 提示
        if (hasContinuationLoading) {
            hasContinuationLoading.remove();
        }

        // 移除流式 continuation 容器（如果存在）
        const continuationContent = state.currentAssistantMessage.querySelector('.continuation-content');
        if (continuationContent) {
            continuationContent.remove();
        }

        // 获取之前保存的思维链（从DOM或state中恢复）
        // 检查是否已有思维链块
        const existingThinkingBlocks = state.currentAssistantMessage.querySelectorAll('.thinking-block');

        let html = '';

        // 只有当没有现有思维链时，才渲染新的思维链
        // 或者，如果有新的思维链，则追加为新的阶段
        if (thinkingContent) {
            if (existingThinkingBlocks.length > 0) {
                // 已有思维链，追加新的思维链为新阶段
                console.log('[renderFinalTextWithThinking] 检测到已有思维链，追加新阶段');
                html += renderThinkingBlock(thinkingContent, false);
            } else {
                // 没有现有思维链，正常渲染
                html += renderThinkingBlock(thinkingContent, false);
            }
        }

        if (textContent) {
            html += safeMarkedParse(textContent);
        }

        if (groundingMetadata) {
            html += renderSearchGrounding(groundingMetadata);
        }

        // 使用 insertAdjacentHTML 追加内容（而不是覆盖）
        state.currentAssistantMessage.insertAdjacentHTML('beforeend', html);

        // 清除 continuation 标记
        delete state.currentAssistantMessage.dataset.isContinuation;
    } else {
        // 正常模式：覆盖整个内容
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
    }

    // 清理残留的流式状态（防止状态未重置）
    cleanupStreamingState(state.currentAssistantMessage);

    enhanceCodeBlocks(state.currentAssistantMessage);
    scrollToBottom();
}

/**
 * 渲染下载图标
 * @returns {string}
 */
function renderDownloadIcon() {
    return `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
    `;
}

/**
 * URL 编码（用于内联 onclick）
 * @param {string} url - URL
 * @returns {string}
 */
function encodeInlineUrl(url) {
    return encodeURIComponent(url || '');
}

/**
 * 渲染图片卡片
 * @param {string} url - 图片 URL
 * @returns {string}
 */
function renderImageCard(url) {
    const encodedUrl = encodeInlineUrl(url);
    const ext = getMediaExtension(url, '', 'png');

    return `<div class="image-wrapper">
        <img src="${url}" alt="Generated image" title="点击查看大图" onclick="openImageViewer(decodeURIComponent('${encodedUrl}'))" style="cursor:pointer;">
        <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage(decodeURIComponent('${encodedUrl}'), 'image-${Date.now()}.${ext}')" title="下载原图">
            ${renderDownloadIcon()}
        </button>
    </div>`;
}

/**
 * 渲染视频卡片
 * @param {string} url - 视频 URL
 * @param {string} mimeType - MIME 类型（可选）
 * @returns {string}
 */
function renderVideoCard(url, mimeType = '') {
    const encodedUrl = encodeInlineUrl(url);
    const ext = getMediaExtension(url, mimeType, 'mp4');

    return `<div class="image-wrapper video-wrapper">
        <video src="${url}" controls playsinline muted preload="metadata" title="AI 生成视频"></video>
        <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadMedia(decodeURIComponent('${encodedUrl}'), 'video-${Date.now()}.${ext}')" title="下载视频">
            ${renderDownloadIcon()}
        </button>
    </div>`;
}

/**
 * 渲染媒体卡片
 * @param {string} url - 媒体 URL
 * @param {'image'|'video'} mediaType - 媒体类型
 * @param {string} mimeType - MIME 类型（可选）
 * @returns {string}
 */
function renderMediaCard(url, mediaType, mimeType = '') {
    if (!url) return '';
    if (mediaType === 'video') return renderVideoCard(url, mimeType);
    return renderImageCard(url);
}

/**
 * 渲染包含图片的最终内容
 * @param {Array} contentParts - 内容部分数组
 * @param {string} thinkingContent - 思维链内容
 * @param {Object} groundingMetadata - 搜索结果元数据（可选）
 */
export function renderFinalContentWithThinking(contentParts, thinkingContent, groundingMetadata = null) {
    if (!state.currentAssistantMessage) return;

    // 检测是否是 continuation 模式（有工具调用 UI 或持久标记）
    const hasToolCallUI = state.currentAssistantMessage.querySelector('.tool-calls-group');
    const hasContinuationLoading = state.currentAssistantMessage.querySelector('.continuation-loading');
    const isContinuation = state.currentAssistantMessage.dataset.isContinuation === 'true';

    let html = '';

    // 检查 contentParts 中是否有 thinking 类型
    const hasInlineThinking = contentParts.some(p => p.type === 'thinking');

    if (hasInlineThinking) {
        // 新模式：按 contentParts 顺序渲染（thinking 内联）
        for (const part of contentParts) {
            if (part.type === 'thinking') {
                html += renderThinkingBlock(part.text, false);
            } else if (part.type === 'text') {
                html += safeMarkedParse(part.text);
            } else if (part.type === 'video_url' && part.complete) {
                html += renderMediaCard(part.url, 'video', part.mimeType || part.mime_type);
            } else if (part.type === 'image_url' && part.complete) {
                const mediaType = isVideoUrl(part.url, part.mimeType || part.mime_type) ? 'video' : 'image';
                html += renderMediaCard(part.url, mediaType, part.mimeType || part.mime_type);
            }
        }
    } else {
        // 检查是否已有思维链块（continuation 模式下）
        const existingThinkingBlocks = state.currentAssistantMessage.querySelectorAll('.thinking-block');

        // 旧模式（向后兼容）：thinking 在顶部，然后是 contentParts
        // 但是在 continuation 模式下，只有当没有现有思维链时才渲染新的
        if (thinkingContent) {
            if (hasToolCallUI && existingThinkingBlocks.length > 0) {
                // Continuation 模式且已有思维链，追加新的思维链为新阶段
                console.log('[renderFinalContentWithThinking] 检测到已有思维链，追加新阶段');
                html += renderThinkingBlock(thinkingContent, false);
            } else {
                // 正常模式或没有现有思维链
                html += renderThinkingBlock(thinkingContent, false);
            }
        }

        for (const part of contentParts) {
            if (part.type === 'text') {
                html += safeMarkedParse(part.text);
            } else if (part.type === 'video_url' && part.complete) {
                html += renderMediaCard(part.url, 'video', part.mimeType || part.mime_type);
            } else if (part.type === 'image_url' && part.complete) {
                const mediaType = isVideoUrl(part.url, part.mimeType || part.mime_type) ? 'video' : 'image';
                html += renderMediaCard(part.url, mediaType, part.mimeType || part.mime_type);
            }
        }
    }

    if (groundingMetadata) {
        html += renderSearchGrounding(groundingMetadata);
    }

    if (hasToolCallUI || hasContinuationLoading || isContinuation) {
        // Continuation 模式：追加新内容，保留现有内容
        console.log('[renderFinalContentWithThinking] Continuation 模式：追加内容');

        // 移除 continuation-loading 提示
        if (hasContinuationLoading) {
            hasContinuationLoading.remove();
        }

        // 移除流式 continuation 容器（如果存在）
        const continuationContent = state.currentAssistantMessage.querySelector('.continuation-content');
        if (continuationContent) {
            continuationContent.remove();
        }

        // 使用 insertAdjacentHTML 追加内容（而不是覆盖）
        state.currentAssistantMessage.insertAdjacentHTML('beforeend', html);

        // 清除 continuation 标记
        delete state.currentAssistantMessage.dataset.isContinuation;
    } else {
        // 正常模式：覆盖整个内容
        state.currentAssistantMessage.innerHTML = html;
    }

    // 清理残留的流式状态（防止状态未重置）
    cleanupStreamingState(state.currentAssistantMessage);

    enhanceCodeBlocks(state.currentAssistantMessage);
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
    // 清理图片缓冲区，释放内存
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
    // 处理文本和完整媒体（图片/视频），跳过分块图片
    let addedLength = 0;

    for (const part of deltaContentArray) {
        if (part.type === 'text') {
            // 查找或创建文本部分
            let lastTextPart = contentParts.find(p => p.type === 'text' && !p.complete);
            if (!lastTextPart) {
                lastTextPart = { type: 'text', text: '' };
                contentParts.push(lastTextPart);
            }
            lastTextPart.text += part.text;
            addedLength += part.text.length; // 计数文本长度
        }
        else if (part.type === 'image_url') {
            const imageUrl = part.image_url?.url;
            if (imageUrl && !part.image_url?.partial) {
                const mediaType = isVideoUrl(imageUrl, part.image_url?.mime_type || part.image_url?.mimeType) ? 'video_url' : 'image_url';
                contentParts.push({
                    type: mediaType,
                    url: imageUrl,
                    complete: true,
                    mimeType: part.image_url?.mime_type || part.image_url?.mimeType || ''
                });

                // 计数 base64 数据长度（防止超长）
                // 如果是 data URL，提取 base64 部分的长度
                const base64Match = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
                if (base64Match) {
                    addedLength += base64Match[1].length;
                }
            }
        }
        else if (part.type === 'video_url') {
            const videoUrl = part.video_url?.url || part.url;
            const isPartial = part.video_url?.partial || part.partial;
            if (videoUrl && !isPartial) {
                contentParts.push({
                    type: 'video_url',
                    url: videoUrl,
                    complete: true,
                    mimeType: part.video_url?.mime_type || part.video_url?.mimeType || part.mimeType || ''
                });
                const base64Match = videoUrl.match(/^data:[^;]+;base64,(.+)$/);
                if (base64Match) {
                    addedLength += base64Match[1].length;
                }
            }
        }
    }

    return addedLength;
}
