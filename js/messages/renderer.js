/**
 * 消息渲染模块
 * 负责创建和渲染消息 DOM 元素
 * 注意：编辑/删除操作通过事件触发，避免循环依赖
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { safeMarkedParse } from '../utils/markdown.js';
import { generateMessageId } from '../utils/helpers.js';
import { getCurrentModelCapabilities } from '../providers/manager.js';
import { renderCapabilityBadgesText } from '../utils/capability-badges.js';

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
export function createMessageElement(role, content, images = null, messageId = null, modelName = null, providerName = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    // ✅ 设置唯一消息ID（如果提供）
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
    if (role === 'assistant' && (modelName || providerName)) {
        const modelBadge = document.createElement('div');
        modelBadge.className = 'message-model-badge';

        // 获取当前模型的能力配置
        const capabilities = getCurrentModelCapabilities();
        const badgesText = renderCapabilityBadgesText(capabilities);

        // 在模型名称后添加能力徽章
        const badgeText = [modelName + badgesText, providerName].filter(Boolean).join(' | ');
        modelBadge.textContent = badgeText;
        modelBadge.title = `模型: ${modelName || '未知'}\n提供商: ${providerName || '未知'}`;

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

    // 添加图片（用户消息）
    if (images && images.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'message-images';
        images.forEach(img => {
            const imgEl = document.createElement('img');
            // ✅ 显示压缩图（如果有），否则显示原图
            imgEl.src = img.compressed || img.data;
            imgEl.alt = img.name;
            imgEl.title = '点击查看大图';
            imgEl.onclick = () => {
                // ✅ 查看原图（不是压缩图）
                eventBus.emit('ui:open-image-viewer', { url: img.data });
            };
            imagesContainer.appendChild(imgEl);
        });
        contentDiv.appendChild(imagesContainer);
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
    const reply = replies[selectedIndex];
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

        // ✅ 修复1: 优先渲染 contentParts (包含图片)
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
                    // ✅ 修复：添加 filename 参数，避免触发 window.open 跳转
                    const match = img.src.match(/^data:image\/(\w+);/);
                    const ext = match ? match[1] : 'png';
                    window.downloadImage(img.src, `image-${Date.now()}.${ext}`);
                }
            };
        }
    });
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
            const imgData = inlineData.data;
            const ext = mimeType.split('/')[1] || 'png';
            const dataUrl = `data:${mimeType};base64,${imgData}`;
            // ✅ 使用内联 onclick（与 helpers.js 保持一致，确保事件可靠）
            html += `<div class="image-wrapper">
                <img src="${dataUrl}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${dataUrl}')" style="cursor:pointer;">
                <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${dataUrl}', 'image-${Date.now()}.${ext}')" title="下载原图">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                </button>
            </div>`;
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
            } else if (part.type === 'image_url' && part.image_url?.url) {
                const url = part.image_url.url;
                const match = url.match(/^data:image\/(\w+);/);
                const ext = match ? match[1] : 'png';
                // ✅ 使用内联 onclick（与 helpers.js 保持一致，确保事件可靠）
                html += `<div class="image-wrapper">
                    <img src="${url}" alt="Generated image" title="点击查看大图" onclick="openImageViewer('${url}')" style="cursor:pointer;">
                    <button type="button" class="download-image-btn" onclick="event.stopPropagation();downloadImage('${url}', 'image-${Date.now()}.${ext}')" title="下载原图">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                    </button>
                </div>`;
            }
        }
        return html;
    } else {
        return safeMarkedParse(content);
    }
}

/**
 * ✅ 新增: 渲染 contentParts 数组（包含文本、图片和思维链）
 * @param {Array} contentParts - 内容部分数组
 * @returns {string} HTML字符串
 */
