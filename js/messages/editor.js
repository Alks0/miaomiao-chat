/**
 * 消息编辑模块
 * 处理消息的编辑、删除、重试功能
 * 监听来自 renderer.js 的事件，避免循环依赖
 */

import { state } from '../core/state.js';
import { elements } from '../core/elements.js';
import { eventBus } from '../core/events.js';
import { removeMessageAt, removeMessagesAfter } from '../core/state-mutations.js';
import { updateImagePreview } from '../ui/input.js';
import { showConfirmDialog } from '../utils/dialogs.js';

/**
 * 根据消息ID查找索引
 * ✅ 优化：使用 messageIdMap 快速查找，避免 O(n) 遍历
 * @param {string} messageId - 消息ID
 * @returns {number} 消息索引，-1 表示未找到
 */
function getMessageIndexById(messageId) {
    if (!messageId) return -1;

    // ✅ 优先使用 messageIdMap（O(1) 查找）
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

    // 通知 UI 更新按钮状态
    console.log('[editor.js] 发出 editor:mode-changed 事件');
    eventBus.emit('editor:mode-changed', {
        isEditing: true,
        index: targetIndex
    });
}

/**
 * 原地编辑消息（内联编辑）
 * ✅ 修复：保留图片数据，避免编辑后图片丢失
 * @param {HTMLElement} messageEl - 消息元素
 */
