/**
 * 消息渲染模块
 * 负责创建和渲染消息 DOM 元素
 * 注意：编辑/删除操作通过事件触发，避免循环依赖
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { generateMessageId, escapeHtml } from '../utils/helpers.js';
import { getCurrentModelCapabilities } from '../providers/manager.js';
import { renderCapabilityBadgesText } from '../utils/capability-badges.js';
import { renderHumanizedError } from '../utils/errors.js';
import { categorizeFile, truncateFileName } from '../utils/file-helpers.js';
import { lazyImageManager } from '../utils/lazy-image.js';
import { getMediaExtension, isVideoMimeType, isVideoUrl } from '../utils/media.js';

/**
 * 添加消息到 DOM
 * @param {string} role - 角色
 * @param {string} content - 内容
 * @param {Array} images - 图片数组
 * @returns {HTMLElement} 消息元素
 */
export function addMessage(role, content, images = null) {
    const messageEl = createMessageElement(role, content, images);
    elements.messagesArea.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
}

/**
 * 创建消息 DOM 元素
 * @param {string} role - 角色 ('user' | 'assistant')
 * @param {string} content - 消息内容
 * @param {Array} images - 图片数组
 * @param {string} messageId - 可选的唯一消息ID
 * @param {string} modelName - 可选的模型名称
 * @param {string} providerName - 可选的提供商名称
 * @returns {HTMLElement} 消息元素
 */
