/**
 * Gemini API 请求处理器
 * 支持 Google AI Studio 和 Vertex AI
 */

import { state, elements } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages, getOpeningMessages } from '../utils/prefill.js';
import { processVariables } from '../utils/variables.js';
import { compressImage } from '../utils/images.js';
import { filterMessagesByCapabilities } from '../utils/message-filter.js';
import { getCurrentModelCapabilities, getCurrentProvider } from '../providers/manager.js';
import { getOrCreateMappedId } from './format-converter.js';  // ID 重映射

/**
 * 将 OpenAI 格式的消息完整转换为 Gemini 格式
 * @param {Object} msg - OpenAI 格式的消息
 * @returns {Object} Gemini 格式的消息 { role, parts }
 */
function convertOpenAIMessageToGemini(msg) {
    // ⭐ 处理工具调用消息（assistant with tool_calls）
    if (msg.role === 'assistant' && msg.tool_calls) {
        return {
            role: 'model',
            parts: msg.tool_calls.map(tc => {
                // 解析 arguments（可能是字符串）
                let args;
                try {
                    args = typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments;
                } catch {
                    args = {};
                }

                // ID 重映射（OpenAI → Gemini）
                const geminiId = getOrCreateMappedId(tc.id, 'gemini');

                const functionCall = {
                    name: tc.function.name,
                    args: args
                };

                // 仅当 ID 存在且不是自动生成的 gemini_ 前缀时才包含
                if (geminiId && !geminiId.startsWith('gemini_')) {
                    functionCall.id = geminiId;
                }

                const part = { functionCall };

                // 恢复 thoughtSignature（如果存在）
                // Gemini 2.5+ thinking 模式要求：functionCall 部分必须包含 thoughtSignature
                if (tc._thoughtSignature) {
                    part.thoughtSignature = tc._thoughtSignature;
                    console.log('[Gemini Converter] 恢复 thoughtSignature:', tc._thoughtSignature?.substring(0, 20) + '...');
                } else {
                    console.warn('[Gemini Converter] ⚠️ 工具调用缺少 thoughtSignature:', tc.function?.name);
                }

                return part;
            })
        };
    }

    // ⭐ 处理工具结果消息（role: 'tool'）
    if (msg.role === 'tool') {
        // 解析 content（可能是 JSON 字符串）
        let resultContent;
        try {
            resultContent = typeof msg.content === 'string'
                ? JSON.parse(msg.content)
                : msg.content;
        } catch {
            resultContent = { value: msg.content };
        }

        // ID 重映射（OpenAI → Gemini）
        const geminiId = getOrCreateMappedId(msg.tool_call_id, 'gemini');

        // 多模态支持：检测并转换图片数据
        // 支持格式：
        // 1. { image: "data:image/png;base64,..." }
        // 2. { image: { inlineData: { mimeType, data } } }
        // 3. { image: { mimeType, data } }
        // 4. { text: "...", image: "..." } (混合)
        const responseParts = [];

        // 处理多模态返回（图片 + 文本）
        if (resultContent && typeof resultContent === 'object') {
            // 检查是否包含图片字段
            if (resultContent.image) {
                const imageData = resultContent.image;

                // 处理 base64 格式: "data:image/png;base64,..."
                if (typeof imageData === 'string' && imageData.startsWith('data:')) {
                    const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        responseParts.push({
                            inlineData: {
                                mimeType: match[1],
                                data: match[2]
                            }
                        });
                    }
                }
                // 处理已经是 inlineData 格式: { inlineData: { mimeType, data } }
                else if (imageData.inlineData) {
                    responseParts.push({
                        inlineData: imageData.inlineData
                    });
                }
                // 处理简化格式: { mimeType, data }
                else if (imageData.mimeType && imageData.data) {
                    responseParts.push({
                        inlineData: {
                            mimeType: imageData.mimeType,
                            data: imageData.data
                        }
                    });
                }
            }

            // 检查是否包含文本字段
            if (resultContent.text) {
                // 过滤掉图片占位符（避免重复显示）
                // 当同时有图片和文本时，移除 [Image #N] 格式的占位符
                let textContent = resultContent.text;
                if (responseParts.some(p => p.inlineData)) {
                    // 移除形如 [Image #1] 的占位符
                    textContent = textContent.replace(/\[Image #\d+\]/g, '').trim();
                }

                // 只在有实际文本内容时才添加
                if (textContent) {
                    responseParts.push({ text: textContent });
                }
            }

            // 如果有其他字段但不是 image/text，包装为 result
            const otherFields = { ...resultContent };
            delete otherFields.image;
            delete otherFields.text;
            if (Object.keys(otherFields).length > 0) {
                responseParts.push({ text: JSON.stringify(otherFields) });
            }
        }

        // 如果没有检测到多模态内容，使用原始格式
        if (responseParts.length === 0) {
            responseParts.push({
                text: typeof resultContent === 'string'
                    ? resultContent
                    : JSON.stringify(resultContent)
            });
        }

        // 构建 functionResponse
        const functionResponse = {
            name: msg._toolName || 'unknown',
            response: responseParts.length === 1 && responseParts[0].text && !(resultContent && typeof resultContent === 'object' && resultContent.image)
                ? { result: resultContent }  // 单纯文本保持原格式（向后兼容）
                : { parts: responseParts }  // 多模态使用 parts 格式
        };

        // 仅当 ID 存在且不是自动生成的时才包含
        if (geminiId && !geminiId.startsWith('gemini_')) {
            functionResponse.id = geminiId;
        }

        return {
            role: 'user',
            parts: [{ functionResponse }]
        };
    }

    // 处理普通消息
    const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
    const parts = [];

    // 处理 content
    if (typeof msg.content === 'string') {
        // 简单字符串格式
        if (msg.content) {
            parts.push({ text: msg.content });
        }
    } else if (Array.isArray(msg.content)) {
        // 多模态内容数组
        for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
                const textPart = { text: part.text };
                // 保留 part 级别的 thoughtSignature（如果存在）
                if (part.thoughtSignature) {
                    textPart.thoughtSignature = part.thoughtSignature;
                }
                parts.push(textPart);
            } else if (part.type === 'thinking' && part.text) {
                // ⚠️ Gemini 的思维链格式不同，暂时作为普通文本处理
                // 或者可以在外层添加 thoughtSignature 标记
                const thinkingPart = { text: `[Thinking]\n${part.text}` };
                // 保留 part 级别的 thoughtSignature（如果存在）
                if (part.thoughtSignature) {
                    thinkingPart.thoughtSignature = part.thoughtSignature;
                }
                parts.push(thinkingPart);
            } else if (part.type === 'image_url') {
                // 提取 base64 数据（图片）
                const url = part.image_url?.url || part.url;
                if (url) {
                    const match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        const imagePart = {
                            inlineData: {
                                mimeType: match[1],
                                data: match[2]
                            }
                        };
                        // 保留 part 级别的 thoughtSignature（如果存在）
                        if (part.thoughtSignature) {
                            imagePart.thoughtSignature = part.thoughtSignature;
                        }
                        parts.push(imagePart);
                    }
                }
            } else if (part.type === 'file' && part.file?.file_data) {
                // 提取 base64 数据（PDF 等文件）
                const fileData = part.file.file_data;
                const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    const filePart = {
                        inlineData: {
                            mimeType: match[1],
                            data: match[2]
                        }
                    };
                    // 保留 part 级别的 thoughtSignature（如果存在）
                    if (part.thoughtSignature) {
                        filePart.thoughtSignature = part.thoughtSignature;
                    }
                    parts.push(filePart);
                }
            }
        }
    }

    const result = { role: geminiRole, parts };

    // 保留 thoughtSignature（如果存在）
    // 这个签名来自之前的 API 响应，需要原样传回
    if (msg.thoughtSignature) {
        result.thoughtSignature = msg.thoughtSignature;
    }

    return result;
}

