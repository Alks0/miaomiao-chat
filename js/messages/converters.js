/**
 * 消息格式转换器
 * 在 OpenAI、Gemini、Claude 三种 API 格式之间转换消息
 * 纯函数，无副作用
 *
 * 支持的附件类型：
 * - 图片: image/jpeg, image/png, image/gif, image/webp
 * - PDF: application/pdf
 * - 文本: text/plain
 */

import { categorizeFile } from '../utils/file-helpers.js';
import { state } from '../core/state.js';

/**
 * 判断 MIME 类型的文件类别
 * @deprecated Use categorizeFile from file-helpers.js instead
 * @param {string} mimeType - MIME 类型
 * @returns {'image'|'pdf'|'text'|'unknown'} 文件类别
 */
export function getFileCategory(mimeType) {
    return categorizeFile(mimeType);
}

/**
 * 转换为 OpenAI 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} OpenAI 格式消息
 */
export function toOpenAIMessage(role, content, attachments = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理附件
    if (attachments && attachments.length > 0) {
        const parts = [];
        if (content) {
            parts.push({ type: 'text', text: content });
        }
        attachments.forEach(att => {
            // 检查是否是 data URL
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image') {
                    // 图片使用 image_url 格式
                    parts.push({ type: 'image_url', image_url: { url: att } });
                } else if (category === 'video') {
                    // 视频使用 video_url 格式
                    parts.push({ type: 'video_url', video_url: { url: att } });
                } else if (category === 'pdf') {
                    // PDF 处理策略
                    if (state.pdfMode === 'compat') {
                        // 兼容模式：将 PDF 伪装成 image_url (适用于部分 OpenAI 兼容接口)
                        parts.push({ 
                            type: 'image_url', 
                            image_url: { url: att } 
                        });
                    } else {
                        // 标准模式：使用 file 格式（OpenAI 2025.3 新增）
                        parts.push({
                            type: 'file',
                            file: {
                                filename: 'document.pdf',
                                file_data: `data:${mimeType};base64,${base64Data}`
                            }
                        });
                    }
                } else if (category === 'text') {
                    // 文本文件：解码后作为文本内容插入
                    try {
                        const textContent = decodeURIComponent(escape(atob(base64Data)));
                        parts.push({
                            type: 'text',
                            text: `<document>\n${textContent}\n</document>`
                        });
                    } catch (e) {
                        console.warn('无法解码文本文件:', e);
                    }
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容（不是 Data URL）
                parts.push({
                    type: 'text',
                    text: `<document>\n${att}\n</document>`
                });
            } else {
                // 兼容旧格式（纯 URL）
                parts.push({ type: 'image_url', image_url: { url: att } });
            }
        });
        return { role: normalizedRole, content: parts };
    }

    return { role: normalizedRole, content: content || '' };
}

/**
 * 转换为 Gemini 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} Gemini 格式消息
 */
export function toGeminiMessage(role, content, attachments = null) {
    const geminiRole = role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (content) {
        parts.push({ text: content });
    }

    if (attachments && attachments.length > 0) {
        attachments.forEach(att => {
            // 从 data URL 提取 base64
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image' || category === 'video' || category === 'pdf') {
                    // 图片、视频和 PDF 都使用 inlineData 格式
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                } else if (category === 'text') {
                    // 文本文件：Gemini 支持 text/plain 的 inlineData
                    parts.push({
                        inlineData: {
                            mimeType: 'text/plain',
                            data: base64Data
                        }
                    });
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容，需要编码为 base64
                const base64 = btoa(unescape(encodeURIComponent(att)));
                parts.push({
                    inlineData: {
                        mimeType: 'text/plain',
                        data: base64
                    }
                });
            }
        });
    }

    return { role: geminiRole, parts };
}

/**
 * 转换为 Claude 格式消息
 * @param {string} role - 角色 ('user' | 'assistant' | 'model')
 * @param {string} content - 文本内容
 * @param {Array<string>} attachments - 附件数组（data URLs）
 * @returns {Object} Claude 格式消息
 */
export function toClaudeMessage(role, content, attachments = null) {
    const normalizedRole = role === 'model' ? 'assistant' : role;

    // 处理附件
    if (attachments && attachments.length > 0) {
        const parts = [];
        attachments.forEach(att => {
            const match = att.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const category = getFileCategory(mimeType);

                if (category === 'image') {
                    // 图片使用 image 类型
                    parts.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64Data
                        }
                    });
                } else if (category === 'video') {
                    // Claude 不支持视频，添加文本说明
                    parts.push({
                        type: 'text',
                        text: '[视频内容已跳过 - Claude API 不支持视频输入]'
                    });
                } else if (category === 'pdf') {
                    // PDF 使用 document 类型
                    parts.push({
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: base64Data
                        }
                    });
                } else if (category === 'text') {
                    // 文本文件：解码后作为文本内容插入
                    try {
                        const textContent = decodeURIComponent(escape(atob(base64Data)));
                        parts.push({
                            type: 'text',
                            text: `<document>\n${textContent}\n</document>`
                        });
                    } catch (e) {
                        console.warn('无法解码文本文件:', e);
                    }
                }
            } else if (typeof att === 'string' && !att.startsWith('http')) {
                // 新格式：纯文本内容（不是 Data URL）
                parts.push({
                    type: 'text',
                    text: `<document>\n${att}\n</document>`
                });
            }
        });
        if (content) {
            parts.push({ type: 'text', text: content });
        }
        return { role: normalizedRole, content: parts };
    }

    return { role: normalizedRole, content: content || '' };
}