export function createMessageElement(role, content, images = null, messageId = null, modelName = null, _providerName = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    // 设置唯一消息ID（如果提供）
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    // 使用用户自定义名称的首字母
    const userInitial = (state.userName || 'User').charAt(0).toUpperCase();
    const charInitial = (state.charName || 'Assistant').charAt(0).toUpperCase();
    avatar.textContent = role === 'user' ? userInitial : charInitial;

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';

    // 🏷️ 添加模型和提供商标签（只针对助手消息）
    if (role === 'assistant' && (modelName || _providerName)) {
        const modelBadge = document.createElement('div');
        modelBadge.className = 'message-model-badge';

        // 获取当前模型的能力配置
        const capabilities = getCurrentModelCapabilities();
        const badgesText = renderCapabilityBadgesText(capabilities);

        // 在模型名称后添加能力徽章
        const badgeText = [modelName + badgesText, _providerName].filter(Boolean).join(' | ');
        modelBadge.textContent = badgeText;
        modelBadge.title = `模型: ${modelName || '未知'}\n提供商: ${_providerName || '未知'}`;

        contentWrapper.appendChild(modelBadge);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // 添加文本内容
    if (role === 'assistant' && typeof marked !== 'undefined') {
        contentDiv.innerHTML = safeMarkedParse(content);
    } else {
        contentDiv.textContent = content;
    }

    // 添加附件（用户消息）- 支持图片、PDF、TXT
    if (images && images.length > 0) {
        const attachmentsContainer = document.createElement('div');
        attachmentsContainer.className = 'message-images';
        images.forEach(file => {
            const category = file.category || categorizeFile(file.type);

            if (category === 'image') {
                // 图片：使用懒加载
                const imgEl = document.createElement('img');
                // 使用SVG占位图，减少初始内存占用
                imgEl.src = 'data:image/svg+xml,%3Csvg width="400" height="300" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100%25" height="100%25" fill="%23f5f5f5"/%3E%3C/svg%3E';
                // 真实图片URL存储在 data-src
                imgEl.dataset.src = file.compressed || file.data;
                imgEl.alt = file.name;
                imgEl.title = '点击查看大图';
                imgEl.className = 'lazy-image';
                imgEl.onclick = () => {
                    eventBus.emit('ui:open-image-viewer', { url: file.data });
                };
                attachmentsContainer.appendChild(imgEl);

                // 在下一个空闲时间观察图片
                requestIdleCallback(() => {
                    lazyImageManager.observe(imgEl);
                }, { timeout: 500 });
            } else if (category === 'pdf') {
                // PDF：显示文件图标
                const fileEl = document.createElement('div');
                fileEl.className = 'message-file-item pdf';
                fileEl.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span class="file-name" title="${file.name}">${truncateFileName(file.name, 20)}</span>
                `;
                attachmentsContainer.appendChild(fileEl);
            } else if (category === 'text') {
                // TXT/MD：显示文件图标
                const isMarkdown = file.type === 'text/markdown' || file.name.endsWith('.md');
                const fileEl = document.createElement('div');
                fileEl.className = `message-file-item ${isMarkdown ? 'md' : 'txt'}`;
                fileEl.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <span class="file-name" title="${file.name}">${truncateFileName(file.name, 20)}</span>
                `;
                attachmentsContainer.appendChild(fileEl);
            }
        });
        contentDiv.appendChild(attachmentsContainer);
    }

    contentWrapper.appendChild(contentDiv);

    // 统一操作按钮组
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.setAttribute('role', 'toolbar');
    actionsDiv.setAttribute('aria-label', '消息操作');

    // 助手消息：重试按钮
    if (role === 'assistant') {
        const retryButton = document.createElement('button');
        retryButton.className = 'msg-action-btn retry-msg';
        retryButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>`;
        retryButton.title = '重新生成';
        retryButton.setAttribute('aria-label', '重新生成回复');
        retryButton.onclick = () => {
            eventBus.emit('message:retry-requested', { messageEl: messageDiv });
        };
        actionsDiv.appendChild(retryButton);
    }

    // 编辑按钮（通过事件解耦）
    const editButton = document.createElement('button');
    editButton.className = 'msg-action-btn edit-msg';
    editButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`;
    editButton.title = '编辑';
    editButton.setAttribute('aria-label', '编辑消息');
    editButton.onclick = () => {
        eventBus.emit('message:edit-requested', { messageEl: messageDiv });
    };
    actionsDiv.appendChild(editButton);

    // 引用按钮（通过事件解耦）
    const quoteButton = document.createElement('button');
    quoteButton.className = 'msg-action-btn quote-msg';
    quoteButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
    </svg>`;
    quoteButton.title = '引用';
    quoteButton.setAttribute('aria-label', '引用消息');
    quoteButton.onclick = () => {
        eventBus.emit('message:quote-requested', { messageEl: messageDiv, role, content });
    };
    actionsDiv.appendChild(quoteButton);

    // 删除按钮（通过事件解耦）
    const deleteButton = document.createElement('button');
    deleteButton.className = 'msg-action-btn delete-msg';
    deleteButton.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>`;
    deleteButton.title = '删除';
    deleteButton.setAttribute('aria-label', '删除消息');
    deleteButton.onclick = () => {
        eventBus.emit('message:delete-requested', { messageEl: messageDiv });
    };
    actionsDiv.appendChild(deleteButton);

    contentWrapper.appendChild(actionsDiv);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentWrapper);

    // 增强代码块（如果是助手消息）
    if (role === 'assistant') {
        setTimeout(() => enhanceCodeBlocks(messageDiv), 0);
    }

    return messageDiv;
}

/**
 * 渲染多回复选择器
 * @param {Array} replies - 回复数组
 * @param {number} selectedIndex - 选中的索引
 * @param {HTMLElement} assistantMessageEl - 助手消息元素
 */
export function renderReplyWithSelector(replies, selectedIndex, assistantMessageEl) {
    const contentWrapper = assistantMessageEl.querySelector('.message-content-wrapper');
    const contentDiv = assistantMessageEl.querySelector('.message-content');

    if (!contentWrapper || !contentDiv) return;

    // 获取消息索引
    const messageIndex = assistantMessageEl.dataset.messageIndex;
    const msgIdx = messageIndex !== undefined ? parseInt(messageIndex) : null;

    // 移除加载指示器
    const loadingIndicator = contentDiv.querySelector('.loading-indicator, .thinking-dots');
    if (loadingIndicator) loadingIndicator.remove();

    // 添加回复选择器
    if (replies.length > 1) {
        let selectorEl = contentWrapper.querySelector('.reply-selector');
        if (!selectorEl) {
            selectorEl = document.createElement('div');
            selectorEl.className = 'reply-selector';
            contentWrapper.insertBefore(selectorEl, contentDiv);
        }

        selectorEl.innerHTML = '';
        replies.forEach((reply, index) => {
            const tab = document.createElement('button');
            tab.className = `reply-tab${index === selectedIndex ? ' active' : ''}`;
            tab.textContent = index + 1;
            tab.title = `回复 ${index + 1}`;
            tab.onclick = () => {
                eventBus.emit('reply:select-requested', { index, messageIndex: msgIdx });
            };
            selectorEl.appendChild(tab);
        });
    }

    // 渲染选中的回复内容
    const reply = replies[selectedIndex] || replies[0];
    if (!reply) return;
    let html = '';

    // 检查是否是错误回复
    if (reply.isError) {
        const errorObj = {
            error: {
                type: reply.errorType || 'unknown',
                message: reply.errorMessage || 'Unknown error'
            }
        };
        html = renderHumanizedError(errorObj, null, true);
    } else {
        // 渲染思维链内容（如果有）
        if (reply.thinkingContent) {
            html += renderThinkingBlock(reply.thinkingContent);
        }

        // 修复1: 优先渲染 contentParts (包含图片)
        if (reply.contentParts && reply.contentParts.length > 0) {
            html += renderContentParts(reply.contentParts);
        }
        // 渲染主要内容
        else if (state.apiFormat === 'gemini' && reply.parts) {
            html += renderGeminiParts(reply.parts);
            if (reply.groundingMetadata) {
                html += renderSearchGrounding(reply.groundingMetadata);
            }
        } else if (reply.content) {
            html += renderContent(reply.content);
        }
    }

    contentDiv.innerHTML = html;
    state.currentAssistantMessage = contentDiv;

    // 绑定图片点击事件
    bindImageClickEvents(contentDiv);

    // 增强代码块
    enhanceCodeBlocks(assistantMessageEl);

    scrollToBottom();
}

/**
 * 为图片绑定点击事件
 * @param {HTMLElement} container - 容器元素
 */
export function bindImageClickEvents(container) {
    const images = container.querySelectorAll('.image-wrapper img');
    images.forEach(img => {
        img.style.cursor = 'pointer';
        img.onclick = () => {
            eventBus.emit('ui:open-image-viewer', { url: img.src });
        };
    });

    // 绑定下载按钮事件
    const downloadBtns = container.querySelectorAll('.download-image-btn');
    downloadBtns.forEach(btn => {
        const imgWrapper = btn.closest('.image-wrapper');
        const img = imgWrapper?.querySelector('img');
        if (img) {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (window.downloadImage) {
                    // 添加 filename 参数，避免触发 window.open 跳转
                    const match = img.src.match(/^data:image\/(\w+);/);
                    const ext = match ? match[1] : 'png';
                    window.downloadImage(img.src, `image-${Date.now()}.${ext}`);
                }
            };
        }
    });
}

/**
 * 渲染下载按钮 SVG 图标
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
 * 生成内联 JS 可安全使用的 URL 字符串
 * @param {string} url - 原始 URL
 * @returns {string}
 */
function encodeInlineUrl(url) {
    return encodeURIComponent(url || '');
}

/**
 * 渲染图片媒体块
 * @param {string} url - 图片 URL
 * @returns {string}
 */