/**
 * 处理 contents 用于发送请求：压缩历史图片
 * @param {Array} contents - Gemini 格式的消息数组
 * @returns {Promise<Array>} 处理后的消息数组
 */
async function processContentsForRequest(contents) {
    const processed = [];

    for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        const isLastMessage = i === contents.length - 1;

        // 最后一条消息（当前用户输入）保持完整
        if (isLastMessage) {
            processed.push(content);
            continue;
        }

        // 处理 parts
        const processedParts = [];
        for (const part of content.parts) {
            if (part.inlineData || part.inline_data) {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType = inlineData.mimeType || inlineData.mime_type;
                const data = inlineData.data;

                // 压缩图片到 512px
                const compressed = await compressImage(data, mimeType, 512);

                processedParts.push({
                    inlineData: {
                        mimeType: compressed.mimeType,
                        data: compressed.data
                    },
                    // 保留 thoughtSignature
                    ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
                });
            } else {
                // 非图片部分直接保留
                processedParts.push(part);
            }
        }

        processed.push({
            role: content.role,
            parts: processedParts,
            // 保留消息级别的 thoughtSignature
            ...(content.thoughtSignature ? { thoughtSignature: content.thoughtSignature } : {})
        });
    }

    return processed;
}

/**
 * 构建带 thoughtSignature 的 Gemini contents
 * 全局传播签名：如果任何 content 有签名，所有 contents 都必须有
 * @param {Array} contents - Gemini 格式的消息数组
 * @returns {Array} 处理后的消息数组
 */