/**
 * 将整个会话转换为 Markdown 字符串
 * @param {Object} session - 会话对象
 * @returns {string} Markdown 字符串
 */
function getExportMessages(session) {
    if (Array.isArray(session?.messages) && session.messages.length > 0) {
        return session.messages;
    }
    if (Array.isArray(session?.geminiContents) && session.geminiContents.length > 0) {
        return session.geminiContents;
    }
    if (Array.isArray(session?.claudeContents) && session.claudeContents.length > 0) {
        return session.claudeContents;
    }
    return [];
}

function getSelectedReply(msg) {
    if (!Array.isArray(msg?.allReplies) || msg.allReplies.length === 0) {
        return null;
    }
    const selectedIndex = Number.isInteger(msg.selectedReplyIndex) ? msg.selectedReplyIndex : 0;
    return msg.allReplies[selectedIndex] || msg.allReplies[0] || null;
}

function getAttachmentMarker(part) {
    if (!part || typeof part !== 'object') return '';

    if (part.type === 'image_url' || part.type === 'image') return '[图片]';
    if (part.type === 'video_url') return '[视频]';
    if (part.type === 'document' || part.type === 'file') return '[文档]';

    const inlineData = part.inlineData || part.inline_data;
    if (inlineData) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || '';
        const category = categorizeFile(mimeType);
        if (category === 'image') return '[图片]';
        if (category === 'video') return '[视频]';
        if (category === 'pdf' || category === 'text') return '[文档]';
        return '[附件]';
    }

    return '';
}

function extractTextFromParts(parts = []) {
    return parts
        .map((part) => {
            if (!part || typeof part !== 'object') return '';
            if (part.thought || part.type === 'thinking') return '';
            if (typeof part.text === 'string') return part.text;
            return getAttachmentMarker(part);
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}

function extractThinkingContent(msg) {
    const selectedReply = getSelectedReply(msg);
    if (selectedReply?.thinkingContent) {
        return selectedReply.thinkingContent;
    }
    if (msg?.thinkingContent) {
        return msg.thinkingContent;
    }
    if (msg?.thought) {
        return msg.thought;
    }
    if (Array.isArray(msg?.contentParts)) {
        const thinking = msg.contentParts
            .filter(part => part?.type === 'thinking' && typeof part.text === 'string')
            .map(part => part.text)
            .join('\n\n')
            .trim();
        if (thinking) return thinking;
    }
    if (Array.isArray(msg?.parts)) {
        const thinking = msg.parts
            .filter(part => part?.thought && typeof part.text === 'string')
            .map(part => part.text)
            .join('\n\n')
            .trim();
        if (thinking) return thinking;
    }
    return '';
}

function extractMessageBody(msg) {
    const selectedReply = getSelectedReply(msg);

    if (selectedReply) {
        if (typeof selectedReply.content === 'string' && selectedReply.content.trim()) {
            return selectedReply.content.trim();
        }
        if (Array.isArray(selectedReply.contentParts) && selectedReply.contentParts.length > 0) {
            return extractTextFromParts(selectedReply.contentParts);
        }
        if (Array.isArray(selectedReply.parts) && selectedReply.parts.length > 0) {
            return extractTextFromParts(selectedReply.parts);
        }
        if (Array.isArray(selectedReply.claudeContent) && selectedReply.claudeContent.length > 0) {
            return extractTextFromParts(selectedReply.claudeContent);
        }
    }

    if (typeof msg?.content === 'string') {
        return msg.content.trim();
    }
    if (Array.isArray(msg?.content)) {
        return extractTextFromParts(msg.content);
    }
    if (Array.isArray(msg?.contentParts)) {
        return extractTextFromParts(msg.contentParts);
    }
    if (Array.isArray(msg?.parts)) {
        return extractTextFromParts(msg.parts);
    }
    return '';
}

function extractToolCalls(msg) {
    const toolCalls = msg?.toolCalls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return '';
    }

    const lines = toolCalls
        .map(toolCall => toolCall?.name || toolCall?.function?.name || toolCall?.id || '')
        .filter(Boolean);

    if (lines.length === 0) return '';
    return lines.map(name => `- ${name}`).join('\n');
}

export function sessionToMarkdown(session) {
    if (!session) return '';

    const messages = getExportMessages(session);
    if (messages.length === 0) return '';

    let markdown = `# ${session.name || 'Untitled Session'}\n\n`;

    messages.forEach((msg) => {
        // 跳过系统消息
        if (msg.role === 'system') return;

        const roleName = msg.role === 'user' ? 'User' : 'Assistant';
        markdown += `## ${roleName}\n\n`;

        const thinkingContent = extractThinkingContent(msg);
        if (thinkingContent) {
            markdown += `> **Thinking:**\n> ${thinkingContent.replace(/\n/g, '\n> ')}\n\n`;
        }

        const toolCalls = extractToolCalls(msg);
        if (toolCalls) {
            markdown += `> **Tool Calls:**\n> ${toolCalls.replace(/\n/g, '\n> ')}\n\n`;
        }

        const content = extractMessageBody(msg);
        markdown += `${content || '[无文本内容]'}\n\n`;

        // 分隔符
        markdown += `---\n\n`;
    });

    return markdown.trim();
}
