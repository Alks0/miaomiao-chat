/**
 * 输入处理模块
 * 处理用户输入、图片附件、消息发送等
 */

import { state, elements } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { requestStateMachine } from '../core/request-state-machine.js';
import { toOpenAIMessage, toGeminiMessage, toClaudeMessage } from '../messages/converters.js';
import { createMessageElement } from '../messages/renderer.js';
import { removeMessagesAfterAll, updateMessageContentWithImages } from '../messages/editor.js';
import { showNotification } from './notifications.js';
import { generateMessageId } from '../utils/helpers.js';
import { pushMessage } from '../core/state-mutations.js';
import { truncateFileName } from '../utils/file-helpers.js';
import { MAX_ATTACHMENTS, MAX_FILE_SIZE, MAX_MESSAGE_LENGTH, IMAGE_COMPRESSION_TIMEOUT, AUTO_DOCUMENT_TOKEN_THRESHOLD } from '../utils/constants.js';
import { estimateTokenCount } from '../stream/stats.js';
import { renderPdfToImages } from '../utils/pdf.js';

// 支持的文件类型
const SUPPORTED_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    pdf: ['application/pdf'],
    text: ['text/plain', 'text/markdown']
};

// 所有支持的 MIME 类型
const ALL_SUPPORTED_MIMES = [
    ...SUPPORTED_TYPES.image,
    ...SUPPORTED_TYPES.pdf,
    ...SUPPORTED_TYPES.text
];

/**
 * 判断文件类型是否支持
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
function isSupportedFileType(mimeType) {
    return ALL_SUPPORTED_MIMES.includes(mimeType);
}

/**
 * 获取文件类别
 * @param {string} mimeType - MIME 类型
 * @returns {'image'|'pdf'|'text'|'unknown'}
 */
function getFileCategory(mimeType) {
    if (SUPPORTED_TYPES.image.includes(mimeType)) return 'image';
    if (SUPPORTED_TYPES.pdf.includes(mimeType)) return 'pdf';
    if (SUPPORTED_TYPES.text.includes(mimeType)) return 'text';
    return 'unknown';
}

// 引用消息状态
let quotedMessage = null; // { role: 'user'|'assistant', content: '...', preview: '...' }

/**
 * 验证消息长度
 * 防止超长消息导致内存溢出或 API 拒绝
 * @param {string} text - 消息文本
 * @returns {boolean} 是否通过验证
 */
function validateMessageLength(text) {
    if (text.length > MAX_MESSAGE_LENGTH) {
        showNotification(
            `消息过长（${text.length.toLocaleString()} 字符），最大限制 ${MAX_MESSAGE_LENGTH.toLocaleString()} 字符`,
            'error'
        );
        return false;
    }
    return true;
}

/**
 * 处理键盘事件
 * @param {KeyboardEvent} e - 键盘事件
 */
function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
}

/**
 * 自动调整文本框高度
 * 最大高度为视口高度的 50%，最小 168px，最大 500px
 */
export function autoResizeTextarea() {
    const textarea = elements.userInput;
    if (!textarea) return;

    // 动态计算最大高度：视口高度的 50%，但限制在 168-500px 之间
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.max(168, Math.min(viewportHeight * 0.5, 500));

    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
}

/**
 * 处理文件附件
 * 支持图片、PDF、TXT 文件
 */