function buildGeminiContentsWithSignatures(contents) {
    // 第一遍扫描：检查是否有任何 content 或 part 包含 thoughtSignature
    let globalSignature = null;

    for (const content of contents) {
        // 检查消息级别的签名
        if (content.thoughtSignature) {
            globalSignature = content.thoughtSignature;
            console.log('[Gemini] 🔍 找到消息级别的 thoughtSignature');
            break;
        }

        // 检查 part 级别的签名
        if (content.parts) {
            const partSignature = content.parts.find(p => p.thoughtSignature)?.thoughtSignature;
            if (partSignature) {
                globalSignature = partSignature;
                console.log('[Gemini] 🔍 找到 part 级别的 thoughtSignature');
                break;
            }
        }
    }

    // 第二遍处理：如果找到签名，应用到所有 contents 的所有 parts
    if (globalSignature) {
        console.log('[Gemini] 将 thoughtSignature 应用到所有', contents.length, '个 contents');
        return contents.map(content => ({
            role: content.role,
            parts: content.parts.map(part => ({
                ...part,
                thoughtSignature: globalSignature  // 所有 part 都获得相同的签名
            }))
        }));
    }

    // 没有找到签名：保持原样（不自动生成签名）
    // 根据 Gemini 官方文档：签名应该从 API 响应中接收并原样传回，而不是客户端生成
    console.log('[Gemini] ℹ️ 未找到 thoughtSignature，保持原样');
    return contents.map(content => ({
        role: content.role,
        parts: content.parts
    }));
}

/**
 * 发送 Gemini 格式的请求
 * @param {string} baseEndpoint - API 端点基础路径
 * @param {string} apiKey - API 密钥
 * @param {string} model - 模型名称
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<Response>} Fetch Response
 */
