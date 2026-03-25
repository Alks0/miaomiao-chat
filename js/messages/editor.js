/**
 * 消息编辑模块
 * 处理消息的编辑、删除、重试功能
 * 监听来自 renderer.js 的事件，避免循环依赖
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { removeMessageAt, removeMessagesAfter } from '../core/state-mutations.js';
import { updateImagePreview, autoResizeTextarea } from '../ui/input.js';
import { showConfirmDialog } from '../utils/dialogs.js';
import { canEditMessage, safeDeleteMessage } from '../tools/message-compat.js';
import { clearThoughtSignatures, hasThoughtSignatures } from '../api/format-converter.js';  // thoughtSignature 清理
import { categorizeFile } from '../utils/file-helpers.js';
import { enhanceCodeBlocks } from './renderer.js';

/**
 * 自动调整文本框高度（通用函数）
 * @param {HTMLTextAreaElement} textarea - 文本框元素
 * @param {number} minHeight - 最小高度（默认 60px）
 * @param {number} maxHeight - 最大高度（默认 400px）
 */
function autoResizeGeneric(textarea, minHeight = 60, maxHeight = 400) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';
}

/**
 * 根据消息ID查找索引
 * 优化：使用 messageIdMap 快速查找，避免 O(n) 遍历
 * @param {string} messageId - 消息ID
 * @returns {number} 消息索引，-1 表示未找到
 */
function getMessageIndexById(messageId) {
    if (!messageId) return -1;

    // 优先使用 messageIdMap（O(1) 查找）
    if (state.messageIdMap && state.messageIdMap.has(messageId)) {
        return state.messageIdMap.get(messageId);
    }

    // Fallback：遍历数组查找（向后兼容，防止 map 未同步）
    const messages = state.apiFormat === 'gemini' ? state.geminiContents : state.messages;
    const index = messages.findIndex(msg => msg.id === messageId);

    // 如果找到但 map 中没有，同步到 map
    if (index !== -1 && state.messageIdMap) {
        console.warn(`消息ID ${messageId} 在 map 中缺失，自动同步`);
        state.messageIdMap.set(messageId, index);
    }

    return index;
}

/**
 * 进入编辑模式（将消息加载到输入框）
 * @param {HTMLElement} messageEl - 消息元素
 */
export function enterEditMode(messageEl) {
    // 流式响应中禁止编辑
    if (state.isLoading) {
        eventBus.emit('ui:notification', { message: '请等待回复完成后再编辑', type: 'warning' });
        return;
    }

    console.log('[editor.js] enterEditMode 被调用', { messageEl });
    const targetIndex = resolveMessageIndex(messageEl);
    console.log('[editor.js] targetIndex =', targetIndex);
    if (targetIndex === -1) {
        console.error('[ERROR] 无效的 targetIndex');
        return;
    }

    let message;
    if (state.apiFormat === 'gemini') {
        message = state.geminiContents[targetIndex];
        if (!message || message.role !== 'user') return;
        const { text, images } = parseGeminiUserContent(message.parts);
        elements.userInput.value = text;
        state.uploadedImages = images;
    } else {
        message = state.messages[targetIndex];
        if (!message || message.role !== 'user') return;
        const { text, images } = parseUserContent(message.content);
        elements.userInput.value = text;
        state.uploadedImages = images;
    }

    // 更新编辑状态
    if (state.editingElement) {
        state.editingElement.classList.remove('editing');
    }
    state.editingIndex = targetIndex;
    state.editingElement = messageEl;
    messageEl.classList.add('editing');
    console.log('[editor.js] 编辑状态已更新, state.editingIndex =', state.editingIndex);

    // 🔧 更新图片预览（显示当前消息的图片）
    updateImagePreview();
    console.log('[editor.js] updateImagePreview 已调用');

    // 自动调整输入框高度以适应加载的内容
    autoResizeTextarea();

    // 聚焦输入框
    elements.userInput?.focus();

    // 通知 UI 更新按钮状态
    console.log('[editor.js] 发出 editor:mode-changed 事件');
    eventBus.emit('editor:mode-changed', {
        isEditing: true,
        index: targetIndex
    });
}

