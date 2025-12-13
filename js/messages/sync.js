/**
 * 消息同步模块
 * 负责在 OpenAI、Gemini、Claude 三种格式之间同步消息
 * 关键：通过 EventBus 通知会话保存，避免循环依赖
 */

import { state } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { toOpenAIMessage, toGeminiMessage, toClaudeMessage } from './converters.js';
import { generateMessageId } from '../utils/helpers.js';
import { pushMessage, rebuildMessageIdMap } from '../core/state-mutations.js';
import { getCurrentProvider } from '../providers/manager.js';

/**
 * 同步添加消息到所有三种格式
 * @param {string} role - 角色
 * @param {string} content - 内容
 * @param {Array<string>} images - 图片数组
 * @returns {number} 消息索引
 */
export function syncPushMessage(role, content, images = null) {
    state.messages.push(toOpenAIMessage(role, content, images));
    state.geminiContents.push(toGeminiMessage(role, content, images));
    state.claudeContents.push(toClaudeMessage(role, content, images));

    // 发出事件通知消息已添加
    eventBus.emit('messages:changed', {
        action: 'user_added',
        index: state.messages.length - 1
    });

    return state.messages.length - 1; // 返回索引
}

/**
 * 统一的助手消息保存函数
 * 无论什么模式（流式/非流式、单回复/多回复）都通过这个函数保存
 * @param {Object} options - 消息选项
 * @param {string} options.sessionId - 可选：请求发起时的会话ID，用于防止消息串到其他会话
 */
export function saveAssistantMessage(options) {
    const {
        textContent = '',
        thinkingContent = null,
        thoughtSignature = null,
        groundingMetadata = null,
        streamStats = null,
        allReplies = null,
        selectedReplyIndex = 0,
        contentParts = [],
        geminiParts = null,  // 用于 Gemini 流式处理，保留原始 parts
        sessionId = null,    // 🔒 请求发起时的会话ID
    } = options;

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 🏷️ 记录当前使用的模型和提供商信息
    const modelName = state.selectedModel || 'unknown';
    const provider = getCurrentProvider();
    const providerName = provider?.name || 'Unknown';

    // 检测是否有图片
    const hasImages = contentParts.some(p => p.type === 'image_url' && p.complete);

    // 1. 构建 OpenAI 格式
    const openaiMsg = buildOpenAIAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName
    });

    // 2. 构建 Gemini 格式
    const geminiMsg = buildGeminiAssistantMessage({
        messageId, textContent, contentParts, hasImages, thoughtSignature,
        streamStats, allReplies, selectedReplyIndex, geminiParts, modelName, providerName
    });

    // 3. 构建 Claude 格式
    const claudeMsg = buildClaudeAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName
    });

    // 🔒 检查会话是否已切换（防止消息串到其他会话）
    if (sessionId && sessionId !== state.currentSessionId) {
        console.warn(`⚠️ 检测到会话已切换（${sessionId} → ${state.currentSessionId}），将消息保存到原会话`);

        // 找到原会话并保存到后台
        const targetSession = state.sessions.find(s => s.id === sessionId);
        if (targetSession) {
            targetSession.messages.push(openaiMsg);
            targetSession.geminiContents.push(geminiMsg);
            targetSession.claudeContents.push(claudeMsg);
            targetSession.updatedAt = Date.now();

            // 保存到数据库
            import('../state/storage.js').then(({ saveSessionToDB }) => {
                saveSessionToDB(targetSession).catch(e => {
                    console.error('保存后台会话失败:', e);
                });
            });

            console.log(`✅ 消息已保存到后台会话: ${targetSession.name}`);
            eventBus.emit('ui:notification', {
                message: `消息已保存到会话"${targetSession.name}"`,
                type: 'info'
            });
        } else {
            console.error(`❌ 未找到会话 ${sessionId}，消息丢失！`);
        }
        return; // 不保存到当前会话
    }

    // ✅ 使用安全的状态更新函数
    pushMessage(openaiMsg, geminiMsg, claudeMsg);

    const messageIndex = state.messages.length - 1;

    // 🏷️ 添加模型标签到最后一条助手消息的 DOM
    if (modelName || providerName) {
        // 等待下一个事件循环，确保 DOM 已经更新完成
        setTimeout(() => {
            const assistantMessages = document.querySelectorAll('.message.assistant');
            const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

            if (lastAssistantMsg) {
                const contentWrapper = lastAssistantMsg.querySelector('.message-content-wrapper');
                if (contentWrapper) {
                    // 检查是否已经有模型标签（避免重复添加）
                    if (!contentWrapper.querySelector('.message-model-badge')) {
                        const modelBadge = document.createElement('div');
                        modelBadge.className = 'message-model-badge';
                        const badgeText = [modelName, providerName].filter(Boolean).join(' | ');
                        modelBadge.textContent = badgeText;
                        modelBadge.title = `模型: ${modelName || '未知'}\n提供商: ${providerName || '未知'}`;

                        // 插入到 contentWrapper 的最前面
                        contentWrapper.insertBefore(modelBadge, contentWrapper.firstChild);
                    }
                }
            }
        }, 0);
    }

    // 发出事件通知 UI 更新 DOM 索引
    eventBus.emit('messages:assistant-added', {
        index: messageIndex
    });

    // 发出事件通知会话保存（避免直接调用 saveCurrentSessionMessages）
    eventBus.emit('messages:changed', {
        action: 'assistant_added',
        index: messageIndex
    });

    return messageIndex;
}