export function editMessageInPlace(messageEl) {
    const index = resolveMessageIndex(messageEl);
    if (index === -1) return;

    // 避免重复进入编辑模式
    if (messageEl.classList.contains('editing')) return;

    const role = messageEl.classList.contains('user') ? 'user' : 'assistant';

    // 获取当前内容和图片
    let textContent = '';
    let images = [];

    if (state.apiFormat === 'gemini') {
        const message = state.geminiContents[index];
        if (message?.parts) {
            message.parts.forEach(p => {
                if (p.text !== undefined) {
                    textContent += p.text;
                } else if (p.inlineData || p.inline_data) {
                    images.push(p);
                }
            });
        }
    } else if (state.apiFormat === 'claude') {
        const message = state.claudeContents[index];
        if (message?.content) {
            if (typeof message.content === 'string') {
                textContent = message.content;
            } else if (Array.isArray(message.content)) {
                message.content.forEach(p => {
                    if (p.type === 'text') {
                        textContent += p.text || '';
                    } else if (p.type === 'image' && p.source) {
                        images.push(p);
                    }
                });
            }
        }
    } else {
        const message = state.messages[index];
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

    // ✅ 图片管理区域（现有图片 + 添加按钮）
    const imageManager = document.createElement('div');
    imageManager.className = 'edit-image-manager';

    // 创建可编辑的图片数组副本
    let editableImages = [...images];

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

    // 文本编辑区域
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = textContent;
    textarea.rows = 3;

    // 操作按钮
    const editActions = document.createElement('div');
    editActions.className = 'edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '保存';
    saveBtn.onclick = () => {
        const newContent = textarea.value.trim();

        // ✅ 验证：防止保存空消息
        if (!newContent && editableImages.length === 0) {
            eventBus.emit('ui:notification', {
                message: '消息不能为空（至少需要文本或图片）',
                type: 'warning'
            });
            return;
        }

        // ✅ 使用可编辑的图片数组保存
        updateMessageContentWithImages(index, newContent, editableImages, role);
        // 重新渲染消息
        eventBus.emit('message:content-updated', { messageEl, index, newContent, role });
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => {
        contentDiv.innerHTML = originalHTML;
        messageEl.classList.remove('editing');
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
    }

    // 更新 Gemini 格式
    if (state.geminiContents[index]) {
        const textPart = state.geminiContents[index].parts?.find(p => p.text !== undefined);
        if (textPart) textPart.text = newContent;
    }

    // 更新 Claude 格式
    if (state.claudeContents[index]) {
        if (Array.isArray(state.claudeContents[index].content)) {
            const textPart = state.claudeContents[index].content.find(p => p.type === 'text');
            if (textPart) textPart.text = newContent;
        } else {
            state.claudeContents[index].content = newContent;
        }
    }

    // 发出事件通知会话保存
    eventBus.emit('messages:changed', {
        action: 'updated',
        index
    });
}

/**
 * 更新消息内容并保留图片（同步更新三种格式）
 * ✅ 修复：编辑消息时不会丢失图片数据
 * @param {number} index - 消息索引
 * @param {string} newText - 新文本内容
 * @param {Array} images - 图片数组
 * @param {string} role - 角色
 */
export function updateMessageContentWithImages(index, newText, images, role) {
    // 更新 OpenAI 格式
    if (state.messages[index]) {
        if (images.length > 0) {
            // 重建 content 数组：文本 + 图片
            state.messages[index].content = [
                { type: 'text', text: newText },
                ...images
            ];
        } else {
            // 只有文本
            state.messages[index].content = newText;
        }
    }

    // 更新 Gemini 格式
    if (state.geminiContents[index]) {
        if (images.length > 0) {
            state.geminiContents[index].parts = [
                { text: newText },
                ...images
            ];
        } else {
            state.geminiContents[index].parts = [{ text: newText }];
        }
    }

    // 更新 Claude 格式
    if (state.claudeContents[index]) {
        if (images.length > 0) {
            // Claude 格式：图片在前，文本在后
            state.claudeContents[index].content = [
                ...images,
                { type: 'text', text: newText }
            ];
        } else {
            state.claudeContents[index].content = [{ type: 'text', text: newText }];
        }
    }

    // 发出事件通知会话保存
    eventBus.emit('messages:changed', {
        action: 'updated',
        index
    });
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

    // ✅ 使用安全的状态更新函数删除消息
    removeMessageAt(index);

    // 从 DOM 中移除
    messageEl.remove();

    // 更新剩余消息的索引
    const allMessages = elements.messagesArea.querySelectorAll('.message');
    allMessages.forEach((el, i) => {
        el.dataset.messageIndex = i;
    });

    // 发出事件通知
    eventBus.emit('messages:changed', {
        action: 'deleted',
        index
    });

    eventBus.emit('ui:notification', { message: '消息已删除', type: 'info' });
}

/**
 * 删除指定索引后的所有消息
 * @param {number} index - 起始索引
 */
export function removeMessagesAfterAll(index) {
    // ✅ 使用安全的状态更新函数
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
    // ✅ 优先使用消息ID查找（稳定且准确）
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
 * 解析 OpenAI/Claude 格式的用户消息内容
 */
function parseUserContent(content) {
    let text = '';
    const images = [];

    if (Array.isArray(content)) {
        content.forEach(part => {
            if (part.type === 'text') {
                text += (text ? '\n' : '') + (part.text || '');
            } else if (part.type === 'image_url' && part.image_url?.url) {
                images.push({
                    name: '已上传图片',
                    type: 'image/*',
                    data: part.image_url.url,
                });
            }
        });
    } else if (typeof content === 'string') {
        text = content;
    }

    return { text, images };
}

/**
 * 解析 Gemini 格式的用户消息内容
 */
function parseGeminiUserContent(parts) {
    let text = '';
    const images = [];

    if (Array.isArray(parts)) {
        parts.forEach(part => {
            if (part.text) {
                text += (text ? '\n' : '') + part.text;
            } else if (part.inlineData || part.inline_data) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;
                images.push({
                    name: '已上传图片',
                    type: mimeType,
                    data: `data:${mimeType};base64,${data}`,
                });
            }
        });
    }

    return { text, images };
}

// ========== 事件监听 ==========

// 监听编辑请求
eventBus.on('message:edit-requested', ({ messageEl }) => {
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
 * 添加新图片到编辑中的消息
 * ✅ 完整的图片管理功能
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