function renderImageMedia(url) {
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
 * 渲染视频媒体块
 * @param {string} url - 视频 URL
 * @param {string} mimeType - MIME 类型（可选）
 * @returns {string}
 */
function renderVideoMedia(url, mimeType = '') {
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
 * 渲染媒体块（图片/视频）
 * @param {string} url - 媒体 URL
 * @param {'image'|'video'} mediaType - 媒体类型
 * @param {string} mimeType - MIME 类型（可选）
 * @returns {string}
 */
function renderMediaBlock(url, mediaType, mimeType = '') {
    if (!url) return '';
    if (mediaType === 'video') {
        return renderVideoMedia(url, mimeType);
    }
    return renderImageMedia(url);
}

/**
 * 渲染 Gemini parts
 */
function renderGeminiParts(parts) {
    let html = '';
    for (const part of parts) {
        // 跳过思维部分（已单独渲染）
        if (part.thought) continue;

        if (part.text) {
            html += safeMarkedParse(part.text);
        } else if (part.inlineData || part.inline_data) {
            const inlineData = part.inlineData || part.inline_data;
            const mimeType = inlineData.mimeType || inlineData.mime_type;
            const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
            const mediaType = isVideoMimeType(mimeType) ? 'video' : 'image';
            html += renderMediaBlock(dataUrl, mediaType, mimeType);
        }
    }
    return html;
}

/**
 * 渲染内容（OpenAI/Claude 格式）
 */
function renderContent(content) {
    if (Array.isArray(content)) {
        let html = '';
        for (const part of content) {
            if (part.type === 'text') {
                html += safeMarkedParse(part.text);
            } else if (part.type === 'video_url') {
                const url = part.video_url?.url || part.url;
                html += renderMediaBlock(url, 'video', part.mime_type || part.mimeType || part.video_url?.mime_type || part.video_url?.mimeType);
            } else if (part.type === 'image_url' && part.image_url?.url) {
                const url = part.image_url.url;
                const mediaType = isVideoUrl(url) ? 'video' : 'image';
                html += renderMediaBlock(url, mediaType);
            }
        }
        return html;
    } else {
        return safeMarkedParse(content);
    }
}

/**
 * 新增: 渲染 contentParts 数组（包含文本、图片和思维链）
 * @param {Array} contentParts - 内容部分数组
 * @returns {string} HTML字符串
 */
export function renderContentParts(contentParts) {
    let html = '';
    for (const part of contentParts) {
        if (part.type === 'thinking') {
            // 支持 inline thinking
            html += renderThinkingBlock(part.text, false);
        } else if (part.type === 'text') {
            // 过滤工具调用占位符（重新加载时不显示）
            if (part.text && part.text !== '(调用工具)') {
                html += safeMarkedParse(part.text);
            }
        } else if (part.type === 'video_url' && part.complete && part.url) {
            html += renderMediaBlock(part.url, 'video', part.mimeType || part.mime_type);
        } else if (part.type === 'image_url' && part.complete && part.url) {
            const mediaType = isVideoUrl(part.url, part.mimeType || part.mime_type) ? 'video' : 'image';
            html += renderMediaBlock(part.url, mediaType, part.mimeType || part.mime_type);
        }
    }
    return html;
}

// 思维链块分隔符（常量化，便于维护）
const THINKING_BLOCK_SEPARATOR = '\n\n---\n\n';

/**
 * 渲染思维链块（支持多块分段显示）
 *
 * **多思考块支持**：
 * - **Gemini 思维链**：多个 thought parts 通过分隔符连接
 * - **OpenAI o系列**：推理过程可能分为多个阶段
 * - **Claude Extended Thinking**：长思维链自动分段
 *
 * **分隔符格式**：`\n\n---\n\n`（两个换行 + 三横线 + 两个换行）
 *
 * @param {string} thinkingContent - 思维链内容（可能包含多个块）
 * @param {boolean} isStreaming - 是否流式渲染（影响动画效果）
 * @returns {string} 渲染后的 HTML
 *
 * @example
 * // 单个思考块
 * renderThinkingBlock("这是一个思考过程...")
 *
 * // 多个思考块（分割为多个折叠面板）
 * renderThinkingBlock("第一阶段思考\n\n---\n\n第二阶段思考")
 */
export function renderThinkingBlock(thinkingContent, isStreaming = false) {
    if (!thinkingContent) return '';

    const streamingClass = isStreaming ? 'streaming' : '';

    // 使用常量分隔符，提高可维护性
    const blocks = thinkingContent.split(THINKING_BLOCK_SEPARATOR).filter(b => b.trim());

    if (blocks.length <= 1) {
        // 单个思考块
        return renderSingleThinkingBlock(thinkingContent, '思考过程', streamingClass);
    }

    // 多个思考块，使用更清晰的标签命名
    return blocks.map((block, index) => {
        const label = `思考阶段 ${index + 1}`;
        const isLast = index === blocks.length - 1;
        return renderSingleThinkingBlock(block, label, isLast ? streamingClass : '');
    }).join('');
}

// 思维链惰性渲染：用 Map 存储原始文本，避免 encodeURIComponent 膨胀 DOM 属性
const thinkingRawContentMap = new Map(); // thinkingId -> rawText
let thinkingIdCounter = 0;

/** 清理思维链惰性渲染缓存（会话切换时调用） */
export function clearThinkingCache() {
    thinkingRawContentMap.clear();
}

/**
 * 渲染单个思维链块
 */
function renderSingleThinkingBlock(content, label, streamingClass = '') {
    // 流式传输中的思维链需要立即渲染内容
    const isStreaming = streamingClass.includes('streaming');
    const contentHtml = isStreaming ? safeMarkedParse(content || '') : '';

    // 折叠状态下不解析 Markdown，存储原始文本到 JS Map 中
    let lazyAttr = '';
    if (!isStreaming && content) {
        const tid = `t_${++thinkingIdCounter}`;
        thinkingRawContentMap.set(tid, content);
        lazyAttr = ` data-thinking-id="${tid}"`;
    }

    return `
        <div class="thinking-block collapsed ${streamingClass}">
            <div class="thinking-header"
                 role="button"
                 tabindex="0"
                 aria-expanded="false"
                 aria-label="${label} - 点击展开或收起">
                <span class="thinking-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
                        <path d="M9 21h6"/>
                        <path d="M10 21v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/>
                    </svg>
                </span>
                <span class="thinking-label">${label}</span>
                <span class="thinking-toggle-icon" aria-hidden="true">▶</span>
            </div>
            <div class="thinking-content"${lazyAttr}>
                ${contentHtml}
            </div>
        </div>
    `;
}

/**
 * 渲染搜索引用
 */
export function renderSearchGrounding(groundingMetadata) {
    if (!groundingMetadata?.groundingChunks && !groundingMetadata?.webSearchQueries) return '';

    const chunks = groundingMetadata.groundingChunks || [];
    const sources = chunks
        .filter(chunk => chunk.web)
        .map(chunk => `<li><a href="${chunk.web.uri}" target="_blank" rel="noopener noreferrer">${chunk.web.title || chunk.web.uri}</a></li>`)
        .join('');

    if (!sources) return '';

    return `
        <div class="search-grounding">
            <div class="grounding-header">🔍 搜索引用</div>
            <ul class="grounding-sources">${sources}</ul>
        </div>
    `;
}

/**
 * 滚动到底部
 */
export function scrollToBottom() {
    elements.messagesArea.scrollTo({
        top: elements.messagesArea.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * 增强代码块（添加语言标签和复制按钮）
 * 智能语言检测 + 手动切换功能
 * 性能优化：缓存 DOM 查询
 * @param {HTMLElement} container - 容器元素（可选，默认处理整个消息区域）
 */
export function enhanceCodeBlocks(container = null) {
    const target = container || elements.messagesArea;
    const codeBlocks = target.querySelectorAll('pre code');

    codeBlocks.forEach((codeBlock) => {
        const pre = codeBlock.parentElement;

        // 优化：使用缓存的选择器避免重复查询
        // 如果已经处理过，跳过
        // 同时检查是否已经在另一个折叠代码块的内部，避免重复增强导致的嵌套
        if (pre.classList.contains('code-block-enhanced') || pre.closest('.code-collapse-content')) return;

        // 获取代码内容
        const codeText = codeBlock.textContent;
        const lineCount = codeText.split('\n').length;

        // 智能语言检测
        const languageClass = Array.from(codeBlock.classList).find(cls => cls.startsWith('language-'));
        const hintedLang = languageClass ? languageClass.replace('language-', '') : null;
        const detectedLang = detectCodeLanguage(codeText, hintedLang);

        // 所有代码块都使用统一的折叠样式
        // 根据行数决定默认是否折叠：超过 20 行默认折叠，否则默认展开
        const defaultCollapsed = lineCount > 20;
        createCollapsibleCodeBlock(pre, codeBlock, detectedLang, codeText, lineCount, defaultCollapsed);

        // 标记为已增强
        pre.classList.add('code-block-enhanced');
        return;
    });

    // 增强思维链块（折叠/展开功能）
    enhanceThinkingBlocks(target);

    // 增强表格（导出 CSV、排序）
    enhanceTables(target);

    // 绑定图片点击事件（查看大图、下载）
    bindImageClickEvents(target);
}

/**
 * 智能检测代码语言
 * 基于代码特征的启发式检测
 * @param {string} code - 代码内容
 * @param {string} hintedLang - marked.js 提示的语言
 * @returns {string} 检测到的语言
 */
function detectCodeLanguage(code, hintedLang) {
    // 如果有明确的提示语言且不是 'text'，使用提示语言
    if (hintedLang && hintedLang !== 'text' && hintedLang !== 'plaintext') {
        return hintedLang;
    }

    // 基于内容特征检测
    const trimmed = code.trim();

    // JSON 检测
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch (_e) {
            // 不是有效的 JSON
        }
    }

    // HTML 检测
    if (/<(!DOCTYPE html|html|head|body|div|span|p|a|img|script|style)/i.test(code)) {
        return 'html';
    }

    // CSS 检测
    if (/[.#][\w-]+\s*\{[^}]*\}/.test(code) || /@(media|keyframes|import)/.test(code)) {
        return 'css';
    }

    // Python 检测
    if (/^(def |class |import |from |if __name__|print\()/m.test(code)) {
        return 'python';
    }

    // JavaScript/TypeScript 检测
    if (/\b(function|const|let|var|=>|async|await|class|interface|type)\b/.test(code)) {
        // TypeScript 特征
        if (/:\s*(string|number|boolean|any|void|unknown|never)\b|interface |type /.test(code)) {
            return 'typescript';
        }
        return 'javascript';
    }

    // Java 检测
    if (/\b(public |private |protected |class |interface |extends |implements |package |import java\.)/m.test(code)) {
        return 'java';
    }

    // C++ 检测
    if (/#include\s*<|using namespace |std::|cout|cin|vector</.test(code)) {
        return 'cpp';
    }

    // C 检测
    if (/#include\s*<stdio\.h>|#include\s*<stdlib\.h>|int main\(|printf\(|scanf\(/.test(code)) {
        return 'c';
    }

    // C# 检测
    if (/\b(using System;|namespace |class |public static void Main|Console\.WriteLine)/m.test(code)) {
        return 'csharp';
    }

    // Go 检测
    if (/^package |func |import \(|fmt\.Print/.test(code)) {
        return 'go';
    }

    // Rust 检测
    if (/\b(fn |let mut |impl |use |pub |struct |enum |match )\b/.test(code)) {
        return 'rust';
    }

    // PHP 检测
    if (/^<\?php|\$[a-zA-Z_]|->|::|echo |function /.test(code)) {
        return 'php';
    }

    // Ruby 检测
    if (/\b(def |end\b|class |module |puts |require )\b/.test(code)) {
        return 'ruby';
    }

    // Bash 检测
    if (/^#!\/bin\/(bash|sh)|^\s*(if |for |while |case |function |echo |export |cd |ls |grep )/m.test(code)) {
        return 'bash';
    }

    // SQL 检测
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|TABLE)\b/i.test(code)) {
        return 'sql';
    }

    // YAML 检测
    if (/^[\w-]+:\s*$|^ {2}[\w-]+:\s/m.test(code) && !/[{}[\]]/.test(code)) {
        return 'yaml';
    }

    // Markdown 检测
    if (/^#{1,6}\s|^\*\*|^- |^\d+\. |^\[.+\]\(.+\)/.test(code)) {
        return 'markdown';
    }

    // 默认为纯文本
    return 'text';
}

/**
 * 增强思维链块（添加折叠/展开功能）
 * 实现缺失的交互功能
 * 使用 dataset 标记避免重复绑定,事件监听器会在元素移除时自动清理
 * 性能优化：缓存 DOM 查询
 * @param {HTMLElement} container - 容器元素
 */
export function enhanceThinkingBlocks(container = null) {
    const target = container || elements.messagesArea;
    const headers = target.querySelectorAll('.thinking-header');

    headers.forEach((header) => {
        // 避免重复绑定
        if (header.dataset.enhanced === 'true') return;
        header.dataset.enhanced = 'true';

        const block = header.closest('.thinking-block');
        if (!block) return;

        // 切换折叠/展开
        const toggleThinking = () => {
            const isCollapsed = block.classList.toggle('collapsed');
            header.setAttribute('aria-expanded', !isCollapsed);

            // 惰性渲染：首次展开时从 Map 取原始文本并解析 Markdown
            if (!isCollapsed) {
                const contentDiv = block.querySelector('.thinking-content');
                const tid = contentDiv?.dataset.thinkingId;
                if (tid && thinkingRawContentMap.has(tid)) {
                    contentDiv.innerHTML = safeMarkedParse(thinkingRawContentMap.get(tid));
                    thinkingRawContentMap.delete(tid); // 释放原始文本
                    delete contentDiv.dataset.thinkingId;
                    enhanceCodeBlocks(block);
                }
            }

            // 更新图标
            const icon = header.querySelector('.thinking-toggle-icon');
            if (icon) {
                icon.textContent = isCollapsed ? '▶' : '▼';
            }
        };

        // 点击事件（元素移除时会自动清理）
        header.addEventListener('click', toggleThinking);

        // 键盘事件（可访问性,元素移除时会自动清理）
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleThinking();
            }
        });
    });
}

/**
 * 复制代码
 */
function copyCode(button, codeText) {
    navigator.clipboard.writeText(codeText).then(() => {
        const originalHTML = button.innerHTML;
        button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg><span>已复制</span>`;
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('复制失败:', err);
        eventBus.emit('ui:notification', { message: '复制失败', type: 'error' });
    });
}

/**
 * 增强表格（添加导出和排序功能）
 * 提升数据表格的可用性
 * 使用 dataset 标记避免重复增强,事件监听器会在元素移除时自动清理
 * 性能优化：缓存 DOM 查询
 * @param {HTMLElement} container - 容器元素
 */
function enhanceTables(container = null) {
    const target = container || elements.messagesArea;
    const tables = target.querySelectorAll('table');

    tables.forEach((table) => {
        // 避免重复增强
        if (table.dataset.enhanced === 'true') return;
        table.dataset.enhanced = 'true';

        // 检查表格是否有内容
        const rows = table.querySelectorAll('tr');
        if (rows.length === 0) return;

        // 创建包装器
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar';
        toolbar.innerHTML = `
            <button class="table-export-btn" title="导出为 CSV">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>导出 CSV</span>
            </button>
            <span class="table-info">${rows.length} 行</span>
        `;

        wrapper.insertBefore(toolbar, table);

        // 绑定导出事件（元素移除时会自动清理）
        toolbar.querySelector('.table-export-btn').addEventListener('click', () => {
            exportTableAsCSV(table);
        });
    });
}

/**
 * 导出表格为 CSV 文件
 * @param {HTMLElement} table - 表格元素
 */
function exportTableAsCSV(table) {
    const rows = Array.from(table.querySelectorAll('tr'));

    // 转换为 CSV
    const csv = rows.map(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map(cell => {
            // 处理包含逗号、引号、换行的内容
            let text = cell.textContent.trim();
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                text = `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        }).join(',');
    }).join('\n');

    // 下载文件
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    eventBus.emit('ui:notification', {
        message: '表格已导出为 CSV',
        type: 'success'
    });
}