export async function sendGeminiRequest(baseEndpoint, apiKey, model, signal = null) {
    // 根据流式模式选择正确的端点
    const action = state.streamEnabled ? 'streamGenerateContent' : 'generateContent';

    // 智能端点处理：根据提供商的原始 apiFormat 决定端点格式
    const provider = getCurrentProvider();
    const isNativeGeminiProvider = provider && provider.apiFormat === 'gemini';

    let endpoint;
    if (isNativeGeminiProvider) {
        // 原生 Gemini 提供商：清理路径并构建 Gemini 标准格式
        let cleanedEndpoint = baseEndpoint.replace(/\/$/, '');
        cleanedEndpoint = cleanedEndpoint
            .replace(/\/v1\/chat\/completions$/, '')  // 移除 OpenAI 路径
            .replace(/\/chat\/completions$/, '')
            .replace(/\/v1\/messages$/, '')  // 移除 Claude 路径
            .replace(/\/messages$/, '')
            .replace(/\/v1\/responses$/, '')  // 移除 OpenAI Responses 路径
            .replace(/\/responses$/, '');
        endpoint = `${cleanedEndpoint}/v1beta/models/${model}:${action}`;
        console.log('🔧 [Gemini] 原生 Gemini 提供商，构建标准端点:', endpoint);
    } else {
        // 统一代理（OpenAI/Claude/OpenAI-Responses 提供商切换格式）：
        // 保持原始端点不变，代理会根据请求体自动识别 Gemini 格式
        endpoint = baseEndpoint.replace(/\/$/, '');
        console.log('🔧 [Gemini] 统一代理模式（原始格式: ' + (provider?.apiFormat || 'unknown') + '），保持原始端点:', endpoint);
    }

    // 构建 generationConfig（使用自定义参数或默认值）
    const generationConfig = buildModelParams('gemini');

    // 获取图片配置
    const imageSize = elements.imageSizeSelect?.value;
    if (imageSize) {
        // 添加图片生成配置
        generationConfig.responseModalities = ['TEXT', 'IMAGE'];
        generationConfig.imageConfig = {
            imageSize: imageSize, // "2K" 或 "4K"
        };
    }

    // 添加思维链配置 (Gemini 3+ 使用 thinkingLevel，2.5 使用 thinkingBudget)
    const geminiThinkingConfig = buildThinkingConfig('gemini', model);
    if (geminiThinkingConfig) {
        generationConfig.thinkingConfig = geminiThinkingConfig.thinkingConfig;
    }

    // 根据端点判断使用 Vertex AI 还是 AI Studio 的安全设置
    let safetySettings;
    if (baseEndpoint.includes('aiplatform.googleapis.com')) {
        // Vertex AI 格式（10 个类别，threshold: "OFF"）
        safetySettings = [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_HATE', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_HARASSMENT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT', threshold: 'OFF' },
            { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
        ];
    } else {
        // AI Studio 格式（5 个类别，threshold: "BLOCK_NONE"）
        safetySettings = [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ];
    }

    // 处理 contents：先从 OpenAI 格式过滤消息，再转换为 Gemini 格式
    // 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    let openaiMessages = state.messages.filter(m => !m.isError);

    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        openaiMessages = filterMessagesByCapabilities(openaiMessages, capabilities);
        console.log('📋 [Gemini] 消息已根据模型能力过滤:', {
            capabilities,
            filteredCount: openaiMessages.length
        });
    }

    // 转换为 Gemini 格式（使用完整转换函数，保留所有内容）
    const geminiContents = openaiMessages
        .map(msg => convertOpenAIMessageToGemini(msg))
        .filter(msg => msg.parts && msg.parts.length > 0); // 过滤掉空消息

    // ⚠️ 安全检查：如果所有消息都被过滤掉，抛出错误
    if (geminiContents.length === 0) {
        throw new Error('所有消息都被过滤，无法发送请求。请至少输入一条有效消息。');
    }

    console.log('🔄 [Gemini] OpenAI → Gemini 转换完成:', geminiContents.length, '条消息');

    // 压缩历史图片以减小请求体积
    const processedContents = await processContentsForRequest(geminiContents);

    // 开场对话插入到对话历史之前（Gemini 的 systemInstruction 是独立参数）
    let finalContents = processedContents;
    if (state.prefillEnabled) {
        const opening = getOpeningMessages('gemini');
        if (opening.length > 0) {
            finalContents = [...opening, ...processedContents];
        }
    }

    // 预填充消息追加到末尾（用户最新消息之后）
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages('gemini');
        finalContents = [...finalContents, ...prefill];
    }

    // 构建带 thoughtSignature 的 contents
    // 只传播从 API 响应中接收到的签名，不自动生成新签名
    const contentsWithSignatures = buildGeminiContentsWithSignatures(finalContents);

    const requestBody = {
        contents: contentsWithSignatures,
        generationConfig: generationConfig,
        safetySettings: safetySettings,
    };

    // 添加 System Instruction (独立于预填充开关)
    const systemParts = [];

    // 1. 优先使用 geminiSystemParts（多段系统提示）- 仅在开关启用时
    if (state.geminiSystemPartsEnabled && state.geminiSystemParts && state.geminiSystemParts.length > 0) {
        state.geminiSystemParts.forEach(part => {
            if (part.text && part.text.trim()) {
                systemParts.push({ text: processVariables(part.text) });
            }
        });
    }

    // 2. 如果没有自定义 parts，但有 systemPrompt，使用单个 part
    if (systemParts.length === 0 && state.systemPrompt) {
        systemParts.push({ text: processVariables(state.systemPrompt) });
    }

    // 3. 添加到请求体
    if (systemParts.length > 0) {
        requestBody.systemInstruction = { parts: systemParts };
    }

    // ⭐ 添加工具调用支持 (Function Calling)
    const tools = [];

    // 1. Code Execution 工具（新增）
    if (state.codeExecutionEnabled) {
        tools.push({ codeExecution: {} });
        console.log('[Gemini] 📊 Code Execution 工具已启用');
    }

    // 2. Google Search 工具（保持不变）
    if (state.webSearchEnabled) {
        tools.push({ googleSearch: {} });
        tools.push({ urlContext: {} });  // 可选：允许读取 URL 内容
    }

    // 添加工具系统中的工具 (Function Declaration 格式)
    try {
        const { getToolsForAPI } = await import('../tools/manager.js');
        const systemTools = getToolsForAPI('gemini');
        if (systemTools.length > 0) {
            // Gemini 要求工具包装在 functionDeclarations 数组中
            tools.push({
                functionDeclarations: systemTools
            });
        }
    } catch (error) {
        console.warn('[Gemini] 工具系统未加载:', error);
    }

    if (tools.length > 0) {
        if (state.xmlToolCallingEnabled) {
            // XML 模式：只注入 XML 到 systemInstruction，不使用原生 tools 字段
            const { injectToolsToGemini, getXMLInjectionStats } = await import('../tools/tool-injection.js');
            injectToolsToGemini(requestBody, tools);

            // 性能监控
            const stats = getXMLInjectionStats(tools);
            console.log('[Gemini] 📊 XML 模式启用，注入统计:', stats);
        } else {
            // 原生模式：使用标准 tools 字段
            requestBody.tools = tools;
            console.log('[Gemini] 📊 原生 tools 模式，工具数量:', tools.length);
        }
    }

    console.log('Sending Gemini request:', JSON.stringify(requestBody, null, 2));

    // 构建请求头
    const headers = {
        'Content-Type': 'application/json',
        ...getCustomHeadersObject(), // 合并自定义请求头
    };

    // 根据配置决定 API key 传递方式
    let queryParams = '';
    if (state.geminiApiKeyInHeader) {
        // 方式1: 通过请求头传递（适用于代理服务器）
        headers['x-goog-api-key'] = apiKey;
        // 流式模式仅添加 alt=sse
        if (state.streamEnabled) {
            queryParams = 'alt=sse';
        }
    } else {
        // 方式2: 通过 URL 参数传递（标准 Gemini API）
        queryParams = state.streamEnabled
            ? `key=${apiKey}&alt=sse`
            : `key=${apiKey}`;
    }

    const options = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
    };
    if (signal) options.signal = signal;

    const fullUrl = queryParams ? `${endpoint}?${queryParams}` : endpoint;
    return await fetch(fullUrl, options);
}

