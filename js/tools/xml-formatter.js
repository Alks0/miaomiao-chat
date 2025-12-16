/**
 * XML 工具调用格式化器
 * 用于将工具转换为 CherryStudio 风格的 XML 格式
 */

/**
 * 转义 XML 特殊字符
 */
function escapeXML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * 将工具列表转换为 XML 描述（注入 system prompt）
 * @param {Array} tools - 工具列表（已经是 OpenAI/Claude/Gemini 格式）
 * @returns {string} XML 格式的工具描述
 */
export function convertToolsToXML(tools) {
    if (!tools || tools.length === 0) return '';

    // 提示过长警告
    if (tools.length > 20) {
        console.warn('[XML Formatter] 工具数量过多 (>20)，可能导致 system prompt 超长');
    }

    let xml = '\n\nIn this environment you have access to a set of tools you can use to answer the user\'s question.\n\n';
    xml += '## Tool Use Formatting\n\n';
    xml += 'Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, ';
    xml += 'and each parameter is similarly enclosed within its own set of tags. Here\'s the structure:\n\n';
    xml += '<tool_use>\n';
    xml += '  <name>{tool_name}</name>\n';
    xml += '  <arguments>{json_arguments}</arguments>\n';
    xml += '</tool_use>\n\n';

    // 工具列表
    xml += '## Available Tools\n\n';
    tools.forEach(tool => {
        // 提取工具信息（兼容不同格式）
        const name = tool.name || tool.function?.name;
        const description = tool.description || tool.function?.description;
        const parameters = tool.inputSchema || tool.input_schema || tool.parameters || tool.function?.parameters;

        if (!name) return; // 跳过无效工具

        xml += `<tool>\n`;
        xml += `  <name>${escapeXML(name)}</name>\n`;
        xml += `  <description>${escapeXML(description || 'No description')}</description>\n`;
        xml += `  <arguments>${escapeXML(JSON.stringify({ jsonSchema: parameters }))}</arguments>\n`;
        xml += `</tool>\n\n`;
    });

    // 详细示例
    xml += '## Tool Use Examples\n\n';
    xml += 'Here are some examples demonstrating proper tool use:\n\n';
    xml += '---\n';
    xml += 'User: What is the current time?\n\n';
    xml += 'Assistant: I will use the datetime tool to get the current time.\n';
    xml += '<tool_use>\n';
    xml += '  <name>datetime</name>\n';
    xml += '  <arguments>{"action": "current"}</arguments>\n';
    xml += '</tool_use>\n\n';
    xml += 'User: <tool_use_result>\n';
    xml += '  <name>datetime</name>\n';
    xml += '  <result>2025-12-14 15:30:00</result>\n';
    xml += '</tool_use_result>\n\n';
    xml += 'Assistant: The current time is 15:30:00 on December 14, 2025.\n\n';
    xml += '---\n';
    xml += 'User: Search for the latest AI news.\n\n';
    xml += 'Assistant: I will search for the latest AI news using the web_search tool.\n';
    xml += '<tool_use>\n';
    xml += '  <name>web_search</name>\n';
    xml += '  <arguments>{"query": "latest AI news 2025"}</arguments>\n';
    xml += '</tool_use>\n\n';
    xml += '---\n\n';

    // Extended Thinking 支持
    xml += '## Extended Thinking with Tools\n\n';
    xml += 'You can use <thinking> tags to show your reasoning process BEFORE calling tools:\n\n';
    xml += '<thinking>I need to check the weather in Tokyo, so I will call the weather tool.</thinking>\n';
    xml += '<tool_use>\n';
    xml += '  <name>weather</name>\n';
    xml += '  <arguments>{"location": "Tokyo"}</arguments>\n';
    xml += '</tool_use>\n\n';

    // 明确的规则
    xml += '## Tool Use Rules\n\n';
    xml += 'Here are the rules you MUST follow:\n';
    xml += '1. Always use the correct parameter values. Never use variable names, use actual values.\n';
    xml += '2. Call a tool only when needed. Do not call tools if you can answer directly.\n';
    xml += '3. If no tool is needed, just answer the question directly.\n';
    xml += '4. **CRITICAL**: Never repeat the exact same tool call with the same parameters.\n';
    xml += '5. **CRITICAL**: Simply mentioning a tool in <thinking> does NOT execute it. You MUST output the <tool_use> XML block.\n';
    xml += '6. Use the EXACT format shown above. Do not use any other format.\n\n';

    // 激励语句
    xml += 'Now Begin! If you use tools correctly, you will be rewarded.\n';

    return xml;
}

/**
 * 从文本中提取 XML 工具调用（完整匹配，非流式）
 * 支持多种 XML 格式：
 * 1. tool_use 格式 (CherryStudio)
 * 2. invoke 格式 (Claude native)
 * 3. function_call 格式 (一些代理)
 * 4. antml:invoke 格式 (Anthropic 官方)
 * @param {string} text - 模型响应文本
 * @returns {Array} 工具调用列表 [{ id, name, arguments }, ...]
 */