/**
 * 检查是否在底部附近（阈值 150px）
 */
export function isNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = elements.messagesArea;
    return scrollHeight - scrollTop - clientHeight < 150;
}

// ========== 事件监听 ==========

/**
 * 监听消息内容更新事件（编辑AI消息后重新渲染）
 */
eventBus.on('message:content-updated', ({ messageEl, index, newContent, role }) => {
    // 退出编辑模式
    messageEl.classList.remove('editing');

    // 重新渲染消息内容
    const contentDiv = messageEl.querySelector('.message-content');
    if (!contentDiv) return;

    // 优先使用 OpenAI 格式的 contentParts（包含思维链）
    const openaiMsg = state.messages[index];

    // 优先使用 contentParts 渲染（包含编辑后的思维链）
    if (openaiMsg?.contentParts && openaiMsg.contentParts.length > 0) {
        // 过滤掉占位符
        const validParts = openaiMsg.contentParts.filter(
            p => !(p.type === 'text' && p.text === '(调用工具)')
        );
        if (validParts.length > 0) {
            contentDiv.innerHTML = renderContentParts(validParts);
            enhanceCodeBlocks(messageEl);
            eventBus.emit('ui:notification', { message: '消息已保存', type: 'success' });
            return;
        }
    }

    // 回退：使用 thinkingContent + content 渲染
    if (role === 'assistant' && openaiMsg?.thinkingContent) {
        let html = renderThinkingBlock(openaiMsg.thinkingContent);
        if (typeof openaiMsg.content === 'string') {
            html += safeMarkedParse(openaiMsg.content);
        } else if (Array.isArray(openaiMsg.content)) {
            html += renderContent(openaiMsg.content);
        }
        contentDiv.innerHTML = html;
        enhanceCodeBlocks(messageEl);
        eventBus.emit('ui:notification', { message: '消息已保存', type: 'success' });
        return;
    }

    // 最后回退：根据 API 格式渲染
    let htmlContent = '';

    if (state.apiFormat === 'gemini') {
        const messageData = state.geminiContents[index];
        if (messageData?.parts) {
            messageData.parts.forEach(part => {
                if (part.text !== undefined) {
                    if (role === 'assistant') {
                        htmlContent += safeMarkedParse(part.text);
                    } else {
                        htmlContent += part.text;
                    }
                } else if (part.inlineData || part.inline_data) {
                    const inlineData = part.inlineData || part.inline_data;
                    const mimeType = inlineData.mimeType || inlineData.mime_type;
                    const base64Data = inlineData.data;
                    const mediaUrl = `data:${mimeType};base64,${base64Data}`;
                    const mediaType = isVideoMimeType(mimeType) ? 'video' : 'image';
                    htmlContent += renderMediaBlock(mediaUrl, mediaType, mimeType);
                }
            });
        }
    } else if (state.apiFormat === 'claude') {
        const messageData = state.claudeContents[index];
        if (messageData?.content) {
            if (Array.isArray(messageData.content)) {
                messageData.content.forEach(part => {
                    if (part.type === 'text') {
                        if (role === 'assistant') {
                            htmlContent += safeMarkedParse(part.text || '');
                        } else {
                            htmlContent += part.text || '';
                        }
                    } else if (part.type === 'video' && part.source) {
                        const mimeType = part.source.media_type || part.source.mimeType || 'video/mp4';
                        const videoUrl = part.source.type === 'base64'
                            ? `data:${mimeType};base64,${part.source.data}`
                            : (part.source.url || '');
                        htmlContent += renderMediaBlock(videoUrl, 'video', mimeType);
                    } else if (part.type === 'image' && part.source) {
                        const imgUrl = `data:${part.source.media_type};base64,${part.source.data}`;
                        htmlContent += renderMediaBlock(imgUrl, 'image', part.source.media_type);
                    }
                });
            } else {
                if (role === 'assistant') {
                    htmlContent = safeMarkedParse(messageData.content);
                } else {
                    htmlContent = messageData.content;
                }
            }
        }
    } else {
        const messageData = state.messages[index];
        if (messageData?.content) {
            htmlContent = renderContent(messageData.content);
        }
    }

    // 更新DOM
    contentDiv.innerHTML = htmlContent;

    // 重新增强内容（代码高亮、折叠等）
    enhanceCodeBlocks(messageEl);

    // 显示成功通知
    eventBus.emit('ui:notification', {
        message: '消息已保存',
        type: 'success'
    });
});