/**
 * 构建 Gemini 工具结果消息（OpenAI 格式）
 * 注意：返回 OpenAI 格式的消息，由 sendGeminiRequest 在发送时转换为 Gemini 格式
 * @param {Array} toolCalls - 工具调用列表 [{id?, name, arguments}]
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
    // 与 OpenAI 保持一致：返回 OpenAI 格式
    // sendGeminiRequest 会将这些消息转换为 Gemini 格式
    const messages = [
        // 1. 添加助手消息（包含工具调用）- OpenAI 格式
        // content 字段必须存在（OpenAI API 要求）
        {
            role: 'assistant',
            content: '',  // 添加 content 字段（空字符串）
            tool_calls: toolCalls.map(tc => ({
                id: tc.id || `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments)
                },
                // 保存 thoughtSignature 到私有字段
                _thoughtSignature: tc.thoughtSignature || null
            }))
        },
        // 2. 添加工具结果消息 - OpenAI 格式（附加工具名称用于 Gemini 转换）
        ...toolResults.map(result => {
            // 优先使用已有的 _toolName，否则通过ID查找
            // 使用 _originalId 进行匹配（避免ID转换导致的匹配失败）
            if (!result._toolName) {
                const toolCall = toolCalls.find(tc =>
                    tc.id === result._originalId || tc.id === result.tool_call_id
                );
                result._toolName = toolCall?.name || 'unknown';
            }
            return result;
        })
    ];

    return messages;
}