/**
 * 保存助手消息到后台会话（会话已切换时使用）
 */
export function saveAssistantMessageToSession(session, options) {
    const {
        textContent = '',
        thinkingContent = null,
        thoughtSignature = null,
        groundingMetadata = null,
        streamStats = null,
        allReplies = null,
        selectedReplyIndex = 0,
        contentParts = [],
        geminiParts = null,
    } = options;

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 🏷️ 记录当前使用的模型和提供商信息
    const modelName = state.selectedModel || 'unknown';
    const provider = getCurrentProvider();
    const providerName = provider?.name || 'Unknown';

    const hasImages = contentParts?.some(p => p.type === 'image_url' && p.complete);

    // 构建并添加到会话
    const openaiMsg = buildOpenAIAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName
    });
    session.messages.push(openaiMsg);

    const geminiMsg = buildGeminiAssistantMessage({
        messageId, textContent, contentParts, hasImages, thoughtSignature,
        streamStats, allReplies, selectedReplyIndex, geminiParts, modelName, providerName
    });
    session.geminiContents.push(geminiMsg);

    const claudeMsg = buildClaudeAssistantMessage({
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName
    });
    session.claudeContents.push(claudeMsg);

    // 后台会话不需要保存到 IndexedDB，由 sessions.js 处理
}

/**
 * 保存错误消息
 */
export function saveErrorMessage(errorData, httpStatus = null, renderHumanizedError) {
    // 渲染错误 HTML（用于会话恢复时显示）
    const errorHtml = renderHumanizedError(errorData, httpStatus);

    // 🔑 生成唯一消息ID
    const messageId = generateMessageId();

    // 构建错误消息对象
    const openaiErrorMsg = {
        id: messageId,
        role: 'assistant',
        content: '',
        isError: true,
        errorData: errorData,
        errorHtml: errorHtml,
        httpStatus: httpStatus
    };

    const geminiErrorMsg = {
        id: messageId,
        role: 'model',
        parts: [{ text: '' }],
        isError: true
    };

    const claudeErrorMsg = {
        id: messageId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        isError: true,
        errorData: errorData,  // ✅ Bug 1 修复：添加错误数据，支持降级渲染
        errorHtml: errorHtml,  // ✅ Bug 1 修复：添加错误 HTML，用于会话恢复
        httpStatus: httpStatus // ✅ Bug 1 修复：添加 HTTP 状态码
    };

    // ✅ 使用安全的状态更新函数
    pushMessage(openaiErrorMsg, geminiErrorMsg, claudeErrorMsg);

    // ✅ 计算消息索引（用于设置 DOM 元素的 dataset.messageIndex）
    const messageIndex = state.messages.length - 1;

    // 通知 UI 更新 DOM 索引
    eventBus.emit('messages:error-added', {
        index: messageIndex
    });

    // 保存到会话
    eventBus.emit('messages:changed', {
        action: 'error_added',
        index: messageIndex
    });

    // ✅ 返回消息索引（Bug 2 修复：允许调用方设置 dataset.messageIndex）
    return messageIndex;
}