// ========== 代码块折叠功能 ==========

/**
 * 语言显示名称映射
 */
const languageDisplayNames = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    csharp: 'C#',
    go: 'Go',
    rust: 'Rust',
    php: 'PHP',
    ruby: 'Ruby',
    bash: 'Shell',
    sql: 'SQL',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    yaml: 'YAML',
    markdown: 'Markdown',
    text: 'Text'
};

/**
 * 智能生成代码块标题
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 * @returns {string} 标题
 */
function generateCodeTitle(code, language) {
    const firstLine = code.trim().split('\n')[0].trim();

    // 策略1: 从注释中提取标题
    if (firstLine.startsWith('//') || firstLine.startsWith('#')) {
        const title = firstLine.replace(/^[//#]+\s*/, '').trim();
        if (title.length > 0 && title.length < 60) {
            return title;
        }
    }

    // 策略2: 从函数/类定义中提取
    const patterns = {
        javascript: /(?:function|class|const|let)\s+([a-zA-Z_$][\w$]*)/,
        typescript: /(?:function|class|const|let|interface|type)\s+([a-zA-Z_$][\w$]*)/,
        python: /(?:def|class)\s+([a-zA-Z_][\w]*)/,
        java: /(?:public|private|protected)?\s*(?:static)?\s*(?:class|interface)\s+([A-Z][\w]*)/,
        cpp: /(?:class|struct|namespace)\s+([a-zA-Z_][\w]*)/,
        go: /func\s+([a-zA-Z_][\w]*)/,
        rust: /(?:fn|struct|enum|trait)\s+([a-zA-Z_][\w]*)/
    };

    const pattern = patterns[language];
    if (pattern) {
        const match = code.match(pattern);
        if (match) {
            return `${match[1]} - ${languageDisplayNames[language] || language}`;
        }
    }

    // 策略3: 从文件路径中提取
    const fileMatch = code.match(/\/([a-zA-Z0-9_-]+\.[a-z]+)/);
    if (fileMatch) {
        return fileMatch[1];
    }

    // 策略4: 默认标题
    return `${languageDisplayNames[language] || language} 代码`;
}

/**
 * 创建可折叠代码块
 * @param {HTMLElement} pre - pre元素
 * @param {HTMLElement} codeBlock - code元素
 * @param {string} language - 语言
 * @param {string} codeText - 代码文本
 * @param {number} lineCount - 行数
 * @param {boolean} defaultCollapsed - 默认是否折叠（默认 true）
 */
function createCollapsibleCodeBlock(pre, codeBlock, language, codeText, lineCount, defaultCollapsed = true) {
    // 生成智能标题
    const title = generateCodeTitle(codeText, language);

    // 根据参数决定默认折叠状态
    pre.className = defaultCollapsed ? 'code-block-collapsible collapsed' : 'code-block-collapsible';
    pre.innerHTML = '';

    // 折叠头部
    const header = document.createElement('div');
    header.className = 'code-collapse-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', defaultCollapsed ? 'false' : 'true');
    header.innerHTML = `
        <span class="code-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
        </span>
        <span class="code-title">${escapeHtml(title)}</span>
        <span class="code-meta">
            <span class="code-language-badge">${language.toUpperCase()}</span>
            <span class="code-line-count">${lineCount} 行</span>
        </span>
        <span class="code-toggle-icon" aria-hidden="true">${defaultCollapsed ? '▶' : '▼'}</span>
    `;

    // 操作按钮组
    const actions = document.createElement('div');
    actions.className = 'code-collapse-actions';
    actions.innerHTML = `
        <button class="code-action-btn preview-code" title="预览代码" aria-label="预览代码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        </button>
        <button class="code-action-btn edit-code" title="编辑代码" aria-label="编辑代码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        </button>
        <button class="code-action-btn copy-code" title="复制代码" aria-label="复制代码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
        </button>
        <button class="code-action-btn download-code" title="下载代码" aria-label="下载代码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
        </button>
    `;

    // 代码内容容器（默认折叠）
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'code-collapse-content';

    const clonedCode = codeBlock.cloneNode(true);
    clonedCode.className = `language-${language}`;

    const newPre = document.createElement('pre');
    newPre.appendChild(clonedCode);
    contentWrapper.appendChild(newPre);

    // 组装
    pre.appendChild(header);
    pre.appendChild(actions);
    pre.appendChild(contentWrapper);

    // 绑定折叠/展开事件
    bindCollapseEvents(pre, header);

    // 绑定操作按钮事件
    bindCodeBlockActions(pre, actions, codeText, language);

    // 应用语法高亮
    if (typeof hljs !== 'undefined') {
        hljs.highlightElement(clonedCode);
    }
}

/**
 * 绑定折叠/展开事件
 * 事件监听器会在元素移除时自动清理
 * @param {HTMLElement} pre - pre元素
 * @param {HTMLElement} header - 头部元素
 */
function bindCollapseEvents(pre, header) {
    const toggle = () => {
        const isCollapsed = pre.classList.toggle('collapsed');
        header.setAttribute('aria-expanded', !isCollapsed);

        const icon = header.querySelector('.code-toggle-icon');
        if (icon) {
            icon.textContent = isCollapsed ? '▶' : '▼';
        }
    };

    // 点击事件（元素移除时会自动清理）
    header.addEventListener('click', toggle);

    // 键盘事件（可访问性,元素移除时会自动清理）
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });
}