/**
 * 原地编辑消息（内联编辑）
 * 保留图片数据，避免编辑后图片丢失
 * @param {HTMLElement} messageEl - 消息元素
 */
export function editMessageInPlace(messageEl) {
    // 流式响应中禁止编辑
    if (state.isLoading) {
        eventBus.emit('ui:notification', { message: '请等待回复完成后再编辑', type: 'warning' });
        return;
    }

    const index = resolveMessageIndex(messageEl);
    if (index === -1) return;

    // 避免重复进入编辑模式
    if (messageEl.classList.contains('editing')) return;

    const role = messageEl.classList.contains('user') ? 'user' : 'assistant';

    // 获取当前内容和图片
    let textContent = '';
    const images = [];
    let thinkingContent = '';  // 思维链内容

    if (state.apiFormat === 'gemini') {
        const message = state.geminiContents[index];
        if (message?.parts) {
            message.parts.forEach(p => {
                if (p.thought && p.text !== undefined) {
                    // Gemini 思维链部分
                    thinkingContent += p.text;
                } else if (p.text !== undefined && !p.thought) {
                    textContent += p.text;
                } else if (p.inlineData || p.inline_data) {
                    images.push(p);
                }
            });
        }
        // Fallback: thinking 可能存在 OpenAI 格式的元数据字段中
        if (!thinkingContent) {
            const openaiMsg = state.messages[index];
            if (openaiMsg?.thinkingContent) {
                thinkingContent = openaiMsg.thinkingContent;
            }
        }
    } else if (state.apiFormat === 'claude') {
        const message = state.claudeContents[index];
        if (message?.content) {
            if (typeof message.content === 'string') {
                textContent = message.content;
            } else if (Array.isArray(message.content)) {
                message.content.forEach(p => {
                    if (p.type === 'thinking' && p.thinking) {
                        // Claude 思维链部分（原生 Claude API 响应）
                        thinkingContent += p.thinking;
                    } else if (p.type === 'text') {
                        textContent += p.text || '';
                    } else if (p.type === 'image' && p.source) {
                        images.push(p);
                    }
                });
            }
        }
        // Fallback: thinking 可能存在元数据字段而非 content 数组中
        if (!thinkingContent && message?.thinkingContent) {
            thinkingContent = message.thinkingContent;
        }
    } else {
        const message = state.messages[index];
        // OpenAI 格式的思维链存储在 thinkingContent 字段
        if (message?.thinkingContent) {
            thinkingContent = message.thinkingContent;
        }
        if (message?.content) {
            if (typeof message.content === 'string') {
                textContent = message.content;
            } else if (Array.isArray(message.content)) {
                message.content.forEach(p => {
                    if (p.type === 'text') {
                        textContent += p.text || '';
                    } else if (p.type === 'image_url' && p.image_url?.url) {
                        images.push(p);
                    }
                });
            }
        }
    }

    const contentDiv = messageEl.querySelector('.message-content');
    if (!contentDiv) return;

    // 创建编辑界面
    const originalHTML = contentDiv.innerHTML;
    contentDiv.innerHTML = '';

    // 图片管理区域（现有图片 + 添加按钮）
    const imageManager = document.createElement('div');
    imageManager.className = 'edit-image-manager';

    // 创建可编辑的图片数组副本
    const editableImages = [...images];

    // 渲染图片预览
    const renderImagePreviews = () => {
        const container = imageManager.querySelector('.edit-images-container') || document.createElement('div');
        container.className = 'edit-images-container';
        container.innerHTML = '';

        editableImages.forEach((img, idx) => {
            const imgPreview = document.createElement('div');
            imgPreview.className = 'edit-image-item';

            // 提取图片 URL（根据格式不同）
            let imgUrl = '';
            if (state.apiFormat === 'gemini') {
                const inlineData = img.inlineData || img.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                imgUrl = `data:${mimeType};base64,${inlineData.data}`;
            } else if (state.apiFormat === 'claude') {
                if (img.source?.type === 'base64') {
                    imgUrl = `data:${img.source.media_type};base64,${img.source.data}`;
                }
            } else {
                imgUrl = img.image_url?.url || img.url || '';
            }

            imgPreview.innerHTML = `
                <img src="${imgUrl}" alt="图片 ${idx + 1}" title="点击查看大图">
                <button class="edit-image-remove" data-index="${idx}" title="删除图片">×</button>
            `;

            // 点击图片放大
            imgPreview.querySelector('img').onclick = () => {
                eventBus.emit('ui:open-image-viewer', { url: imgUrl });
            };

            // 删除图片
            imgPreview.querySelector('.edit-image-remove').onclick = () => {
                editableImages.splice(idx, 1);
                renderImagePreviews();
            };

            container.appendChild(imgPreview);
        });

        // 添加新图片按钮
        const addBtn = document.createElement('button');
        addBtn.className = 'edit-image-add';
        addBtn.title = '添加图片';
        addBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>添加图片</span>
        `;
        addBtn.onclick = () => addNewImage(editableImages, renderImagePreviews);
        container.appendChild(addBtn);

        if (imageManager.querySelector('.edit-images-container')) {
            imageManager.replaceChild(container, imageManager.querySelector('.edit-images-container'));
        } else {
            imageManager.appendChild(container);
        }
    };

    renderImagePreviews();

    // 思维链编辑区域（仅AI消息显示）
    let thinkingTextarea = null;
    if (role === 'assistant') {
        const thinkingSection = document.createElement('div');
        thinkingSection.className = 'edit-thinking-section';

        const thinkingLabel = document.createElement('label');
        thinkingLabel.innerHTML = '💡 思维链内容 <span class="hint">留空则删除思维链</span>';

        thinkingTextarea = document.createElement('textarea');
        thinkingTextarea.className = 'edit-thinking-textarea';
        thinkingTextarea.value = thinkingContent;
        thinkingTextarea.rows = 5;
        thinkingTextarea.placeholder = '留空则删除思维链';

        // 初始化时自动调整高度
        setTimeout(() => autoResizeGeneric(thinkingTextarea, 80, 400), 0);
        thinkingTextarea.addEventListener('input', () => autoResizeGeneric(thinkingTextarea, 80, 400));

        thinkingSection.appendChild(thinkingLabel);
        thinkingSection.appendChild(thinkingTextarea);
        contentDiv.appendChild(thinkingSection);
    }

    // 文本编辑区域
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = textContent;
    textarea.rows = 3;

    // 初始化时自动调整高度
    setTimeout(() => autoResizeGeneric(textarea, 60, 400), 0);
    textarea.addEventListener('input', () => autoResizeGeneric(textarea, 60, 400));

    // 操作按钮
    const editActions = document.createElement('div');
    editActions.className = 'edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '保存';
    saveBtn.onclick = () => {
        const newContent = textarea.value.trim();
        const newThinking = thinkingTextarea?.value.trim() || null;  // 获取思维链

        // 验证：防止保存空消息
        if (!newContent && editableImages.length === 0) {
            eventBus.emit('ui:notification', {
                message: '消息不能为空（至少需要文本或图片）',
                type: 'warning'
            });
            return;
        }

        // 根据是否有思维链选择不同的更新函数
        if (role === 'assistant' && thinkingTextarea) {
            updateMessageWithThinking(index, newContent, newThinking, editableImages, role);
        } else {
            updateMessageContentWithImages(index, newContent, editableImages, role);
        }
        // 重新渲染消息
        eventBus.emit('message:content-updated', { messageEl, index, newContent, role });
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => {
        contentDiv.innerHTML = originalHTML;
        messageEl.classList.remove('editing');
        // 恢复 HTML 后事件监听器丢失，清除所有增强标记并重新绑定
        contentDiv.querySelectorAll('.thinking-header[data-enhanced="true"]').forEach(h => delete h.dataset.enhanced);
        contentDiv.querySelectorAll('.code-block-enhanced').forEach(el => el.classList.remove('code-block-enhanced'));
        contentDiv.querySelectorAll('table[data-enhanced="true"]').forEach(t => delete t.dataset.enhanced);
        enhanceCodeBlocks(contentDiv);
    };

    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);

    // 组装编辑界面
    if (editableImages.length > 0 || role === 'user') {
        contentDiv.appendChild(imageManager);
    }
    contentDiv.appendChild(textarea);
    contentDiv.appendChild(editActions);

    messageEl.classList.add('editing');
    textarea.focus();
}

/**
 * 更新消息内容（同步更新三种格式）
 * @param {number} index - 消息索引
 * @param {string} newContent - 新内容
 * @param {string} role - 角色
 */
export function updateMessageContent(index, newContent, role) {
    // 更新 OpenAI 格式
    if (state.messages[index]) {
        if (Array.isArray(state.messages[index].content)) {
            const textPart = state.messages[index].content.find(p => p.type === 'text');
            if (textPart) textPart.text = newContent;
        } else {
            state.messages[index].content = newContent;
        }
        clearEditMetadata(state.messages[index]);
    }

    // 更新 Gemini 格式
    if (state.geminiContents[index]) {
        const textPart = state.geminiContents[index].parts?.find(p => p.text !== undefined);
        if (textPart) textPart.text = newContent;
        clearEditMetadata(state.geminiContents[index]);
    }

    // 更新 Claude 格式
    if (state.claudeContents[index]) {
        if (Array.isArray(state.claudeContents[index].content)) {
            const textPart = state.claudeContents[index].content.find(p => p.type === 'text');
            if (textPart) textPart.text = newContent;
        } else {
            state.claudeContents[index].content = newContent;
        }
        clearEditMetadata(state.claudeContents[index]);
    }

    // 编辑消息后清除后续 thoughtSignature（所有格式）
    clearSubsequentSignatures(index);

    // 发出事件通知会话保存
    eventBus.emit('messages:changed', {
        action: 'updated',
        index
    });
}

/**
 * 清除编辑消息后续的 thoughtSignature（三种格式统一处理）
 */
function clearSubsequentSignatures(index) {
    if (index >= state.messages.length - 1) return;
    if (!hasThoughtSignatures(state.messages, index + 1)) return;

    const clearedCount = clearThoughtSignatures(state.messages, index + 1);
    clearThoughtSignatures(state.geminiContents, index + 1);
    clearThoughtSignatures(state.claudeContents, index + 1);

    eventBus.emit('ui:notification', {
        message: `编辑消息会影响思维链，已清除 ${clearedCount} 个签名。下次对话将重新生成思维链。`,
        type: 'warning',
        duration: 5000
    });
}

/**
 * 更新消息内容并保留图片（同步更新三种格式）
 * 编辑消息时不会丢失图片数据
 * @param {number} index - 消息索引
 * @param {string} newText - 新文本内容
 * @param {Array} images - 图片数组
 * @param {string} role - 角色
 */
export function updateMessageContentWithImages(index, newText, images, role) {
    const normalized = images.map(normalizeImage).filter(Boolean);
    const hasImages = normalized.length > 0;
    const fmt = hasImages ? buildFormatImages(normalized) : null;

    // 更新 OpenAI 格式
    if (state.messages[index]) {
        state.messages[index].content = hasImages
            ? [{ type: 'text', text: newText }, ...fmt.openai]
            : newText;
        clearEditMetadata(state.messages[index]);
    }

    // 更新 Gemini 格式
    if (state.geminiContents[index]) {
        state.geminiContents[index].parts = hasImages
            ? [{ text: newText }, ...fmt.gemini]
            : [{ text: newText }];
        clearEditMetadata(state.geminiContents[index]);
    }

    // 更新 Claude 格式
    if (state.claudeContents[index]) {
        state.claudeContents[index].content = hasImages
            ? [...fmt.claude, { type: 'text', text: newText }]
            : [{ type: 'text', text: newText }];
        clearEditMetadata(state.claudeContents[index]);
    }

    clearSubsequentSignatures(index);

    eventBus.emit('messages:changed', { action: 'updated', index });
}

/**
 * 删除消息
 * @param {HTMLElement} messageEl - 消息元素
 */
export async function deleteMessage(messageEl) {
    const index = resolveMessageIndex(messageEl);
    if (index === -1) return;

    // 使用自定义确认对话框
    const confirmed = await showConfirmDialog('确定要删除这条消息吗？', '确认删除');
    if (!confirmed) {
        return;
    }

    // 使用工具调用兼容的安全删除（自动处理关联的工具结果消息）
    const result = safeDeleteMessage(index);

    if (!result.success) {
        eventBus.emit('ui:notification', {
            message: result.error || '删除失败',
            type: 'error'
        });
        return;
    }

    // 从 DOM 中移除所有被删除的消息元素
    const allMessages = Array.from(elements.messagesArea.querySelectorAll('.message'));
    result.deletedIndices.forEach(deletedIndex => {
        const elToRemove = allMessages.find(el => {
            const elIndex = parseInt(el.dataset.messageIndex, 10);
            return elIndex === deletedIndex;
        });
        if (elToRemove) {
            elToRemove.remove();
        }
    });

    // 更新剩余消息的索引
    const remainingMessages = elements.messagesArea.querySelectorAll('.message');
    remainingMessages.forEach((el, i) => {
        el.dataset.messageIndex = i;
    });

    // 发出事件通知
    eventBus.emit('messages:changed', {
        action: 'deleted',
        index,
        deletedCount: result.deletedIndices.length
    });

    // 显示删除通知
    const message = result.deletedIndices.length > 1
        ? `已删除 ${result.deletedIndices.length} 条消息`
        : '消息已删除';
    eventBus.emit('ui:notification', { message, type: 'info' });
}

/**
 * 删除指定索引后的所有消息
 * @param {number} index - 起始索引
 */
export function removeMessagesAfterAll(index) {
    // 使用安全的状态更新函数
    removeMessagesAfter(index);

    const nodes = Array.from(elements.messagesArea.querySelectorAll('.message'));
    nodes.forEach(node => {
        const nodeIndex = node.dataset?.messageIndex !== undefined ? parseInt(node.dataset.messageIndex, 10) : NaN;
        if (!Number.isNaN(nodeIndex) && nodeIndex > index) {
            node.remove();
        }
    });

    const targetNode = nodes.find(node => {
        const nodeIndex = node.dataset?.messageIndex !== undefined ? parseInt(node.dataset.messageIndex, 10) : NaN;
        return !Number.isNaN(nodeIndex) && nodeIndex === index;
    });
    if (targetNode) {
        let next = targetNode.nextElementSibling;
        while (next) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }
    }

    const remaining = Array.from(elements.messagesArea.querySelectorAll('.message'));
    remaining.forEach((node, idx) => {
        node.dataset.messageIndex = idx;
    });

    state.currentAssistantMessage = null;

    // 通知会话保存
    eventBus.emit('messages:changed', {
        action: 'removed_after',
        index
    });
}

/**
 * 重试功能（重新生成最后一条助手消息）
 * @param {HTMLElement} messageEl - 消息元素
 */
export async function handleRetry(messageEl) {
    if (state.isLoading) return;

    // 清空当前的多回复状态
    state.currentReplies = [];
    state.selectedReplyIndex = 0;

    // 检查是否有内容可以重试
    if (state.messages.length === 0 && state.geminiContents.length === 0) return;

    // 查找最后一条助手消息
    const allAssistantMsgs = elements.messagesArea.querySelectorAll('.message.assistant');
    const lastAssistantMsg = allAssistantMsgs.length > 0 ? allAssistantMsgs[allAssistantMsgs.length - 1] : null;

    // 移除所有格式的最后一条助手消息
    if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'assistant') {
        state.messages.pop();
    }
    if (state.geminiContents.length > 0 && state.geminiContents[state.geminiContents.length - 1].role === 'model') {
        state.geminiContents.pop();
    }
    if (state.claudeContents.length > 0 && state.claudeContents[state.claudeContents.length - 1].role === 'assistant') {
        state.claudeContents.pop();
    }

    // 删除 DOM
    if (lastAssistantMsg) {
        lastAssistantMsg.remove();
    }

    // 通知会话保存
    eventBus.emit('messages:changed', {
        action: 'retry',
        index: state.messages.length
    });

    // 请求重新发送（由 API 层处理）
    eventBus.emit('api:resend-requested');
}

/**
 * 解析消息索引
 * @param {HTMLElement} messageEl - 消息元素
 * @returns {number} 消息索引，-1 表示未找到
 */
function resolveMessageIndex(messageEl) {
    // 优先使用消息ID查找（稳定且准确）
    const messageId = messageEl.dataset?.messageId;
    if (messageId) {
        const index = getMessageIndexById(messageId);
        if (index !== -1) return index;
        console.warn(`消息ID ${messageId} 未找到，fallback到索引查找`);
    }

    // Fallback 1: 使用 dataset.messageIndex（向后兼容）
    const indexAttr = messageEl.dataset?.messageIndex;
    if (indexAttr !== undefined) {
        const parsed = parseInt(indexAttr, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }

    // Fallback 2: 使用 DOM 位置（最后的手段）
    const nodes = Array.from(elements.messagesArea.querySelectorAll('.message'));
    const domIndex = nodes.indexOf(messageEl);
    return domIndex;
}

/**
 * 获取附件显示名称
 * @param {string} mimeType - MIME 类型
 * @returns {string}
 */
function getAttachmentDisplayName(mimeType) {
    const category = categorizeFile(mimeType);
    if (category === 'image') return '已上传图片';
    if (category === 'pdf') return '已上传PDF';
    if (mimeType === 'text/markdown') return '已上传MD';
    if (category === 'text') return '已上传TXT';
    return '已上传文件';
}

/**
 * 解析 OpenAI/Claude 格式的用户消息内容
 */
function parseUserContent(content) {
    let text = '';
    const attachments = [];

    if (Array.isArray(content)) {
        content.forEach(part => {
            if (part.type === 'text') {
                text += (text ? '\n' : '') + (part.text || '');
            } else if (part.type === 'image_url' && part.image_url?.url) {
                // 图片（OpenAI 格式）
                attachments.push({
                    name: '已上传图片',
                    type: 'image/*',
                    category: 'image',
                    data: part.image_url.url,
                });
            } else if (part.type === 'image' && part.source?.data) {
                // 图片（Claude 格式）
                const mimeType = part.source.media_type || 'image/*';
                attachments.push({
                    name: '已上传图片',
                    type: mimeType,
                    category: 'image',
                    data: `data:${mimeType};base64,${part.source.data}`,
                });
            } else if (part.type === 'file' && part.file?.file_data) {
                // PDF（OpenAI 格式）
                attachments.push({
                    name: part.file.filename || '已上传PDF',
                    type: 'application/pdf',
                    category: 'pdf',
                    data: part.file.file_data,
                });
            } else if (part.type === 'document' && part.source?.data) {
                // PDF（Claude 格式）
                const mimeType = part.source.media_type || 'application/pdf';
                attachments.push({
                    name: '已上传PDF',
                    type: mimeType,
                    category: 'pdf',
                    data: `data:${mimeType};base64,${part.source.data}`,
                });
            }
        });
    } else if (typeof content === 'string') {
        text = content;
    }

    return { text, images: attachments };
}

/**
 * 解析 Gemini 格式的用户消息内容
 */
function parseGeminiUserContent(parts) {
    let text = '';
    const attachments = [];

    if (Array.isArray(parts)) {
        parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData || part.inline_data) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;
                const category = categorizeFile(mimeType);

                attachments.push({
                    name: getAttachmentDisplayName(mimeType),
                    type: mimeType,
                    category,
                    data: `data:${mimeType};base64,${data}`,
                });
            }
        });
    }

    return { text, images: attachments };
}

// ========== 事件监听 ==========

// 监听编辑请求
eventBus.on('message:edit-requested', ({ messageEl }) => {
    // 工具调用兼容性检查
    const index = resolveMessageIndex(messageEl);
    if (index !== -1) {
        const checkResult = canEditMessage(index);
        if (!checkResult.canEdit) {
            // 不可编辑，已由 message-compat.js 发出通知
            return;
        }
    }

    // 根据消息角色选择编辑方式
    const isUser = messageEl.classList.contains('user');
    if (isUser) {
        enterEditMode(messageEl);  // 用户消息：在输入框编辑
    } else {
        editMessageInPlace(messageEl);  // AI消息：原地编辑
    }
});

// 监听删除请求
eventBus.on('message:delete-requested', ({ messageEl }) => {
    deleteMessage(messageEl);
});

// 监听重试请求
eventBus.on('message:retry-requested', ({ messageEl }) => {
    handleRetry(messageEl);
});

/**
 * 从任意格式的图片对象中提取 {mimeType, data} 结构
 * 避免 data URL 字符串的往返拼接/解析
 */
function normalizeImage(img) {
    // OpenAI 格式
    const url = img.image_url?.url || img.url || (typeof img === 'string' ? img : '');
    if (url) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) return { mimeType: match[1], data: match[2], dataUrl: url };
        return { mimeType: '', data: '', dataUrl: url }; // 远程 URL
    }
    // Gemini 格式（直接取结构，无需拼字符串）
    const inlineData = img.inlineData || img.inline_data;
    if (inlineData) {
        const mime = inlineData.mimeType || inlineData.mime_type;
        return { mimeType: mime, data: inlineData.data, dataUrl: `data:${mime};base64,${inlineData.data}` };
    }
    // Claude 格式
    if (img.source?.data) {
        const mime = img.source.media_type;
        return { mimeType: mime, data: img.source.data, dataUrl: `data:${mime};base64,${img.source.data}` };
    }
    return null;
}

/**
 * 将标准化图片数组转为三种格式的内容数组
 * 消除 updateMessageContentWithImages/updateMessageWithThinking 的重复代码
 */
function buildFormatImages(normalizedImages) {
    const openai = normalizedImages.map(n => ({ type: 'image_url', image_url: { url: n.dataUrl } }));
    const gemini = normalizedImages
        .filter(n => n.mimeType && n.data)
        .map(n => ({ inlineData: { mimeType: n.mimeType, data: n.data } }));
    const claude = normalizedImages
        .filter(n => n.mimeType && n.data)
        .map(n => ({ type: 'image', source: { type: 'base64', media_type: n.mimeType, data: n.data } }));
    return { openai, gemini, claude };
}

/**
 * 清除编辑后不再有效的元数据
 * @param {boolean} keepContentParts - 为 true 时保留 contentParts（updateMessageWithThinking 自行管理）
 */
function clearEditMetadata(msg, keepContentParts = false) {
    if (!keepContentParts) delete msg.contentParts;
    delete msg.allReplies;
    delete msg.selectedReplyIndex;
}

/**
 * 添加新图片到编辑中的消息
 * 完整的图片管理功能
 * @param {Array} editableImages - 可编辑的图片数组
 * @param {Function} renderCallback - 渲染回调函数
 */
async function addNewImage(editableImages, renderCallback) {
    // 检查图片数量限制
    const MAX_IMAGES = 10;
    if (editableImages.length >= MAX_IMAGES) {
        eventBus.emit('ui:notification', {
            message: `最多只能添加 ${MAX_IMAGES} 张图片`,
            type: 'error'
        });
        return;
    }

    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            eventBus.emit('ui:notification', {
                message: '请选择有效的图片文件',
                type: 'error'
            });
            return;
        }

        try {
            // 读取文件为 base64
            const base64 = await fileToBase64(file);

            // 根据当前 API 格式创建图片对象
            let imageObj;
            if (state.apiFormat === 'gemini') {
                // Gemini 格式：inlineData
                const base64Data = base64.split(',')[1]; // 移除 data:image/xxx;base64, 前缀
                imageObj = {
                    inlineData: {
                        mimeType: file.type,
                        data: base64Data
                    }
                };
            } else if (state.apiFormat === 'claude') {
                // Claude 格式：source
                const base64Data = base64.split(',')[1];
                imageObj = {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: file.type,
                        data: base64Data
                    }
                };
            } else {
                // OpenAI 格式：image_url
                imageObj = {
                    type: 'image_url',
                    image_url: {
                        url: base64
                    }
                };
            }

            editableImages.push(imageObj);
            renderCallback();

            eventBus.emit('ui:notification', {
                message: '图片已添加',
                type: 'success'
            });
        } catch (error) {
            console.error('添加图片失败:', error);
            eventBus.emit('ui:notification', {
                message: '添加图片失败',
                type: 'error'
            });
        }
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
 * 更新消息内容（支持思维链编辑）
 * 同步更新三种格式，并清除签名
 * @param {number} index - 消息索引
 * @param {string} newText - 新文本内容
 * @param {string|null} newThinking - 新思维链内容
 * @param {Array} images - 图片数组
 * @param {string} role - 角色
 */
export function updateMessageWithThinking(index, newText, newThinking, images, role) {
    const normalized = images.map(normalizeImage).filter(Boolean);
    const hasImages = normalized.length > 0;
    const fmt = hasImages ? buildFormatImages(normalized) : null;

    // 构建 contentParts（用于渲染）
    const contentParts = [];
    if (newThinking) {
        contentParts.push({ type: 'thinking', text: newThinking });
    }
    contentParts.push({ type: 'text', text: newText });
    if (hasImages) {
        normalized.forEach(n => contentParts.push({ type: 'image_url', url: n.dataUrl, complete: true }));
    }

    // 更新 OpenAI 格式
    if (state.messages[index]) {
        state.messages[index].thinkingContent = newThinking;
        state.messages[index].contentParts = contentParts;
        state.messages[index].content = hasImages
            ? [{ type: 'text', text: newText }, ...fmt.openai]
            : newText;
        delete state.messages[index].thinkingSignature;
        delete state.messages[index].thoughtSignature;
        clearEditMetadata(state.messages[index], true);
    }

    // 更新 Gemini 格式（不放 thought，Gemini 要求 thoughtSignature）
    if (state.geminiContents[index]) {
        state.geminiContents[index].parts = hasImages
            ? [{ text: newText }, ...fmt.gemini]
            : [{ text: newText }];
        state.geminiContents[index].contentParts = contentParts;
        delete state.geminiContents[index].thoughtSignature;
        clearEditMetadata(state.geminiContents[index], true);
    }

    // 更新 Claude 格式（不放 thinking，Claude 要求 signature）
    if (state.claudeContents[index]) {
        state.claudeContents[index].content = hasImages
            ? [...fmt.claude, { type: 'text', text: newText }]
            : [{ type: 'text', text: newText }];
        state.claudeContents[index].thinkingContent = newThinking;
        state.claudeContents[index].contentParts = contentParts;
        delete state.claudeContents[index].thinkingSignature;
        clearEditMetadata(state.claudeContents[index], true);
    }

    clearSubsequentSignatures(index);

    eventBus.emit('messages:changed', { action: 'updated', index });
}
