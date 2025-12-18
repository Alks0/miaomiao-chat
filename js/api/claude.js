/**
 * Claude API 请求处理器
 * 支持 Anthropic Claude Messages API
 */

import { state } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages, getOpeningMessages } from '../utils/prefill.js';
import { processVariables } from '../utils/variables.js';
import { filterMessagesByCapabilities } from '../utils/message-filter.js';
import { getCurrentModelCapabilities } from '../providers/manager.js';
import { getOrCreateMappedId } from './format-converter.js';  // ID 重映射

/**
 * 上传图片到 Claude Files API
 * @param {string} base64Data - Base64 编码的图片数据
 * @param {string} mediaType - MIME 类型
 * @returns {Promise<string>} 文件 ID
 */
async function uploadImageToFilesAPI(base64Data, mediaType) {
    const apiKey = state.apiKeys.claude;
    if (!apiKey) {
        throw new Error('Claude API key not found');
    }

    try {
        // 将 base64 转换为 Blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mediaType });

        // 创建 FormData
        const formData = new FormData();
        formData.append('file', blob, `image.${mediaType.split('/')[1]}`);

        // 上传到 Files API
        const response = await fetch('https://api.anthropic.com/v1/files', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'files-api-2025-04-14'
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to upload file: ${response.status} ${error}`);
        }

        const result = await response.json();
        console.log(`[Claude] 图片已上传到 Files API: ${result.id}`);
        return result.id;
    } catch (error) {
        console.error('[uploadImageToFilesAPI] 上传失败:', error);
        throw error;
    }
}

/**
 * 转换消息格式为 Claude 格式
 * @param {Array} messages - OpenAI 格式的消息数组
 * @returns {Promise<Array>} Claude 格式的消息数组
 */
async function convertToClaudeMessages(messages) {
    // Claude API 中 system 是顶级参数，messages 中只能有 user 和 assistant
    // 过滤掉 system 消息，避免被错误转换成 user
    const convertedMessages = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => {
            // ⭐ 处理工具调用消息（assistant with tool_calls）
            if (msg.role === 'assistant' && msg.tool_calls) {
                const content = [];

                // 当启用 thinking 时，先添加 thinking block（必须在 tool_use 之前）
                if (state.thinkingEnabled && msg.thinkingContent) {
                    const thinkingBlock = {
                        type: 'thinking',
                        thinking: msg.thinkingContent
                    };
                    // 添加签名（如果有）
                    if (msg.thinkingSignature) {
                        thinkingBlock.signature = msg.thinkingSignature;
                    }
                    content.push(thinkingBlock);
                }

                // 添加 tool_use blocks
                msg.tool_calls.forEach(tc => {
                    // 解析 arguments（可能是字符串）
                    let input;
                    try {
                        input = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {
                        input = {};
                    }

                    // ID 重映射（OpenAI → Claude）
                    const claudeId = getOrCreateMappedId(tc.id, 'claude');

                    content.push({
                        type: 'tool_use',
                        id: claudeId,
                        name: tc.function.name,
                        input: input
                    });
                });

                return {
                    role: 'assistant',
                    content: content
                };
            }

            // ⭐ 处理工具结果消息（role: 'tool'）
            if (msg.role === 'tool') {
                // ID 重映射（OpenAI → Claude）
                const claudeId = getOrCreateMappedId(msg.tool_call_id, 'claude');

                // 多模态支持：解析工具结果并检测图片
                let resultContent;
                try {
                    resultContent = JSON.parse(msg.content);
                } catch {
                    resultContent = msg.content;
                }

                // 检测多模态内容
                const contentParts = [];

                if (resultContent && typeof resultContent === 'object') {
                    // 处理文本字段
                    if (resultContent.text) {
                        contentParts.push({
                            type: 'text',
                            text: resultContent.text
                        });
                    }

                    // 处理图片数组（Code Execution 返回多张图片）
                    if (Array.isArray(resultContent.images)) {
                        for (const imageItem of resultContent.images) {
                            // 提取 image_url 格式
                            if (imageItem.type === 'image_url' && imageItem.url) {
                                const match = imageItem.url.match(/^data:([^;]+);base64,(.+)$/);
                                if (match) {
                                    contentParts.push({
                                        type: 'image',
                                        source: {
                                            type: 'base64',
                                            media_type: match[1],
                                            data: match[2]
                                        }
                                    });
                                }
                            }
                        }
                    }

                    // 处理单个图片字段（向后兼容）
                    if (resultContent.image) {
                        const imageData = resultContent.image;

                        // 处理 base64 格式: "data:image/png;base64,..."
                        if (typeof imageData === 'string' && imageData.startsWith('data:')) {
                            const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                contentParts.push({
                                    type: 'image',
                                    source: {
                                        type: 'base64',
                                        media_type: match[1],
                                        data: match[2]
                                    }
                                });
                            }
                        }
                        // 处理已经是 Claude 格式: { source: { type, media_type, data } }
                        else if (imageData.source) {
                            contentParts.push({
                                type: 'image',
                                source: imageData.source
                            });
                        }
                        // 处理 Gemini 格式: { inlineData: { mimeType, data } }
                        else if (imageData.inlineData) {
                            contentParts.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: imageData.inlineData.mimeType,
                                    data: imageData.inlineData.data
                                }
                            });
                        }
                        // 处理简化格式: { mimeType, data } 或 { media_type, data }
                        else if (imageData.data) {
                            contentParts.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: imageData.mimeType || imageData.media_type || 'image/png',
                                    data: imageData.data
                                }
                            });
                        }
                    }

                    // 处理其他字段（非 image/images/text）
                    const otherFields = { ...resultContent };
                    delete otherFields.image;
                    delete otherFields.images;
                    delete otherFields.text;
                    if (Object.keys(otherFields).length > 0) {
                        contentParts.push({
                            type: 'text',
                            text: JSON.stringify(otherFields)
                        });
                    }
                }

                // 如果没有检测到多模态内容，使用纯文本
                if (contentParts.length === 0) {
                    contentParts.push({
                        type: 'text',
                        text: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent)
                    });
                }

                // 返回 Claude 格式
                // 注意：如果只有一个文本部分，Claude API 也接受字符串形式（向后兼容）
                const toolResultContent = contentParts.length === 1 && contentParts[0].type === 'text' && !(resultContent && typeof resultContent === 'object' && resultContent.image)
                    ? msg.content  // 纯文本保持原格式
                    : contentParts;  // 多模态使用数组格式

                return {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: claudeId,
                        content: toolResultContent
                    }]
                };
            }

            // Claude 只支持 user 和 assistant 两种角色
            const role = msg.role === 'assistant' ? 'assistant' : 'user';

            // 处理多模态内容
            if (Array.isArray(msg.content)) {
                const content = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text };
                    } else if (part.type === 'thinking') {
                        // Thinking blocks 应该跳过（Claude API 会自动处理）
                        // 根据官方文档：非工具场景会自动移除，工具场景需要保持原样
                        // 但由于我们的内部格式使用 OpenAI 风格，这里跳过即可
                        return null;
                    } else if (part.type === 'image_url') {
                        // 检查是否有 file_id（已通过 Files API 上传）
                        if (part.file_id) {
                            // 如果启用 Code Execution，使用 container_upload（沙箱可访问）
                            if (state.codeExecutionEnabled) {
                                return {
                                    type: 'container_upload',
                                    file_id: part.file_id
                                };
                            }
                            // 否则下载文件并转换为 image（仅供模型"看"）
                            // 注意：这需要异步处理，暂时先用 container_upload
                            return {
                                type: 'container_upload',
                                file_id: part.file_id
                            };
                        }

                        // 提取 base64 数据（图片）
                        const matches = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                        if (matches) {
                            const mediaType = matches[1];
                            const base64Data = matches[2];

                            // 如果启用 Code Execution，检查图片大小
                            if (state.codeExecutionEnabled) {
                                // 计算 base64 解码后的大小（约为 base64 长度的 3/4）
                                const estimatedSize = (base64Data.length * 3) / 4;
                                const MAX_INLINE_SIZE = 5 * 1024 * 1024; // 5MB

                                // 如果超过 5MB，自动上传到 Files API
                                if (estimatedSize > MAX_INLINE_SIZE) {
                                    console.log(`[Claude] 📤 图片过大 (${(estimatedSize/1024/1024).toFixed(1)}MB)，自动上传到 Files API...`);

                                    // ⚠️ 异步上传 - 需要改成 async/await
                                    // 这里标记需要上传，稍后处理
                                    return {
                                        _needsUpload: true,
                                        mediaType,
                                        base64Data,
                                        estimatedSize
                                    };
                                }
                            }

                            // 普通图片（仅供模型"看"）或小于 5MB 的图片
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mediaType,
                                    data: base64Data
                                }
                            };
                        }
                    } else if (part.type === 'file' && part.file?.file_data) {
                        // 提取 base64 数据（PDF 文件）
                        const matches = part.file.file_data.match(/^data:([^;]+);base64,(.+)$/);
                        if (matches) {
                            return {
                                type: 'document',
                                source: {
                                    type: 'base64',
                                    media_type: matches[1],
                                    data: matches[2]
                                }
                            };
                        }
                    }
                    return null;
                }).filter(Boolean);

                return { role, content };
            }

            // ⭐ 处理纯文本 assistant 消息
            // 如果启用 thinking 且有 thinkingContent，需要转换为多模态格式
            if (role === 'assistant' && state.thinkingEnabled && msg.thinkingContent) {
                const content = [];

                // 添加 thinking block
                const thinkingBlock = {
                    type: 'thinking',
                    thinking: msg.thinkingContent
                };
                // 添加签名（如果有）
                if (msg.thinkingSignature) {
                    thinkingBlock.signature = msg.thinkingSignature;
                }
                content.push(thinkingBlock);

                // 添加文本内容（如果有）
                if (msg.content && msg.content.trim()) {
                    content.push({
                        type: 'text',
                        text: msg.content
                    });
                }

                return { role, content };
            }

            return { role, content: msg.content };
        });

    // 处理需要上传的大图片
    for (const msg of convertedMessages) {
        if (Array.isArray(msg.content)) {
            for (let i = 0; i < msg.content.length; i++) {
                const part = msg.content[i];
                // 检测需要上传的标记
                if (part && part._needsUpload) {
                    try {
                        console.log(`[Claude] 📤 正在上传图片 (${(part.estimatedSize/1024/1024).toFixed(1)}MB)...`);
                        const fileId = await uploadImageToFilesAPI(part.base64Data, part.mediaType);

                        // 替换为 container_upload
                        msg.content[i] = {
                            type: 'container_upload',
                            file_id: fileId
                        };
                        console.log(`[Claude] 图片已上传，file_id: ${fileId}`);
                    } catch (error) {
                        console.error('[Claude] ❌ 图片上传失败:', error);
                        throw new Error(`图片上传失败: ${error.message}`);
                    }
                }
            }
        }
    }

    return convertedMessages;
}

/**
 * 发送 Claude 格式的请求
 * @param {string} endpoint - API 端点
 * @param {string} apiKey - API 密钥
 * @param {string} model - 模型名称
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<Response>} Fetch Response
 */
export async function sendClaudeRequest(endpoint, apiKey, model, signal = null) {
    // 转换消息格式为 Claude Messages API（过滤掉错误消息）
    let messages = state.messages.filter(m => !m.isError);

    // 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        messages = filterMessagesByCapabilities(messages, capabilities);
        console.log('📋 [Claude] 消息已根据模型能力过滤:', {
            capabilities,
            filteredCount: messages.length
        });
    }

    // 转换为 Claude 格式（使用过滤后的消息）
    let claudeMessages = await convertToClaudeMessages(messages);

    // 开场对话插入到对话历史之前（Claude 的 system 是独立参数，所以这里直接插入到最前面）
    if (state.prefillEnabled) {
        const opening = getOpeningMessages();
        if (opening.length > 0) {
            claudeMessages = [...opening, ...claudeMessages];
        }
    }

    // 预填充消息追加到末尾（用户最新消息之后）
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages();
        claudeMessages = [...claudeMessages, ...prefill];
    }

    // 构建请求体
    const requestBody = {
        model: model,
        messages: claudeMessages,
        stream: state.streamEnabled,
        ...buildModelParams('claude'), // 包含 max_tokens（默认 8192）及其他参数
    };

    // Claude 的 system 是顶层参数（独立于预填充开关）
    if (state.systemPrompt) {
        requestBody.system = processVariables(state.systemPrompt);
    }

    // 添加思维链配置 (Claude Extended Thinking)
    const claudeThinkingConfig = buildThinkingConfig('claude');
    if (claudeThinkingConfig) Object.assign(requestBody, claudeThinkingConfig);

    // ⭐ 添加工具调用支持 (Tool Use)
    const tools = [];

    // 1. Code Execution 工具（需要同时添加工具定义 + beta header）
    if (state.codeExecutionEnabled) {
        tools.push({
            type: "code_execution_20250825",
            name: "code_execution"
        });
        console.log('[Claude] 📊 Code Execution 工具已启用');
    }

    // 2. Computer Use 原生工具（仅 Electron 环境且非 XML 模式）
    // ⭐ XML 模式下使用统一的自定义 computer 工具（来自 builtin/computer-use.js）
    if (state.computerUseEnabled && window.electronAPI?.isElectron?.() && !state.xmlToolCallingEnabled) {
        // 根据模型选择 computer 工具版本（只有 computer 工具版本会变）
        // Opus 4.5 使用 20251124，其他模型使用 20250124
        const isOpus45 = model && model.toLowerCase().includes('opus-4-5');
        const computerVersion = isOpus45 ? '20251124' : '20250124';

        // 2.1 屏幕控制工具（版本根据模型变化）
        // 动态获取屏幕分辨率
        let displayWidth = 1920;
        let displayHeight = 1080;
        if (typeof window !== 'undefined' && window.screen) {
            displayWidth = window.screen.width;
            displayHeight = window.screen.height;
        }

        tools.push({
            type: `computer_${computerVersion}`,
            name: "computer",
            display_width_px: displayWidth,
            display_height_px: displayHeight,
            display_number: 1
        });

        // 2.2 Bash 命令工具（固定版本 20250124）
        if (state.computerUsePermissions?.bash !== false) {
            tools.push({
                type: "bash_20250124",
                name: "bash"
            });
        }

        // 2.3 文本编辑器工具（固定版本 20250728）
        if (state.computerUsePermissions?.textEditor !== false) {
            tools.push({
                type: "text_editor_20250728",
                name: "str_replace_based_edit_tool"
            });
        }

        console.log(`[Claude] 💻 Computer Use 原生工具已添加（computer: ${computerVersion}, bash: 20250124, text_editor: 20250728）`);
    } else if (state.computerUseEnabled && window.electronAPI?.isElectron?.() && state.xmlToolCallingEnabled) {
        console.log(`[Claude] 💻 XML 模式：将使用自定义 Computer Use 工具（来自 builtin/computer-use.js）`);
    }

    // 3. Web Search 工具（保持不变）
    if (state.webSearchEnabled) {
        tools.push({
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5
        });
    }

    // 4. 系统工具
    // getToolsForAPI 已经根据 xmlToolCallingEnabled 正确处理了 computer 工具
    // - 原生模式：自动过滤掉 computer 工具（使用 Claude 原生版本）
    // - XML 模式：自动保留 computer 工具（使用自定义版本）
    try {
        const { getToolsForAPI } = await import('../tools/manager.js');
        const systemTools = getToolsForAPI('claude');
        tools.push(...systemTools);

        if (state.xmlToolCallingEnabled) {
            console.log('[Claude] 📦 XML 模式：包含所有系统工具（含自定义 computer 工具）');
        }
    } catch (error) {
        console.warn('[Claude] 工具系统未加载:', error);
    }

    if (tools.length > 0) {
        if (state.xmlToolCallingEnabled) {
            // XML 模式：只注入 XML 到 system 参数，不使用原生 tools 字段
            const { injectToolsToClaude, getXMLInjectionStats } = await import('../tools/tool-injection.js');
            injectToolsToClaude(requestBody, tools);

            // 性能监控
            const stats = getXMLInjectionStats(tools);
            console.log('[Claude] 📊 XML 模式启用，注入统计:', stats);
        } else {
            // 原生模式：使用标准 tools 字段
            requestBody.tools = tools;
            console.log('[Claude] 📊 原生 tools 模式，工具数量:', tools.length);
        }
    }

    console.log('Sending Claude request:', JSON.stringify(requestBody, null, 2));

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            ...getCustomHeadersObject(), // 合并自定义请求头
        },
        body: JSON.stringify(requestBody),
    };
    if (signal) options.signal = signal;

    // 智能合并 beta headers
    const betaFeaturesToAdd = [];

    // Code Execution beta
    if (state.codeExecutionEnabled) {
        betaFeaturesToAdd.push('code-execution-2025-08-25');
        betaFeaturesToAdd.push('advanced-tool-use-2025-11-20');
        // Code Execution 需要 Files API 支持（用于 container_upload）
        betaFeaturesToAdd.push('files-api-2025-04-14');
    }

    // Computer Use beta（仅 Electron 环境）
    if (state.computerUseEnabled && window.electronAPI?.isElectron?.()) {
        // 根据模型选择 beta header
        const isOpus45 = model && model.toLowerCase().includes('opus-4-5');
        const betaHeader = isOpus45 ? 'computer-use-2025-11-24' : 'computer-use-2025-01-24';
        betaFeaturesToAdd.push(betaHeader);
    }

    // 合并 beta headers
    if (betaFeaturesToAdd.length > 0) {
        const existingBeta = options.headers['anthropic-beta'];
        let betaFeatures = [];

        if (existingBeta) {
            betaFeatures = existingBeta.split(',').map(s => s.trim());
        }

        // 添加新的 beta 功能（去重）
        for (const feature of betaFeaturesToAdd) {
            if (!betaFeatures.includes(feature)) {
                betaFeatures.push(feature);
            }
        }

        options.headers['anthropic-beta'] = betaFeatures.join(',');
        console.log('[Claude] 📊 Beta headers:', betaFeatures.join(', '));
    }

    return await fetch(endpoint, options);
}

/**
 * 构建 Claude 工具结果消息（OpenAI 格式）
 * 注意：返回 OpenAI 格式的消息，由 convertToClaudeMessages 在发送时转换为 Claude 格式
 * @param {Array} toolCalls - 工具调用列表 [{id, name, arguments}]
 * @param {Array} toolResults - 工具结果列表 [{role: 'tool', content, tool_call_id}]
 * @returns {Array} OpenAI 格式的消息数组（存储在 state.messages 中）
 */
export function buildToolResultMessages(toolCalls, toolResults) {
    // XML 模式：使用 XML 格式而不是原生 tool_calls
    if (state.xmlToolCallingEnabled) {
        // 构建 XML 格式的工具调用文本
        let toolCallXML = '';
        for (const tc of toolCalls) {
            toolCallXML += `<tool_use>\n  <name>${tc.name}</name>\n  <arguments>${JSON.stringify(tc.arguments)}</arguments>\n</tool_use>\n`;
        }

        // 构建 XML 格式的工具结果
        let toolResultXML = '';
        for (let i = 0; i < toolResults.length; i++) {
            const result = toolResults[i];
            const toolCall = toolCalls[i] || toolCalls.find(tc => tc.id === result.tool_call_id);
            const toolName = toolCall?.name || 'unknown';
            toolResultXML += `<tool_use_result>\n  <name>${toolName}</name>\n  <result>${result.content}</result>\n</tool_use_result>\n`;
        }

        return [
            // 1. assistant 消息：包含 XML 工具调用
            {
                role: 'assistant',
                content: toolCallXML.trim()
            },
            // 2. user 消息：包含 XML 工具结果
            {
                role: 'user',
                content: toolResultXML.trim()
            }
        ];
    }

    // 原生模式：使用 tool_calls 格式
    // 与 OpenAI/Gemini 保持一致：返回 OpenAI 格式
    // convertToClaudeMessages 会将这些消息转换为 Claude 格式
    const messages = [
        // 1. 添加助手消息（包含工具调用）- OpenAI 格式
        // content 字段必须存在（OpenAI API 要求）
        {
            role: 'assistant',
            content: '',  // 添加 content 字段（空字符串）
            tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments)
                }
            }))
        },
        // 2. 添加工具结果消息 - OpenAI 格式（附加工具名称用于 Claude 转换）
        ...toolResults.map(result => {
            // 查找对应的工具调用以获取名称
            const toolCall = toolCalls.find(tc => tc.id === result.tool_call_id);
            return {
                ...result,
                _toolName: toolCall?.name  // ⭐ 附加工具名称（Claude 转换时可能需要）
            };
        })
    ];

    return messages;
}