/**
 * 绑定代码块操作按钮事件
 * @param {HTMLElement} pre - pre元素
 * @param {HTMLElement} actions - 操作按钮容器
 * @param {string} codeText - 代码文本
 * @param {string} language - 语言
 */
function bindCodeBlockActions(pre, actions, codeText, language) {
    // 防止重复绑定事件
    if (actions.dataset.eventsBound === 'true') {
        return;
    }
    actions.dataset.eventsBound = 'true';

    // 阻止操作按钮的事件冒泡（避免触发折叠）
    actions.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // 🔧 辅助函数：从DOM动态读取当前代码和语言
    const getCurrentCode = () => {
        // 优先查找折叠代码块的代码
        const collapsibleCode = pre.querySelector('.code-collapse-content code');
        if (collapsibleCode) {
            const code = collapsibleCode.textContent;
            const langMatch = collapsibleCode.className.match(/language-(\w+)/);
            const lang = langMatch ? langMatch[1] : 'text';
            return { code, language: lang };
        }

        // 查找普通代码块的代码
        const normalCode = pre.querySelector('code');
        if (normalCode) {
            const code = normalCode.textContent;
            const langMatch = normalCode.className.match(/language-(\w+)/);
            const lang = langMatch ? langMatch[1] : 'text';
            return { code, language: lang };
        }

        // 降级：使用初始值
        return { code: codeText, language: language };
    };

    // 复制按钮
    const copyBtn = actions.querySelector('.copy-code');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const { code } = getCurrentCode();
            navigator.clipboard.writeText(code).then(() => {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('复制失败:', err);
                eventBus.emit('ui:notification', {
                    message: '复制失败',
                    type: 'error'
                });
            });
        });
    }

    // 下载按钮
    const downloadBtn = actions.querySelector('.download-code');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const { code, language: lang } = getCurrentCode();
            downloadCodeAsFile(code, lang);
        });
    }

    // 预览按钮（打开编辑器模态框，只读模式）
    const previewBtn = actions.querySelector('.preview-code');
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            try {
                const messageEl = pre.closest('.message');
                if (!messageEl) {
                    console.error('[预览代码] 找不到消息元素');
                    return;
                }

                // 动态导入编辑器模块
                const { openCodeEditorModal } = await import('../ui/code-editor-modal.js');

                // 🔧 从DOM读取最新代码
                const { code, language: lang } = getCurrentCode();

                // 第四个参数 true 表示只读模式
                openCodeEditorModal(code, lang, null, true);
            } catch (error) {
                console.error('[预览代码] 错误:', error);
                eventBus.emit('ui:notification', {
                    message: '打开预览失败: ' + error.message,
                    type: 'error'
                });
            }
        });
    }

    // 编辑按钮
    const editBtn = actions.querySelector('.edit-code');
    if (editBtn) {
        editBtn.addEventListener('click', async () => {
            try {
                const messageEl = pre.closest('.message');
                if (!messageEl) {
                    console.error('[编辑代码] 找不到消息元素');
                    return;
                }

                // 动态导入编辑器模块
                const { openCodeEditorModal } = await import('../ui/code-editor-modal.js');

                // 🔧 从DOM读取最新代码
                const { code, language: lang } = getCurrentCode();

                openCodeEditorModal(code, lang, (newCode, newLanguage) => {
                    updateCodeBlockInMessage(messageEl, pre, newCode, newLanguage);
                });
            } catch (_error) {
                console.error('[编辑代码] 错误:', _error);
                eventBus.emit('ui:notification', {
                    message: '打开编辑器失败: ' + _error.message,
                    type: 'error'
                });
            }
        });
    }
}