export function renderContentParts(contentParts) {
    let html = '';
    for (const part of contentParts) {
        if (part.type === 'thinking') {
            // ✅ 支持 inline thinking
            html += renderThinkingBlock(part.text, false);
        } else if (part.type === 'text') {
            html += safeMarkedParse(part.text);
        } else if (part.type === 'image_url' && part.complete && part.url) {
            const match = part.url.match(/^data:image\/(\w+);/);
            const ext = match ? match[1] : 'png';
            // ✅ 使用内联 onclick（与 helpers.js 保持一致，确保事件可靠）
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
    return html;
}

// ✅ 思维链块分隔符（常量化，便于维护）
const THINKING_BLOCK_SEPARATOR = '\n\n---\n\n';

/**
 * 渲染思维链块（支持多块分段显示）
 *
 * ✅ **多思考块支持**：
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

    // ✅ 使用常量分隔符，提高可维护性
    const blocks = thinkingContent.split(THINKING_BLOCK_SEPARATOR).filter(b => b.trim());

    if (blocks.length <= 1) {
        // 单个思考块
        return renderSingleThinkingBlock(thinkingContent, '思考过程', streamingClass);
    }

    // ✅ 多个思考块，使用更清晰的标签命名
    return blocks.map((block, index) => {
        const label = `思考阶段 ${index + 1}`;
        const isLast = index === blocks.length - 1;
        return renderSingleThinkingBlock(block, label, isLast ? streamingClass : '');
    }).join('');
}

/**
 * 渲染单个思维链块
 */
function renderSingleThinkingBlock(content, label, streamingClass = '') {
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
            <div class="thinking-content">
                ${safeMarkedParse(content || '')}
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
 * ✅ 智能语言检测 + 手动切换功能
 * @param {HTMLElement} container - 容器元素（可选，默认处理整个消息区域）
 */
export function enhanceCodeBlocks(container = null) {
    const target = container || elements.messagesArea;
    target.querySelectorAll('pre code').forEach((codeBlock) => {
        const pre = codeBlock.parentElement;

        // 如果已经处理过，跳过
        if (pre.querySelector('.code-block-header')) return;

        // 获取代码内容
        const codeText = codeBlock.textContent;

        // ✅ 智能语言检测
        const languageClass = Array.from(codeBlock.classList).find(cls => cls.startsWith('language-'));
        const hintedLang = languageClass ? languageClass.replace('language-', '') : null;
        const detectedLang = detectCodeLanguage(codeText, hintedLang);

        // 创建头部
        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <select class="code-language-selector" aria-label="选择代码语言">
                <option value="auto" ${!hintedLang || hintedLang === 'text' ? 'selected' : ''}>${detectedLang} (自动)</option>
                <option value="javascript" ${detectedLang === 'javascript' ? 'selected' : ''}>JavaScript</option>
                <option value="typescript" ${detectedLang === 'typescript' ? 'selected' : ''}>TypeScript</option>
                <option value="python" ${detectedLang === 'python' ? 'selected' : ''}>Python</option>
                <option value="java" ${detectedLang === 'java' ? 'selected' : ''}>Java</option>
                <option value="cpp" ${detectedLang === 'cpp' ? 'selected' : ''}>C++</option>
                <option value="c" ${detectedLang === 'c' ? 'selected' : ''}>C</option>
                <option value="csharp" ${detectedLang === 'csharp' ? 'selected' : ''}>C#</option>
                <option value="go" ${detectedLang === 'go' ? 'selected' : ''}>Go</option>
                <option value="rust" ${detectedLang === 'rust' ? 'selected' : ''}>Rust</option>
                <option value="php" ${detectedLang === 'php' ? 'selected' : ''}>PHP</option>
                <option value="ruby" ${detectedLang === 'ruby' ? 'selected' : ''}>Ruby</option>
                <option value="bash" ${detectedLang === 'bash' ? 'selected' : ''}>Bash</option>
                <option value="sql" ${detectedLang === 'sql' ? 'selected' : ''}>SQL</option>
                <option value="html" ${detectedLang === 'html' ? 'selected' : ''}>HTML</option>
                <option value="css" ${detectedLang === 'css' ? 'selected' : ''}>CSS</option>
                <option value="json" ${detectedLang === 'json' ? 'selected' : ''}>JSON</option>
                <option value="yaml" ${detectedLang === 'yaml' ? 'selected' : ''}>YAML</option>
                <option value="markdown" ${detectedLang === 'markdown' ? 'selected' : ''}>Markdown</option>
                <option value="text" ${detectedLang === 'text' ? 'selected' : ''}>Plain Text</option>
            </select>
            <button class="copy-code-btn" aria-label="复制代码">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
                <span>复制</span>
            </button>
        `;

        // 创建内容包装
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'code-block-content';
        const clonedCode = codeBlock.cloneNode(true);
        // 设置初始语言类
        clonedCode.className = `language-${detectedLang}`;
        contentWrapper.appendChild(clonedCode);

        // 重构 pre 元素
        pre.innerHTML = '';
        pre.appendChild(header);
        pre.appendChild(contentWrapper);

        // 绑定复制事件
        const copyBtn = header.querySelector('.copy-code-btn');
        copyBtn.addEventListener('click', () => copyCode(copyBtn, codeText));

        // ✅ 绑定语言切换事件
        const langSelector = header.querySelector('.code-language-selector');
        langSelector.addEventListener('change', (e) => {
            const newLang = e.target.value === 'auto' ? detectedLang : e.target.value;
            const codeEl = contentWrapper.querySelector('code');
            if (codeEl) {
                codeEl.className = `language-${newLang}`;
                // 如果 highlight.js 已加载，重新高亮
                if (typeof hljs !== 'undefined') {
                    hljs.highlightElement(codeEl);
                }
            }
        });
    });

    // ✅ 增强思维链块（折叠/展开功能）
    enhanceThinkingBlocks(target);

    // ✅ 增强表格（导出 CSV、排序）
    enhanceTables(target);

    // ✅ 绑定图片点击事件（查看大图、下载）
    bindImageClickEvents(target);
}

/**
 * 智能检测代码语言
 * ✅ 基于代码特征的启发式检测
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
        } catch (e) {
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
    if (/^[\w-]+:\s*$|^  [\w-]+:\s/m.test(code) && !/[{}[\]]/.test(code)) {
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
 * ✅ 实现缺失的交互功能
 * @param {HTMLElement} container - 容器元素
 */
function enhanceThinkingBlocks(container = null) {
    const target = container || elements.messagesArea;
    target.querySelectorAll('.thinking-header').forEach((header) => {
        // 避免重复绑定
        if (header.dataset.enhanced === 'true') return;
        header.dataset.enhanced = 'true';

        const block = header.closest('.thinking-block');
        if (!block) return;

        // 切换折叠/展开
        const toggleThinking = () => {
            const isCollapsed = block.classList.toggle('collapsed');
            header.setAttribute('aria-expanded', !isCollapsed);

            // 更新图标
            const icon = header.querySelector('.thinking-toggle-icon');
            if (icon) {
                icon.textContent = isCollapsed ? '▶' : '▼';
            }
        };

        // 点击事件
        header.addEventListener('click', toggleThinking);

        // 键盘事件（可访问性）
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
 * ✅ 提升数据表格的可用性
 * @param {HTMLElement} container - 容器元素
 */
function enhanceTables(container = null) {
    const target = container || elements.messagesArea;
    target.querySelectorAll('table').forEach((table) => {
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

        // 绑定导出事件
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

    // 根据当前API格式从state中获取消息数据
    let htmlContent = '';

    if (state.apiFormat === 'gemini') {
        const messageData = state.geminiContents[index];
        if (messageData?.parts) {
            // Gemini格式：parts数组
            messageData.parts.forEach(part => {
                if (part.text !== undefined) {
                    // 文本内容
                    if (role === 'assistant') {
                        htmlContent += safeMarkedParse(part.text);
                    } else {
                        htmlContent += part.text;
                    }
                } else if (part.inlineData || part.inline_data) {
                    // 图片内容
                    const inlineData = part.inlineData || part.inline_data;
                    const mimeType = inlineData.mimeType || inlineData.mime_type;
                    const base64Data = inlineData.data;
                    const imgUrl = `data:${mimeType};base64,${base64Data}`;
                    htmlContent += `<div class="image-wrapper">
                        <img src="${imgUrl}" alt="图片" title="点击查看大图" style="cursor:pointer;">
                    </div>`;
                }
            });
        }
    } else if (state.apiFormat === 'claude') {
        const messageData = state.claudeContents[index];
        if (messageData?.content) {
            if (Array.isArray(messageData.content)) {
                // Claude格式：content数组
                messageData.content.forEach(part => {
                    if (part.type === 'text') {
                        if (role === 'assistant') {
                            htmlContent += safeMarkedParse(part.text || '');
                        } else {
                            htmlContent += part.text || '';
                        }
                    } else if (part.type === 'image' && part.source) {
                        // Claude图片格式
                        const imgUrl = `data:${part.source.media_type};base64,${part.source.data}`;
                        htmlContent += `<div class="image-wrapper">
                            <img src="${imgUrl}" alt="图片" title="点击查看大图" style="cursor:pointer;">
                        </div>`;
                    }
                });
            } else {
                // 纯文本
                if (role === 'assistant') {
                    htmlContent = safeMarkedParse(messageData.content);
                } else {
                    htmlContent = messageData.content;
                }
            }
        }
    } else {
        // OpenAI格式
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