/**
 * 构建 OpenAI 格式的助手消息
 */
function buildOpenAIAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, allReplies, selectedReplyIndex, modelName, providerName
    } = opts;

    const msg = { role: 'assistant' };

    // ✅ 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 处理内容
    if (hasImages) {
        msg.content = [];
        if (textContent) {
            msg.content.push({ type: 'text', text: textContent });
        }
        contentParts.forEach(p => {
            if (p.type === 'image_url' && p.complete) {
                msg.content.push({ type: 'image_url', image_url: { url: p.url } });
            }
        });
    } else {
        msg.content = textContent;
    }

    // 添加元数据
    if (thinkingContent) msg.thinkingContent = thinkingContent;
    if (streamStats) msg.streamStats = streamStats;
    if (allReplies && allReplies.length > 0) {
        msg.allReplies = allReplies;
        msg.selectedReplyIndex = selectedReplyIndex;
    }

    // ✅ 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    return msg;
}

/**
 * 构建 Gemini 格式的助手消息
 */
function buildGeminiAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thoughtSignature,
        streamStats, geminiParts, modelName, providerName
    } = opts;

    // 如果提供了原始 geminiParts，优先使用
    let parts;
    if (geminiParts && geminiParts.length > 0) {
        parts = geminiParts;
    } else {
        parts = [];

        // ✅ 优先使用 contentParts（保留正确的顺序，包括 thinking）
        if (contentParts && contentParts.length > 0) {
            contentParts.forEach(p => {
                if (p.type === 'thinking') {
                    // ✅ 思维链部分
                    parts.push({ text: p.text, thought: true });
                } else if (p.type === 'text') {
                    // ✅ 普通文本部分
                    parts.push({ text: p.text });
                } else if (p.type === 'image_url' && p.complete) {
                    // ✅ 图片部分
                    const match = p.url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                    }
                }
            });
        } else if (textContent) {
            // 回退：仅文本内容
            parts.push({ text: textContent });
        }
    }

    const msg = {
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: textContent || '' }],
    };

    // ✅ 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 添加元数据
    if (thoughtSignature) msg.thoughtSignature = thoughtSignature;
    if (streamStats) msg.streamStats = streamStats;

    // ✅ 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    return msg;
}

/**
 * 构建 Claude 格式的助手消息
 */
function buildClaudeAssistantMessage(opts) {
    const {
        messageId, textContent, contentParts, hasImages, thinkingContent,
        streamStats, modelName, providerName
    } = opts;

    let content;

    if (hasImages) {
        content = [];
        contentParts?.forEach(p => {
            if (p.type === 'image_url' && p.complete) {
                const match = p.url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    content.push({
                        type: 'image',
                        source: { type: 'base64', media_type: match[1], data: match[2] }
                    });
                }
            }
        });
        if (textContent) {
            content.push({ type: 'text', text: textContent });
        }
    } else {
        content = [{ type: 'text', text: textContent || '' }];
    }

    const msg = { role: 'assistant', content };

    // ✅ 设置唯一消息ID
    if (messageId) msg.id = messageId;

    // 🏷️ 添加模型和提供商信息
    if (modelName) msg.modelName = modelName;
    if (providerName) msg.providerName = providerName;

    // 添加元数据
    if (thinkingContent) msg.thinkingContent = thinkingContent;
    if (streamStats) msg.streamStats = streamStats;

    // ✅ 保存原始 contentParts（用于会话恢复时的完整渲染）
    if (contentParts && contentParts.length > 0) {
        msg.contentParts = contentParts;
    }

    return msg;
}