/**
 * 下载代码为文件
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 */
function downloadCodeAsFile(code, language) {
    const extensions = {
        javascript: 'js',
        typescript: 'ts',
        python: 'py',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        csharp: 'cs',
        go: 'go',
        rust: 'rs',
        php: 'php',
        ruby: 'rb',
        bash: 'sh',
        sql: 'sql',
        html: 'html',
        css: 'css',
        json: 'json',
        yaml: 'yaml',
        markdown: 'md',
        text: 'txt'
    };

    const ext = extensions[language] || 'txt';
    const filename = `code-${Date.now()}.${ext}`;

    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    eventBus.emit('ui:notification', {
        message: `已下载为 ${filename}`,
        type: 'success'
    });
}

// ========== 代码块内容更新功能 ==========

/**
 * 更新消息中的代码块
 * @param {HTMLElement} messageEl - 消息元素
 * @param {HTMLElement} pre - pre元素
 * @param {string} newCode - 新代码
 * @param {string} newLanguage - 新语言
 */
export function updateCodeBlockInMessage(messageEl, pre, newCode, newLanguage) {
    // 获取消息索引
    const index = Array.from(elements.messagesArea.children).indexOf(messageEl);
    if (index === -1) {
        console.error('[更新代码块] 找不到消息索引');
        return;
    }

    // 获取原始 Markdown
    let originalMarkdown = getMessageMarkdown(index);
    if (!originalMarkdown) {
        console.error('[更新代码块] 找不到原始 Markdown');
        return;
    }

    // 定位代码块在 Markdown 中的位置
    const codeBlocks = originalMarkdown.match(/```[\s\S]*?```/g) || [];
    const preIndex = getCodeBlockIndex(messageEl, pre);

    if (preIndex >= 0 && preIndex < codeBlocks.length) {
        const oldBlock = codeBlocks[preIndex];
        const newBlock = `\`\`\`${newLanguage}\n${newCode}\n\`\`\``;
        originalMarkdown = originalMarkdown.replace(oldBlock, newBlock);

        // 更新状态（同步三种格式）
        updateMessageMarkdown(index, originalMarkdown);

        // 精确更新：只更新被编辑的代码块，而不是重新渲染整个消息
        updateSingleCodeBlock(pre, newCode, newLanguage);

        // 发出保存事件，触发会话自动保存
        eventBus.emit('messages:changed', {
            action: 'code_block_updated',
            index
        });
    }
}

