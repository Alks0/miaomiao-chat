/**
 * Gemini API 请求处理器
 * 支持 Google AI Studio 和 Vertex AI
 */

import { state, elements } from '../core/state.js';
import { buildModelParams, buildThinkingConfig, getCustomHeadersObject } from './params.js';
import { getPrefillMessages } from '../utils/prefill.js';
import { processVariables } from '../utils/variables.js';
import { compressImage } from '../utils/images.js';
import { filterMessagesByCapabilities } from '../utils/message-filter.js';
import { getCurrentModelCapabilities, getCurrentProvider } from '../providers/manager.js';
import { getOrCreateMappedId } from './format-converter.js';  // ✅ P0: ID 重映射

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

                // ✅ P0: ID 重映射（OpenAI → Gemini）
                const geminiId = getOrCreateMappedId(tc.id, 'gemini');

                const functionCall = {
                    name: tc.function.name,
                    args: args
                };

                // ✅ 仅当 ID 存在且不是自动生成的 gemini_ 前缀时才包含
                if (geminiId && !geminiId.startsWith('gemini_')) {
                    functionCall.id = geminiId;
                }

                const part = { functionCall };

                // ✅ P1: 恢复 thoughtSignature（如果存在）
                // Gemini 2.5+ thinking 模式要求：functionCall 部分必须包含 thoughtSignature
                if (tc._thoughtSignature) {
                    part.thoughtSignature = tc._thoughtSignature;
                    console.log('[Gemini Converter] ✅ 恢复 thoughtSignature:', tc._thoughtSignature?.substring(0, 20) + '...');
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

        // ✅ P0: ID 重映射（OpenAI → Gemini）
        const geminiId = getOrCreateMappedId(msg.tool_call_id, 'gemini');

        // 查找对应的工具调用消息以获取 name
        // 注意：Gemini 需要通过 name 匹配，不是 ID
        const functionResponse = {
            name: msg._toolName || 'unknown',  // 需要在前面设置
            response: { result: resultContent }
        };

        // ✅ 仅当 ID 存在且不是自动生成的时才包含
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
                parts.push({ text: part.text });
            } else if (part.type === 'thinking' && part.text) {
                // ⚠️ Gemini 的思维链格式不同，暂时作为普通文本处理
                // 或者可以在外层添加 thoughtSignature 标记
                parts.push({ text: `[Thinking]\n${part.text}` });
            } else if (part.type === 'image_url') {
                // 提取 base64 数据
                const url = part.image_url?.url || part.url;
                if (url) {
                    const match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        parts.push({
                            inlineData: {
                                mimeType: match[1],
                                data: match[2]
                            }
                        });
                    }
                }
            }
        }
    }

    return { role: geminiRole, parts };
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
 * @param {Array} contents - Gemini 格式的消息数组
 * @returns {Array} 带 thoughtSignature 的消息数组
 */
function buildGeminiContentsWithSignatures(contents) {
    return contents.map(content => {
        // ✅ 修复：检查消息级别或任何 part 是否有 thoughtSignature
        const messageSignature = content.thoughtSignature;
        const anyPartHasSignature = content.parts.some(part => part.thoughtSignature);

        if (messageSignature || anyPartHasSignature) {
            // 获取签名（优先使用消息级别，否则使用第一个有签名的 part）
            const signature = messageSignature || content.parts.find(part => part.thoughtSignature)?.thoughtSignature;

            // ✅ Gemini thinking 模式要求：如果任何 part 有签名，所有 parts 都必须有相同的签名
            // 否则会报错 "Image part is missing a thought_signature"
            return {
                role: content.role,
                parts: content.parts.map(part => ({
                    ...part,
                    thoughtSignature: signature
                }))
            };
        }

        // 没有签名的消息保持原样
        return { role: content.role, parts: content.parts };
    });
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

    // ✅ 智能端点处理：根据提供商的原始 apiFormat 决定端点格式
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
    // ✅ 根据模型能力过滤消息（在格式转换前，OpenAI格式）
    let openaiMessages = state.messages.filter(m => !m.isError);

    const capabilities = getCurrentModelCapabilities();
    if (capabilities) {
        openaiMessages = filterMessagesByCapabilities(openaiMessages, capabilities);
        console.log('📋 [Gemini] 消息已根据模型能力过滤:', {
            capabilities,
            filteredCount: openaiMessages.length
        });
    }

    // ✅ 转换为 Gemini 格式（使用完整转换函数，保留所有内容）
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

    // ✅ 预填充消息追加到末尾（用户最新消息之后）
    let finalContents = processedContents;
    if (state.prefillEnabled) {
        const prefill = getPrefillMessages('gemini');
        finalContents = [...processedContents, ...prefill];
    }

    // 构建带 thoughtSignature 的 contents
    const contentsWithSignatures = buildGeminiContentsWithSignatures(finalContents);

    const requestBody = {
        contents: contentsWithSignatures,
        generationConfig: generationConfig,
        safetySettings: safetySettings,
    };

    // ✅ 添加 System Instruction (独立于预填充开关)
    const systemParts = [];

    // 1. 优先使用 geminiSystemParts（多段系统提示）
    if (state.geminiSystemParts && state.geminiSystemParts.length > 0) {
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

    // 保留原有的 google_search（用户要求保持不变）
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
            // ✅ XML 模式：只注入 XML 到 systemInstruction，不使用原生 tools 字段
            const { injectToolsToGemini, getXMLInjectionStats } = await import('../tools/tool-injection.js');
            injectToolsToGemini(requestBody, tools);

            // ✅ P1: 性能监控
            const stats = getXMLInjectionStats(tools);
            console.log('[Gemini] 📊 XML 模式启用，注入统计:', stats);
        } else {
            // ✅ 原生模式：使用标准 tools 字段
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
    // ✅ 与 OpenAI 保持一致：返回 OpenAI 格式
    // sendGeminiRequest 会将这些消息转换为 Gemini 格式
    const messages = [
        // 1. 添加助手消息（包含工具调用）- OpenAI 格式
        {
            role: 'assistant',
            tool_calls: toolCalls.map(tc => ({
                id: tc.id || `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments)
                },
                // ✅ P1: 保存 thoughtSignature 到私有字段
                _thoughtSignature: tc.thoughtSignature || null
            }))
        },
        // 2. 添加工具结果消息 - OpenAI 格式（附加工具名称用于 Gemini 转换）
        ...toolResults.map(result => {
            // 查找对应的工具调用以获取名称
            const toolCall = toolCalls.find(tc => tc.id === result.tool_call_id);
            return {
                ...result,
                _toolName: toolCall?.name  // ⭐ 附加工具名称（Gemini 转换时需要）
            };
        })
    ];

    return messages;
}