/**
 * 复制消息元数据
 * ✅ 修复：完整复制所有元数据，避免格式转换时丢失
 */
export function copyMessageMetadata(source, target) {
    const metadataKeys = [
        'allReplies',         // 多回复数据
        'thinkingContent',    // 思维链内容
        'selectedReplyIndex', // 选中的回复索引
        'groundingMetadata',  // 搜索引用（Gemini 专有）
        'streamStats',        // 流统计数据
        'thoughtSignature',   // 思维链签名（Gemini 专有）
        'isError',            // 错误标记
        'errorData',          // 错误数据
        'errorHtml',          // 错误 HTML
        'id',                 // 消息唯一ID
        'modelName',          // 🏷️ 模型名称
        'providerName'        // 🏷️ 提供商名称
    ];
    metadataKeys.forEach(key => {
        if (source[key] !== undefined) {
            target[key] = source[key];
        }
    });
    return target;
}

/**
 * 从 OpenAI 格式转换到其他格式
 */
export function convertFromOpenAI() {
    state.geminiContents = [];
    state.claudeContents = [];

    state.messages.forEach(msg => {
        const content = extractTextContent(msg.content);
        const images = extractImages(msg.content);
        const geminiMsg = copyMessageMetadata(msg, toGeminiMessage(msg.role, content, images));
        const claudeMsg = copyMessageMetadata(msg, toClaudeMessage(msg.role, content, images));
        state.geminiContents.push(geminiMsg);
        state.claudeContents.push(claudeMsg);
    });
}

/**
 * 从 Gemini 格式转换到其他格式
 */
export function convertFromGemini() {
    state.messages = [];
    state.claudeContents = [];

    state.geminiContents.forEach(msg => {
        const role = msg.role === 'model' ? 'assistant' : 'user';
        const content = msg.parts?.filter(p => p.text).map(p => p.text).join('') || '';
        const images = msg.parts?.filter(p => p.inlineData).map(p =>
            `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
        ) || [];

        const openaiMsg = copyMessageMetadata(msg, toOpenAIMessage(role, content, images.length > 0 ? images : null));
        const claudeMsg = copyMessageMetadata(msg, toClaudeMessage(role, content, images.length > 0 ? images : null));
        state.messages.push(openaiMsg);
        state.claudeContents.push(claudeMsg);
    });
}

/**
 * 从 Claude 格式转换到其他格式
 */
export function convertFromClaude() {
    state.messages = [];
    state.geminiContents = [];

    state.claudeContents.forEach(msg => {
        let content = '';
        let images = [];

        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            msg.content.forEach(part => {
                if (part.type === 'text') {
                    content += part.text;
                } else if (part.type === 'image' && part.source?.type === 'base64') {
                    images.push(`data:${part.source.media_type};base64,${part.source.data}`);
                }
            });
        }

        const openaiMsg = copyMessageMetadata(msg, toOpenAIMessage(msg.role, content, images.length > 0 ? images : null));
        const geminiMsg = copyMessageMetadata(msg, toGeminiMessage(msg.role, content, images.length > 0 ? images : null));
        state.messages.push(openaiMsg);
        state.geminiContents.push(geminiMsg);
    });
}

/**
 * 同步所有格式（从当前格式转换）
 */
export function syncAllFormats() {
    switch (state.apiFormat) {
        case 'openai':
            convertFromOpenAI();
            break;
        case 'gemini':
            convertFromGemini();
            break;
        case 'claude':
            convertFromClaude();
            break;
    }

    // ✅ 转换后重建 messageIdMap（确保索引映射正确）
    rebuildMessageIdMap();
}

/**
 * 提取文本内容
 */
export function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter(p => p.type === 'text').map(p => p.text).join('');
    }
    return '';
}

/**
 * 提取图片 URL
 */
export function extractImages(content) {
    if (!Array.isArray(content)) return null;
    const images = content.filter(p => p.type === 'image_url').map(p => p.image_url?.url).filter(Boolean);
    return images.length > 0 ? images : null;
}