/**
 * 更新单个代码块的内容（不触发重新增强）
 * @param {HTMLElement} pre - pre元素
 * @param {string} newCode - 新代码
 * @param {string} newLanguage - 新语言
 */
function updateSingleCodeBlock(pre, newCode, newLanguage) {
    // 检查是否是折叠的代码块
    const isCollapsible = pre.classList.contains('code-block-collapsible');

    if (isCollapsible) {
        // 更新折叠卡片中的代码
        const contentWrapper = pre.querySelector('.code-collapse-content');
        const codeBlock = contentWrapper?.querySelector('code');

        if (codeBlock) {
            codeBlock.textContent = newCode;
            codeBlock.className = `language-${newLanguage}`;

            // 重新应用语法高亮
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeBlock);
            }
        }

        // 更新语言标签
        const langBadge = pre.querySelector('.code-language-badge');
        if (langBadge) {
            langBadge.textContent = newLanguage.toUpperCase();
        }

        // 更新行数
        const lineCount = newCode.split('\n').length;
        const lineCountSpan = pre.querySelector('.code-line-count');
        if (lineCountSpan) {
            lineCountSpan.textContent = `${lineCount} 行`;
        }
    } else {
        // 普通代码块，更新代码内容
        const codeBlock = pre.querySelector('code');
        if (codeBlock) {
            codeBlock.textContent = newCode;
            codeBlock.className = `language-${newLanguage}`;

            // 重新应用语法高亮
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeBlock);
            }
        }

        // 更新语言选择器
        const langSelector = pre.querySelector('.code-language-selector');
        if (langSelector) {
            langSelector.value = newLanguage;
        }
    }
}

/**
 * 获取代码块在消息中的索引
 */
function getCodeBlockIndex(messageEl, pre) {
    const allPres = messageEl.querySelectorAll('pre');
    return Array.from(allPres).indexOf(pre);
}

/**
 * 获取消息的Markdown文本
 */
function getMessageMarkdown(index) {
    const message = state.messages[index];
    if (!message) return '';

    // 提取文本内容
    if (typeof message.content === 'string') {
        return message.content;
    } else if (Array.isArray(message.content)) {
        const textParts = message.content.filter(p => p.type === 'text');
        return textParts.map(p => p.text).join('\n');
    }

    return '';
}

/**
 * 更新消息的Markdown文本
 */
function updateMessageMarkdown(index, newMarkdown) {
    // OpenAI格式
    if (state.messages[index]) {
        if (typeof state.messages[index].content === 'string') {
            state.messages[index].content = newMarkdown;
        } else if (Array.isArray(state.messages[index].content)) {
            const textPart = state.messages[index].content.find(p => p.type === 'text');
            if (textPart) {
                textPart.text = newMarkdown;
            } else {
                // 如果没有文本部分，添加一个
                state.messages[index].content.push({ type: 'text', text: newMarkdown });
            }
        }
    }

    // Gemini格式
    if (state.geminiContents[index]) {
        const textPart = state.geminiContents[index].parts?.find(p => p.text !== undefined);
        if (textPart) {
            textPart.text = newMarkdown;
        } else if (state.geminiContents[index].parts) {
            state.geminiContents[index].parts.push({ text: newMarkdown });
        }
    }

    // Claude格式
    if (state.claudeContents[index]) {
        if (Array.isArray(state.claudeContents[index].content)) {
            const textPart = state.claudeContents[index].content.find(p => p.type === 'text');
            if (textPart) {
                textPart.text = newMarkdown;
            } else {
                state.claudeContents[index].content.push({ type: 'text', text: newMarkdown });
            }
        } else {
            state.claudeContents[index].content = [{ type: 'text', text: newMarkdown }];
        }
    }

    // 发出保存事件
    eventBus.emit('messages:changed', {
        action: 'updated',
        index
    });
}