export function extractXMLToolCalls(text) {
    if (!text || typeof text !== 'string') return [];

    const toolCalls = [];
    let index = 0;

    // 格式 1: tool_use 格式 (CherryStudio 风格)
    // 使用更严格的正则：arguments 内容不能包含 <tool_use> 或 </tool_use>（防止嵌套匹配错误）
    const toolUseRegex = /<tool_use>\s*<name>([^<]*)<\/name>\s*<arguments>((?:(?!<\/?tool_use)[\s\S])*?)<\/arguments>\s*<\/tool_use>/gi;
    let match;
    while ((match = toolUseRegex.exec(text)) !== null) {
        const name = match[1].trim();
        const argsText = match[2].trim();
        try {
            const args = JSON.parse(argsText);
            toolCalls.push({
                id: `xml_tool_${Date.now()}_${index++}`,
                name,
                arguments: args
            });
            console.log('[XML Parser] 提取到 tool_use 格式工具调用:', name);
        } catch (error) {
            console.error('[XML Parser] tool_use 格式解析参数失败:', argsText.substring(0, 100), error);
        }
    }

    // 格式 2: function_call 格式 (一些代理使用)
    // 使用更严格的正则：arguments 内容不能包含 <function_call> 或 </function_call>
    const functionCallRegex = /<function_call>\s*<name>([^<]*)<\/name>\s*<arguments>((?:(?!<\/?function_call)[\s\S])*?)<\/arguments>\s*<\/function_call>/gi;
    while ((match = functionCallRegex.exec(text)) !== null) {
        const name = match[1].trim();
        const argsText = match[2].trim();
        try {
            const args = JSON.parse(argsText);
            toolCalls.push({
                id: `xml_tool_${Date.now()}_${index++}`,
                name,
                arguments: args
            });
            console.log('[XML Parser] 提取到 function_call 格式工具调用:', name);
        } catch (error) {
            console.error('[XML Parser] function_call 格式解析参数失败:', argsText.substring(0, 100), error);
        }
    }

    // 格式 3: invoke 格式 (Claude native XML)
    // 匹配: <invoke name="xxx"> <parameter name="yyy">value</parameter>... </invoke>
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    while ((match = invokeRegex.exec(text)) !== null) {
        const name = match[1].trim();
        const paramsContent = match[2];
        const args = {};

        // 解析 parameter 标签
        const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
            const paramName = paramMatch[1].trim();
            let paramValue = paramMatch[2].trim();
            // 尝试解析 JSON 值
            try {
                paramValue = JSON.parse(paramValue);
            } catch (e) {
                // 保留字符串值
            }
            args[paramName] = paramValue;
        }

        if (Object.keys(args).length > 0 || paramsContent.trim() === '') {
            toolCalls.push({
                id: `xml_tool_${Date.now()}_${index++}`,
                name,
                arguments: args
            });
            console.log('[XML Parser] 提取到 invoke 格式工具调用:', name);
        }
    }

    // 格式 4: antml:invoke 格式 - 使用与 invoke 相同的正则，因为标签名相同
    // 已由格式 3 处理

    // 输出解析结果日志
    if (toolCalls.length > 0) {
        console.log('[XML Parser] 共提取到', toolCalls.length, '个工具调用');
    }

    return toolCalls;
}

/**
 * XML 流式累积器（流式解析）
 * 处理流式响应中可能截断的 XML 标签
 * 支持 thinking 标签（Claude Extended Thinking with Tools）
 */
export class XMLStreamAccumulator {
    constructor() {
        this.buffer = '';           // 累积的文本
        this.displayText = '';      // 展示给用户的文本（不含 XML 标签）
        this.inToolUse = false;     // 是否在 tool_use/invoke 标签内
        this.inThinking = false;    // 是否在 thinking 标签内
        this.currentToolXML = '';   // 当前工具的 XML
        this.currentThinking = '';  // 当前思考的内容
        this.completedCalls = [];   // 已完成的工具调用
        this.thinkingBlocks = [];   // 已完成的思考块
    }