export function handleAttachFile() {
    // 检查是否已达到附件数量限制
    if (state.uploadedImages.length >= MAX_ATTACHMENTS) {
        showNotification(`最多只能添加 ${MAX_ATTACHMENTS} 个附件`, 'error');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    // 支持图片、PDF、TXT、MD
    input.accept = 'image/*,.pdf,.txt,.md,text/plain,text/markdown,application/pdf';
    input.multiple = true;

    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        const remaining = MAX_ATTACHMENTS - state.uploadedImages.length;

        if (files.length > remaining) {
            showNotification(`只能再添加 ${remaining} 个附件`, 'warning');
        }

        // 只处理剩余可添加数量的文件
        const filesToProcess = files.slice(0, remaining);

        for (const file of filesToProcess) {
            // P1 修复：每次处理文件前重新检查附件上限
            if (state.uploadedImages.length >= MAX_ATTACHMENTS) {
                showNotification(`已达到附件上限 ${MAX_ATTACHMENTS}，跳过剩余文件`, 'warning');
                break;
            }

            // 检查文件大小
            if (file.size > MAX_FILE_SIZE) {
                showNotification(`文件 "${file.name}" 超过 20MB 限制`, 'error');
                continue;
            }

            // 检查文件类型
            let fileType = file.type;
            const category = getFileCategory(fileType);
            if (category === 'unknown') {
                // 尝试通过扩展名判断
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'txt') {
                    fileType = 'text/plain';
                } else if (ext === 'md') {
                    fileType = 'text/markdown';
                } else if (ext === 'pdf') {
                    fileType = 'application/pdf';
                } else {
                    showNotification(`不支持的文件类型: ${file.name}`, 'error');
                    continue;
                }
            }

            const fileCategory = getFileCategory(fileType);

            if (fileCategory === 'text') {
                // TXT/MD：读取为文本（支持 UTF-8）
                const textContent = await fileToText(file);
                state.uploadedImages.push({
                    name: file.name,
                    type: fileType,
                    category: 'text',
                    data: textContent, // 直接存储文本内容，不是 base64
                    size: file.size,
                });
                console.log(`已添加文本文件: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
            } else {
                // 图片和 PDF 使用 base64
                const base64 = await fileToBase64(file);

                if (fileCategory === 'image') {
                    // 图片：保存原图（按需压缩策略：API 报错时自动压缩重试）
                    state.uploadedImages.push({
                        name: file.name,
                        type: fileType,
                        category: 'image',
                        data: base64,
                        size: file.size,
                    });
                    console.log(`已添加图片: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                } else if (fileCategory === 'pdf') {
                    // PDF：根据处理模式决定
                    if (state.pdfMode === 'render') {
                        // 渲染模式：将 PDF 逐页渲染为图片
                        try {
                            // 先检查附件上限，避免白渲染
                            const canAdd = MAX_ATTACHMENTS - state.uploadedImages.length;
                            if (canAdd <= 0) {
                                showNotification(`已达到附件上限，无法添加 PDF 渲染的图片`, 'warning');
                                break;
                            }

                            showNotification(`正在渲染 PDF: ${file.name}...`, 'info');
                            const renderedImages = await renderPdfToImages(base64, {
                                scale: 1.5,
                                format: 'image/jpeg',
                                quality: 0.85,
                                maxPages: Math.min(20, canAdd),
                            });

                            for (const img of renderedImages) {
                                state.uploadedImages.push(img);
                            }

                            if (renderedImages.length === 0) {
                                showNotification(`PDF 渲染未产生有效图片`, 'warning');
                            } else {
                                showNotification(`PDF 已渲染为 ${renderedImages.length} 张图片`, 'success');
                            }
                            console.log(`已渲染 PDF: ${file.name} → ${renderedImages.length} 张图片`);
                        } catch (err) {
                            console.error('[PDF 渲染失败]', err);
                            showNotification(`PDF 渲染失败: ${err.message}`, 'error');
                        }
                    } else {
                        // 标准模式：直接保存 PDF 原文件
                        state.uploadedImages.push({
                            name: file.name,
                            type: fileType,
                            category: 'pdf',
                            data: base64,
                            size: file.size,
                        });
                        console.log(`已添加 PDF: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                    }
                }
            }
        }
        updateImagePreview();
    };

    input.click();
}

/**
 * 将文件转换为 base64
 * @param {File} file - 文件对象
 * @returns {Promise<string>} Base64 数据 URL
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 读取文本文件内容
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 文本内容
 */
function fileToText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file, 'UTF-8');
    });
}

/**
 * 更新附件预览栏
 * 支持图片、PDF、TXT 文件的预览
 */
export function updateImagePreview() {
    const previewContainer = document.getElementById('image-preview-container');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';

    if (state.uploadedImages.length === 0) {
        previewContainer.classList.remove('has-images');
        // 模块化版本额外功能：更新引用预览样式
        updateQuotePreviewStyle();
        return;
    }

    previewContainer.classList.add('has-images');

    state.uploadedImages.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'image-preview-item';

        const category = file.category || getFileCategory(file.type);

        if (category === 'image') {
            // 图片预览
            const displayUrl = file.compressed || file.data;
            previewItem.innerHTML = `
                <img src="${displayUrl}" alt="${file.name}" title="点击查看大图">
                <button class="remove-image" data-index="${index}" title="移除">×</button>
            `;
            // 点击图片查看原图
            previewItem.querySelector('img').onclick = () => eventBus.emit('ui:open-image-viewer', { url: file.data });
        } else if (category === 'pdf') {
            // PDF 预览（显示图标和文件名）
            const sizeStr = file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : '';
            previewItem.className = 'image-preview-item file-preview-item';
            previewItem.innerHTML = `
                <div class="file-preview-icon pdf-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <path d="M10 12h4"/>
                        <path d="M10 16h4"/>
                    </svg>
                </div>
                <div class="file-preview-info">
                    <span class="file-name" title="${file.name}">${truncateFileName(file.name, 15)}</span>
                    <span class="file-size">${sizeStr}</span>
                </div>
                <button class="remove-image" data-index="${index}" title="移除">×</button>
            `;
        } else if (category === 'text') {
            // TXT/MD 预览（显示图标和文件名）
            const sizeStr = file.size ? `${(file.size / 1024).toFixed(2)} KB` : '';
            const isMarkdown = file.type === 'text/markdown' || file.name.endsWith('.md');
            const iconClass = isMarkdown ? 'md-icon' : 'txt-icon';
            const isAutoConverted = file.isAutoConverted || false;
            previewItem.className = 'image-preview-item file-preview-item';
            previewItem.innerHTML = `
                <div class="file-preview-icon ${iconClass}">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    ${isAutoConverted ? '<span class="auto-convert-badge" title="超长文本已自动转换为文档">自动</span>' : ''}
                </div>
                <div class="file-preview-info">
                    <span class="file-name" title="${file.name}">${truncateFileName(file.name, 15)}</span>
                    <span class="file-size">${sizeStr}${isAutoConverted ? ' (自动转换)' : ''}</span>
                </div>
                <button class="remove-image" data-index="${index}" title="移除">×</button>
            `;
        }

        // 删除按钮事件
        previewItem.querySelector('.remove-image').onclick = (e) => {
            e.stopPropagation();
            state.uploadedImages.splice(index, 1);
            updateImagePreview();
        };

        previewContainer.appendChild(previewItem);
    });

    // 模块化版本额外功能：更新引用预览样式
    updateQuotePreviewStyle();
}

/**
 * 更新用户消息 DOM
 * @param {HTMLElement} messageEl - 消息元素
 * @param {string} text - 文本内容
 * @param {Array} images - 图片数组
 */
function updateUserMessageDOM(messageEl, text, images = null) {
    const contentWrapper = messageEl.querySelector('.message-content-wrapper');
    const contentDiv = contentWrapper?.querySelector('.message-content');
    if (!contentDiv) return;

    contentDiv.textContent = text;

    const oldImages = contentDiv.querySelector('.message-images');
    if (oldImages) oldImages.remove();

    if (images && images.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'message-images';
        images.forEach(img => {
            const imgEl = document.createElement('img');
            imgEl.src = img.data;
            imgEl.alt = img.name;
            imgEl.title = '点击查看大图';
            imgEl.onclick = () => {
                eventBus.emit('ui:open-image-viewer', { url: img.data });
            };
            imagesContainer.appendChild(imgEl);
        });
        contentDiv.appendChild(imagesContainer);
    }
}

/**
 * 更新编辑按钮的显示状态（保存和取消）
 */
function updateCancelEditButton() {
    console.log('[input.js] updateCancelEditButton 被调用, state.editingIndex =', state.editingIndex);

    const cancelBtn = document.getElementById('cancel-edit');
    const saveBtn = document.getElementById('save-edit');
    const sendBtn = document.getElementById('send-button');

    // 防御性检查：确保所有按钮都存在
    if (!cancelBtn || !saveBtn || !sendBtn) {
        console.error('[ERROR] 编辑按钮未找到:', {
            cancelBtn: !!cancelBtn,
            saveBtn: !!saveBtn,
            sendBtn: !!sendBtn
        });
        return;
    }

    if (state.editingIndex !== null) {
        // 编辑模式：显示保存和取消按钮
        console.log('[input.js] 进入编辑模式，显示保存和取消按钮');
        cancelBtn.classList.add('show');
        saveBtn.classList.add('show');

        // 验证按钮是否正确显示
        console.log('[input.js] 按钮 class 列表:', {
            cancelBtn: cancelBtn.className,
            saveBtn: saveBtn.className
        });

        // 更新发送按钮文本为"重新发送"
        sendBtn.title = '重新发送（将删除后续消息）';
        sendBtn.setAttribute('aria-label', '重新发送消息');
    } else {
        // 正常模式：隐藏编辑按钮
        console.log('[input.js] 退出编辑模式，隐藏保存和取消按钮');
        cancelBtn.classList.remove('show');
        saveBtn.classList.remove('show');

        // 恢复发送按钮文本
        sendBtn.title = '发送';
        sendBtn.setAttribute('aria-label', '发送消息');
    }
}

/**
 * 取消编辑
 */
function cancelEdit() {
    if (state.editingIndex === null) return;

    // 清空输入框
    elements.userInput.value = '';
    autoResizeTextarea();
    state.uploadedImages = [];
    updateImagePreview();

    // 重置编辑状态
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
        state.editingElement = null;
    }
    state.editingIndex = null;
    updateCancelEditButton();

    showNotification('已取消编辑', 'info');
}

/**
 * 保存编辑（不删除后续消息）
 */
function saveEdit() {
    if (state.editingIndex === null) return;

    const textContent = elements.userInput.value.trim();
    const hasAttachments = state.uploadedImages.length > 0;

    // 验证：至少需要文本或附件
    if (!textContent && !hasAttachments) {
        showNotification('消息不能为空（至少需要文本或附件）', 'warning');
        return;
    }

    // 转换附件格式（从上传的格式转换为消息存储格式）
    // 按需压缩策略：先发送原图，API 报错时自动压缩重试
    const attachmentDataUrls = hasAttachments ? state.uploadedImages.map(file => file.data) : [];
    const originalDataUrls = hasAttachments ? state.uploadedImages.map(file => file.data) : null;
    let messageAttachments = [];

    if (hasAttachments) {
        // 使用统一的转换器处理所有附件类型
        // converters.js 中的函数会根据 MIME 类型自动处理图片/PDF/TXT
        messageAttachments = attachmentDataUrls;
    }

    // 更新消息内容（三种格式同步）
    updateMessageContentWithImages(state.editingIndex, textContent, messageAttachments, 'user');

    // 触发 DOM 更新事件
    if (state.editingElement) {
        eventBus.emit('message:content-updated', {
            messageEl: state.editingElement,
            index: state.editingIndex,
            newContent: textContent,
            role: 'user'
        });
    }

    // 清空输入框
    elements.userInput.value = '';
    autoResizeTextarea();
    state.uploadedImages = [];
    updateImagePreview();

    // 重置编辑状态
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
        state.editingElement = null;
    }
    state.editingIndex = null;
    updateCancelEditButton();

    showNotification('消息已保存', 'success');
}

/**
 * 设置引用消息
 * @param {string} role - 消息角色（user/assistant）
 * @param {string} content - 消息内容（纯文本）
 */
function setQuotedMessage(role, content) {
    // 生成预览文本（最多 100 字符）
    const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;

    quotedMessage = {
        role,
        content,
        preview
    };

    renderQuotePreview();
}

/**
 * 清除引用消息
 */
function clearQuotedMessage() {
    quotedMessage = null;
    removeQuotePreview();
}

/**
 * 渲染引用预览 UI
 */
function renderQuotePreview() {
    if (!quotedMessage) return;

    // 检查是否已存在预览区域
    let quotePreview = document.getElementById('quote-preview');

    if (!quotePreview) {
        // 创建引用预览容器
        quotePreview = document.createElement('div');
        quotePreview.id = 'quote-preview';
        quotePreview.className = 'quote-preview';

        // 插入到输入栏上方（在 image-preview 之后，resize-handle 之前）
        const inputBar = document.querySelector('.input-bar');
        const resizeHandle = document.getElementById('input-resize-handle');
        if (inputBar && resizeHandle) {
            inputBar.insertBefore(quotePreview, resizeHandle);
        }
    }

    // 设置内容
    const roleLabel = quotedMessage.role === 'user' ? '用户' : 'AI';
    quotePreview.innerHTML = `
        <div class="quote-preview-content">
            <svg class="quote-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
            </svg>
            <div class="quote-preview-text">
                <span class="quote-preview-label">回复 <strong>${roleLabel}</strong>:</span>
                <span class="quote-preview-message">${quotedMessage.preview}</span>
            </div>
        </div>
        <button class="quote-preview-close" aria-label="取消引用" title="取消引用">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;

    // 绑定关闭按钮
    const closeBtn = quotePreview.querySelector('.quote-preview-close');
    closeBtn.onclick = clearQuotedMessage;

    // 根据是否有图片预览，动态调整样式
    updateQuotePreviewStyle();

    // 聚焦输入框
    elements.userInput?.focus();
}

/**
 * 更新引用预览样式（根据是否有图片）
 */
function updateQuotePreviewStyle() {
    const quotePreview = document.getElementById('quote-preview');
    const imagePreview = document.getElementById('image-preview-container');

    if (quotePreview) {
        // 如果有图片预览，移除 standalone 类；否则添加
        const hasImages = imagePreview?.classList.contains('has-images');
        if (hasImages) {
            quotePreview.classList.remove('standalone');
        } else {
            quotePreview.classList.add('standalone');
        }
    }
}

/**
 * 移除引用预览 UI
 */
function removeQuotePreview() {
    const quotePreview = document.getElementById('quote-preview');
    if (quotePreview) {
        quotePreview.remove();
    }
}

/**
 * 处理消息发送
 */
export async function handleSend() {
    console.log('[input.js] handleSend 被调用, 状态机:', requestStateMachine.getState());

    let textContent = elements.userInput.value.trim();
    let hasAttachments = state.uploadedImages.length > 0;
    const isEditing = state.editingIndex !== null;

    if (!textContent && !hasAttachments) {
        console.log('[input.js] handleSend 被阻止: 没有文本或附件');
        return;
    }

    // 使用状态机检查是否正忙
    if (requestStateMachine.isBusy()) {
        console.log('[input.js] handleSend 被阻止: 请求正在进行中, 当前状态:', requestStateMachine.getState());
        return;
    }

    // 如果有引用消息，添加引用上下文
    if (quotedMessage && !isEditing) {
        const roleLabel = quotedMessage.role === 'user' ? '用户' : 'AI';
        const quotedText = quotedMessage.content;

        // 格式化引用内容（Markdown 引用语法）
        const quotePrefix = `> **@${roleLabel}**: ${quotedText}\n\n`;
        textContent = quotePrefix + textContent;
    }

    // 验证消息长度
    if (!validateMessageLength(textContent)) {
        return;
    }

    // 检查 token 数量，超过阈值自动转换为文档
    if (textContent) {
        const tokenCount = estimateTokenCount(textContent);
        console.log(`[input.js] 消息 token 数: ${tokenCount}`);

        if (tokenCount > AUTO_DOCUMENT_TOKEN_THRESHOLD) {
            console.log(`[input.js] Token 数超过 ${AUTO_DOCUMENT_TOKEN_THRESHOLD}，自动转换为文档附件`);

            // 检查附件数量限制
            if (state.uploadedImages.length >= MAX_ATTACHMENTS) {
                showNotification(`文本过长（约 ${tokenCount} tokens），但已达到最大附件数量限制`, 'error');
                return;
            }

            // 生成文档文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `auto-document-${timestamp}.txt`;

            // 将文本转换为文档附件
            state.uploadedImages.push({
                name: fileName,
                type: 'text/plain',
                category: 'text',
                data: textContent,  // 直接存储文本内容
                size: new Blob([textContent]).size,
                isAutoConverted: true  // 标记为自动转换
            });

            // 清空输入框文本，因为已转换为附件
            textContent = '';
            elements.userInput.value = '';
            autoResizeTextarea();
            hasAttachments = true;

            // 更新附件预览
            updateImagePreview();

            // 显示通知
            showNotification(`文本过长（约 ${tokenCount} tokens），已自动转换为文档附件`, 'info');
        }
    }

    // 构建三种格式的用户消息
    // 按需压缩策略：先发送原图，API 报错时自动压缩重试
    const attachmentDataUrls = hasAttachments ? state.uploadedImages.map(file => file.data) : null;
    const originalDataUrls = hasAttachments ? state.uploadedImages.map(file => file.data) : null;

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // OpenAI 格式
    const openaiMessage = toOpenAIMessage('user', textContent, attachmentDataUrls);
    openaiMessage.id = messageId;
    // 保存原始数据 URL 引用（用于下载）
    if (originalDataUrls) {
        openaiMessage.originalImageUrls = originalDataUrls;
    }

    // Gemini 格式
    const geminiMessage = toGeminiMessage('user', textContent, attachmentDataUrls);
    geminiMessage.id = messageId;
    // 保存原始数据 URL 引用（用于下载）
    if (originalDataUrls) {
        geminiMessage.originalImageUrls = originalDataUrls;
    }

    // Claude 格式
    const claudeMessage = toClaudeMessage('user', textContent, attachmentDataUrls);
    claudeMessage.id = messageId;
    // 保存原始数据 URL 引用（用于下载）
    if (originalDataUrls) {
        claudeMessage.originalImageUrls = originalDataUrls;
    }

    // 保存用户消息到历史栈（支持多级撤销）
    const userMsg = state.apiFormat === 'gemini' ? geminiMessage : openaiMessage;
    state.lastUserMessage = userMsg; // 向后兼容
    state.messageHistory.push({
        openai: openaiMessage,
        gemini: geminiMessage,
        claude: claudeMessage,
        timestamp: Date.now()
    });
    // 限制历史记录大小
    if (state.messageHistory.length > state.maxHistorySize) {
        state.messageHistory.shift();
    }

    if (isEditing) {
        const targetIndex = state.editingIndex;

        // 更新所有三种格式
        if (state.messages[targetIndex]) {
            state.messages[targetIndex] = openaiMessage;
        }
        if (state.geminiContents[targetIndex]) {
            state.geminiContents[targetIndex] = geminiMessage;
        }
        if (state.claudeContents[targetIndex]) {
            state.claudeContents[targetIndex] = claudeMessage;
        }

        if (state.editingElement) {
            updateUserMessageDOM(state.editingElement, textContent, hasAttachments ? state.uploadedImages : null);
        }

        // 移除编辑位置之后的所有消息（所有格式）
        removeMessagesAfterAll(targetIndex);
    } else {
        // 使用安全的状态更新函数推送消息
        pushMessage(openaiMessage, geminiMessage, claudeMessage);

        const messageIndex = state.messages.length - 1;
        // 传递 messageId 到 DOM 元素
        const messageEl = createMessageElement('user', textContent, hasAttachments ? state.uploadedImages : null, messageId);
        elements.messagesArea.appendChild(messageEl);
        if (messageEl) {
            messageEl.dataset.messageIndex = messageIndex; // 向后兼容，保留索引
        }
    }

    // 清空输入
    elements.userInput.value = '';
    autoResizeTextarea();
    state.uploadedImages = [];
    updateImagePreview();

    // 清除引用消息
    clearQuotedMessage();

    // 重置编辑状态
    state.editingIndex = null;
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
        state.editingElement = null;
    }
    updateCancelEditButton();

    // 滚动到底部
    eventBus.emit('ui:scroll-to-bottom');

    // 发出事件通知会话保存
    eventBus.emit('messages:changed', {
        action: 'user_sent',
        index: state.messages.length - 1
    });

    // 发送到 API
    eventBus.emit('api:send-requested');
}

/**
 * 处理粘贴事件（支持粘贴图片和检测超长文本）
 * @param {ClipboardEvent} e - 粘贴事件
 */
async function handlePaste(e) {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 检查是否有图片
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length === 0) {
        // 没有图片，检查文本长度
        const pastedText = clipboardData.getData('text/plain');
        if (pastedText) {
            // 使用 setTimeout 让默认粘贴行为先执行，然后检查总长度
            setTimeout(() => {
                const fullText = elements.userInput.value;
                const tokenCount = estimateTokenCount(fullText);

                if (tokenCount > AUTO_DOCUMENT_TOKEN_THRESHOLD) {
                    showNotification(
                        `粘贴的内容过长（约 ${tokenCount} tokens），发送时将自动转换为文档附件`,
                        'info'
                    );
                }
            }, 0);
        }
        return; // 使用默认粘贴行为
    }

    // 阻止默认粘贴行为（避免粘贴图片 URL 或文件名）
    e.preventDefault();

    // 检查是否已达到附件数量限制
    if (state.uploadedImages.length >= MAX_ATTACHMENTS) {
        showNotification(`最多只能添加 ${MAX_ATTACHMENTS} 个附件`, 'error');
        return;
    }

    const remaining = MAX_ATTACHMENTS - state.uploadedImages.length;
    const itemsToProcess = imageItems.slice(0, remaining);

    if (imageItems.length > remaining) {
        showNotification(`只能再添加 ${remaining} 个附件`, 'warning');
    }

    for (const item of itemsToProcess) {
        const file = item.getAsFile();
        if (!file) continue;

        try {
            const base64 = await fileToBase64(file);

            // 生成文件名（粘贴的图片通常没有文件名）
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `pasted-image-${timestamp}.${file.type.split('/')[1] || 'png'}`;

            // 保存原图（按需压缩策略：API 报错时自动压缩重试）
            state.uploadedImages.push({
                name: fileName,
                type: file.type,
                category: 'image',
                data: base64,
                size: file.size,
            });

            console.log(`[Input] 已粘贴图片: ${fileName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        } catch (error) {
            console.error('[Input] 处理粘贴图片失败:', error);
            showNotification('粘贴图片失败', 'error');
        }
    }

    updateImagePreview();
    showNotification(`已粘贴 ${itemsToProcess.length} 张图片`, 'success');
}

/**
 * 初始化输入处理器
 */
export function initInputHandlers() {
    // 绑定事件
    elements.sendButton?.addEventListener('click', handleSend);
    elements.userInput?.addEventListener('keydown', handleKeyDown);
    elements.userInput?.addEventListener('input', autoResizeTextarea);
    elements.attachFile?.addEventListener('click', handleAttachFile);

    // 支持粘贴图片
    elements.userInput?.addEventListener('paste', handlePaste);

    // 绑定取消请求按钮
    elements.cancelRequestButton?.addEventListener('click', () => {
        eventBus.emit('api:cancel-requested');
    });

    // 取消编辑按钮
    const cancelBtn = document.getElementById('cancel-edit');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelEdit);
    }

    // 图片删除事件改为直接绑定（在 updateImagePreview() 中处理）

    // 字数统计、token计算和typing效果
    let tokenCountTimeout = null;
    elements.userInput?.addEventListener('input', (e) => {
        const text = e.target.value;
        const length = text.length;

        // 更新字数统计和token计算
        if (elements.charCounter) {
            if (length > 0) {
                // 立即显示字符数
                elements.charCounter.textContent = `${length}`;

                // 使用防抖计算token数，避免输入时卡顿
                clearTimeout(tokenCountTimeout);
                tokenCountTimeout = setTimeout(() => {
                    const tokenCount = estimateTokenCount(text);
                    elements.charCounter.textContent = `${length} 字符 / ${tokenCount} tokens`;

                    // 如果接近或超过阈值，添加警告样式
                    if (tokenCount > AUTO_DOCUMENT_TOKEN_THRESHOLD * 0.9) {
                        elements.charCounter.style.color = 'var(--md-warning)';
                        elements.charCounter.title = `接近自动转换阈值 (${AUTO_DOCUMENT_TOKEN_THRESHOLD} tokens)`;
                    } else {
                        elements.charCounter.style.color = '';
                        elements.charCounter.title = '';
                    }
                }, 300); // 300ms防抖延迟
            } else {
                elements.charCounter.textContent = '';
                elements.charCounter.style.color = '';
                elements.charCounter.title = '';
            }
        }

        // 添加/移除 typing 类
        if (length > 0) {
            elements.inputBarInner?.classList.add('typing');
        } else {
            elements.inputBarInner?.classList.remove('typing');
        }
    });

    // 监听编辑模式变化
    eventBus.on('editor:mode-changed', ({ isEditing }) => {
        updateCancelEditButton();
    });

    // 监听引用消息请求
    eventBus.on('message:quote-requested', ({ messageEl, role, content }) => {
        // 提取消息的纯文本内容
        const contentDiv = messageEl.querySelector('.message-content');
        if (!contentDiv) return;

        // 获取纯文本（去除 HTML 标签）
        let textContent = contentDiv.textContent || contentDiv.innerText || '';
        textContent = textContent.trim();

        // 如果内容为空，不处理
        if (!textContent) {
            showNotification('无法引用空消息', 'warning');
            return;
        }

        // 限制引用内容长度（避免过长）
        const MAX_QUOTE_LENGTH = 500;
        if (textContent.length > MAX_QUOTE_LENGTH) {
            textContent = textContent.substring(0, MAX_QUOTE_LENGTH) + '...';
        }

        // 设置引用消息
        setQuotedMessage(role, textContent);

        showNotification('已添加引用', 'success');
    });

    // 监听会话切换时的按钮重置事件
    eventBus.on('ui:reset-input-buttons', () => {
        console.log('[input.js] 收到 ui:reset-input-buttons 事件');
        // 如果状态机显示正忙，强制重置
        if (requestStateMachine.isBusy()) {
            console.warn('[input.js] 状态机显示正忙，强制重置');
            requestStateMachine.forceReset();
        } else {
            // 正常重置 UI
            if (elements.sendButton) {
                elements.sendButton.disabled = false;
                elements.sendButton.style.display = 'inline-flex';
            }
            if (elements.cancelRequestButton) {
                elements.cancelRequestButton.style.display = 'none';
            }
        }
    });

    // 监听显示取消按钮事件（恢复后台任务时）
    eventBus.on('ui:show-cancel-button', () => {
        if (elements.sendButton) {
            elements.sendButton.style.display = 'none';
        }
        if (elements.cancelRequestButton) {
            elements.cancelRequestButton.style.display = 'inline-flex';
        }
    });

    // 监听更新图片预览事件（切换会话时清空）
    eventBus.on('ui:update-image-preview', () => {
        updateImagePreview();
        // 同时清除引用消息
        clearQuotedMessage();
    });

    // 暴露到全局作用域（用于 HTML onclick）
    window.cancelEdit = cancelEdit;
    window.saveEdit = saveEdit;

    // 全局按钮状态检测器（每10秒检测一次状态一致性）
    setInterval(() => {
        const isBusy = requestStateMachine.isBusy();
        const sendButtonDisabled = elements.sendButton?.disabled;
        const cancelButtonVisible = elements.cancelRequestButton?.style.display === 'inline-flex';

        // 检测状态不一致
        if (!isBusy && (sendButtonDisabled || cancelButtonVisible)) {
            console.warn('[按钮状态修复] 检测到状态不一致，强制修复');
            console.warn('[按钮状态修复] 状态机:', requestStateMachine.getState());
            console.warn('[按钮状态修复] UI:', { sendButtonDisabled, cancelButtonVisible });

            requestStateMachine.forceReset();
        }
    }, IMAGE_COMPRESSION_TIMEOUT);

    console.log('Input handlers initialized');
}