    /**
     * 处理增量文本
     * @param {string} deltaText - 流式增量文本
     * @returns {Object} { hasToolCalls: boolean, displayText: string, error: string|null }
     */
    processDelta(deltaText) {
        if (!deltaText) return { hasToolCalls: false, displayText: this.displayText, error: null };

        try {
            this.buffer += deltaText;

            // 错误边界 - 检测过长的 buffer（防止内存泄漏）
            if (this.buffer.length > 50000) {
                console.error('[XMLStreamAccumulator] Buffer 过长，可能存在格式错误');
                this.buffer = this.buffer.slice(-1000);
                this.inToolUse = false;
                this.currentToolXML = '';
                return {
                    hasToolCalls: this.completedCalls.length > 0,
                    displayText: this.displayText,
                    error: 'Buffer overflow, possible malformed XML'
                };
            }

            // 检测 thinking 开始
            const thinkingStartMatch = this.buffer.match(/<thinking>/);
            if (thinkingStartMatch && !this.inThinking && !this.inToolUse) {
                this.inThinking = true;
                const beforeTag = this.buffer.substring(0, thinkingStartMatch.index);
                this.displayText += beforeTag;
                // 保留开始标签到 currentThinking
                this.currentThinking = this.buffer.substring(thinkingStartMatch.index);
                this.buffer = '';
            }

            // 检测 tool_use 或 invoke 开始
            const toolStartMatch = this.buffer.match(/<(tool_use|invoke\s+name="[^"]+")/);
            if (toolStartMatch && !this.inToolUse && !this.inThinking) {
                this.inToolUse = true;
                const beforeTag = this.buffer.substring(0, toolStartMatch.index);
                this.displayText += beforeTag;
                // 保留开始标签到 currentToolXML
                this.currentToolXML = this.buffer.substring(toolStartMatch.index);
                this.buffer = '';
            }

            // 累积思考内容
            if (this.inThinking) {
                this.currentThinking += deltaText;

                if (this.currentThinking.length > 20000) {
                    console.error('[XMLStreamAccumulator] 单个思考块过长，跳过');
                    this.inThinking = false;
                    this.currentThinking = '';
                    this.buffer = '';
                    return {
                        hasToolCalls: this.completedCalls.length > 0,
                        displayText: this.displayText,
                        error: 'Single thinking block too large'
                    };
                }

                // 检测 thinking 结束
                const thinkingEndMatch = this.currentThinking.match(/<\/thinking>/);
                if (thinkingEndMatch) {
                    this.inThinking = false;
                    const thinkingContent = this.currentThinking
                        .replace(/<thinking>/, '')
                        .replace(/<\/thinking>/, '')
                        .trim();

                    if (thinkingContent) {
                        this.thinkingBlocks.push(thinkingContent);
                        console.log('[XMLStreamAccumulator] 检测到思考块:', thinkingContent.substring(0, 50) + '...');
                    }

                    const afterTag = this.currentThinking.substring(thinkingEndMatch.index + '</thinking>'.length);
                    this.buffer = afterTag;
                    this.currentThinking = '';
                }
            }
            // 累积工具 XML
            else if (this.inToolUse) {
                this.currentToolXML += deltaText;

                if (this.currentToolXML.length > 10000) {
                    console.error('[XMLStreamAccumulator] 单个工具调用过长，跳过');
                    this.inToolUse = false;
                    this.currentToolXML = '';
                    this.buffer = '';
                    return {
                        hasToolCalls: this.completedCalls.length > 0,
                        displayText: this.displayText,
                        error: 'Single tool call too large'
                    };
                }

                // 检测 tool_use 或 invoke 结束
                const endMatch = this.currentToolXML.match(/<\/(tool_use|invoke)>/);
                if (endMatch) {
                    this.inToolUse = false;

                    try {
                        // 调试日志：显示原始 XML 内容
                        console.log('[XMLStreamAccumulator] 原始 XML 内容:', this.currentToolXML);

                        const toolCalls = extractXMLToolCalls(this.currentToolXML);
                        if (toolCalls.length > 0) {
                            this.completedCalls.push(...toolCalls);
                        } else {
                            console.warn('[XMLStreamAccumulator] 解析 XML 未提取到工具调用，XML:', this.currentToolXML.substring(0, 500));
                        }
                    } catch (parseError) {
                        console.error('[XMLStreamAccumulator] 解析 XML 失败:', parseError, 'XML:', this.currentToolXML.substring(0, 500));
                    }

                    const closingTag = endMatch[0];
                    const afterTag = this.currentToolXML.substring(endMatch.index + closingTag.length);
                    this.buffer = afterTag;
                    this.currentToolXML = '';
                }
            } else {
                // 不在标签内，累积为展示文本
                this.displayText += deltaText;
                this.buffer = '';
            }

            return {
                hasToolCalls: this.completedCalls.length > 0,
                displayText: this.displayText,
                error: null
            };

        } catch (error) {
            console.error('[XMLStreamAccumulator] processDelta 异常:', error);
            this.inToolUse = false;
            this.buffer = '';
            this.currentToolXML = '';
            return {
                hasToolCalls: this.completedCalls.length > 0,
                displayText: this.displayText,
                error: error.message
            };
        }
    }

    /**
     * 获取已完成的工具调用
     */
    getCompletedCalls() {
        return this.completedCalls;
    }

    /**
     * 获取已完成的思考块
     * @returns {Array} 思考内容数组
     */
    getThinkingBlocks() {
        return this.thinkingBlocks;
    }

    /**
     * 重置累积器
     */
    reset() {
        this.buffer = '';
        this.displayText = '';
        this.inToolUse = false;
        this.inThinking = false;
        this.currentToolXML = '';
        this.currentThinking = '';
        this.completedCalls = [];
        this.thinkingBlocks = [];
    }
}