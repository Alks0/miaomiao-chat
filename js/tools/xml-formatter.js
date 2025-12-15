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
        console.warn('[XML Formatter] ⚠️ 工具数量过多 (>20)，可能导致 system prompt 超长');
    }

    let xml = '\n\nIn this environment you have access to a set of tools you can use to answer the user\'s question.\n\n';
    xml += '## Tool Use Formatting\n\n';
    xml += 'Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, ';
    xml += 'and each parameter is similarly enclosed within its own set of tags. Here\'s the structure:\n\n';
    xml += '<tool_use>\n';
    xml += '  <name>{tool_name}</name>\n';
    xml += '  <arguments>{json_arguments}</arguments>\n';
    xml += '</tool_use>\n\n';

    // ✅ 工具列表
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

    // ✅ 详细示例
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

    // ✅ Extended Thinking 支持
    xml += '## Extended Thinking with Tools\n\n';
    xml += 'You can use <thinking> tags to show your reasoning process BEFORE calling tools:\n\n';
    xml += '<thinking>I need to check the weather in Tokyo, so I will call the weather tool.</thinking>\n';
    xml += '<tool_use>\n';
    xml += '  <name>weather</name>\n';
    xml += '  <arguments>{"location": "Tokyo"}</arguments>\n';
    xml += '</tool_use>\n\n';

    // ✅ 明确的规则
    xml += '## Tool Use Rules\n\n';
    xml += 'Here are the rules you MUST follow:\n';
    xml += '1. Always use the correct parameter values. Never use variable names, use actual values.\n';
    xml += '2. Call a tool only when needed. Do not call tools if you can answer directly.\n';
    xml += '3. If no tool is needed, just answer the question directly.\n';
    xml += '4. **CRITICAL**: Never repeat the exact same tool call with the same parameters.\n';
    xml += '5. **CRITICAL**: Simply mentioning a tool in <thinking> does NOT execute it. You MUST output the <tool_use> XML block.\n';
    xml += '6. Use the EXACT format shown above. Do not use any other format.\n\n';

    // ✅ 激励语句
    xml += 'Now Begin! If you use tools correctly, you will be rewarded.\n';

    return xml;
}

/**
 * 从文本中提取 XML 工具调用（完整匹配，非流式）
 * @param {string} text - 模型响应文本
 * @returns {Array} 工具调用列表 [{ id, name, arguments }, ...]
 */
export function extractXMLToolCalls(text) {
    if (!text || typeof text !== 'string') return [];

    const toolCalls = [];

    // 正则表达式：匹配 <tool_use>...</tool_use>
    const regex = /<tool_use>\s*<name>(.*?)<\/name>\s*<arguments>(.*?)<\/arguments>\s*<\/tool_use>/gs;

    let match;
    let index = 0;
    while ((match = regex.exec(text)) !== null) {
        const name = match[1].trim();
        const argsText = match[2].trim();

        try {
            const args = JSON.parse(argsText);
            toolCalls.push({
                id: `xml_tool_${Date.now()}_${index}`,  // 生成唯一 ID
                name,
                arguments: args
            });
            index++;
        } catch (error) {
            console.error('[XML Parser] ❌ 解析工具参数失败:', argsText, error);
            // 继续解析下一个
        }
    }

    return toolCalls;
}

/**
 * XML 流式累积器（流式解析）
 * 处理流式响应中可能截断的 XML 标签
 * ✅ P1 改进：支持 <thinking> 标签（Claude 4 Extended Thinking with Tools）
 *
 * 注意：与 tool-call-handler.js 中的 ToolCallAccumulator 不同
 * - ToolCallAccumulator: 处理原生 tool_calls 格式
 * - XMLStreamAccumulator: 处理 XML <tool_use> 格式
 */
export class XMLStreamAccumulator {
    constructor() {
        this.buffer = '';           // 累积的文本
        this.displayText = '';      // 展示给用户的文本（不含 XML 标签）
        this.inToolUse = false;     // 是否在 <tool_use> 标签内
        this.inThinking = false;    // ✅ P1: 是否在 <thinking> 标签内
        this.currentToolXML = '';   // 当前工具的 XML
        this.currentThinking = '';  // ✅ P1: 当前思考的 XML
        this.completedCalls = [];   // 已完成的工具调用
        this.thinkingBlocks = [];   // ✅ P1: 已完成的思考块
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

            // ✅ P0: 错误边界 - 检测过长的 buffer（防止内存泄漏）
            if (this.buffer.length > 50000) {
                console.error('[XMLStreamAccumulator] ⚠️ Buffer 过长，可能存在格式错误');
                // 恢复策略：保留最后 1000 字符，丢弃前面的内容
                this.buffer = this.buffer.slice(-1000);
                this.inToolUse = false;
                this.currentToolXML = '';
                return {
                    hasToolCalls: this.completedCalls.length > 0,
                    displayText: this.displayText,
                    error: 'Buffer overflow, possible malformed XML'
                };
            }

            // ✅ P1: 检测 <thinking> 开始（Claude 4 Extended Thinking with Tools）
            const thinkingStartMatch = this.buffer.match(/<thinking>/);
            if (thinkingStartMatch && !this.inThinking && !this.inToolUse) {
                this.inThinking = true;

                // 提取标签前的文本作为展示内容
                const beforeTag = this.buffer.substring(0, thinkingStartMatch.index);
                this.displayText += beforeTag;

                // 重置 buffer，保留标签及之后的内容
                this.buffer = this.buffer.substring(thinkingStartMatch.index);
                this.currentThinking = '';
            }

            // 检测 <tool_use> 开始
            const startMatch = this.buffer.match(/<tool_use>/);
            if (startMatch && !this.inToolUse && !this.inThinking) {
                this.inToolUse = true;

                // 提取标签前的文本作为展示内容
                const beforeTag = this.buffer.substring(0, startMatch.index);
                this.displayText += beforeTag;

                // 重置 buffer，保留标签及之后的内容
                this.buffer = this.buffer.substring(startMatch.index);
                this.currentToolXML = '';
            }

            // ✅ P1: 累积思考 XML
            if (this.inThinking) {
                this.currentThinking += deltaText;

                // 检测过长的思考块（单个思考块不应超过 20KB）
                if (this.currentThinking.length > 20000) {
                    console.error('[XMLStreamAccumulator] ⚠️ 单个思考块过长，跳过');
                    this.inThinking = false;
                    this.currentThinking = '';
                    this.buffer = '';
                    return {
                        hasToolCalls: this.completedCalls.length > 0,
                        displayText: this.displayText,
                        error: 'Single thinking block too large'
                    };
                }

                // 检测 </thinking> 结束
                const thinkingEndMatch = this.currentThinking.match(/<\/thinking>/);
                if (thinkingEndMatch) {
                    this.inThinking = false;

                    // 提取思考内容（去除标签）
                    const thinkingContent = this.currentThinking
                        .replace(/<thinking>/, '')
                        .replace(/<\/thinking>/, '')
                        .trim();

                    if (thinkingContent) {
                        this.thinkingBlocks.push(thinkingContent);
                        console.log('[XMLStreamAccumulator] 🧠 检测到思考块:', thinkingContent.substring(0, 50) + '...');
                    }

                    // 清空 buffer，保留标签后的内容
                    const afterTag = this.currentThinking.substring(thinkingEndMatch.index + '</thinking>'.length);
                    this.buffer = afterTag;
                    this.currentThinking = '';
                }
            }
            // 累积工具 XML
            else if (this.inToolUse) {
                this.currentToolXML += deltaText;

                // ✅ P0: 错误边界 - 检测过长的工具调用（单个工具不应超过 10KB）
                if (this.currentToolXML.length > 10000) {
                    console.error('[XMLStreamAccumulator] ⚠️ 单个工具调用过长，跳过');
                    // 恢复策略：放弃当前工具，继续解析后续内容
                    this.inToolUse = false;
                    this.currentToolXML = '';
                    this.buffer = '';
                    return {
                        hasToolCalls: this.completedCalls.length > 0,
                        displayText: this.displayText,
                        error: 'Single tool call too large'
                    };
                }

                // 检测 </tool_use> 结束
                const endMatch = this.currentToolXML.match(/<\/tool_use>/);
                if (endMatch) {
                    this.inToolUse = false;

                    // ✅ P0: 错误处理 - 解析失败时不崩溃
                    try {
                        const toolCalls = extractXMLToolCalls(this.currentToolXML);
                        if (toolCalls.length > 0) {
                            this.completedCalls.push(...toolCalls);
                        } else {
                            console.warn('[XMLStreamAccumulator] ⚠️ 解析 XML 未提取到工具调用');
                        }
                    } catch (parseError) {
                        console.error('[XMLStreamAccumulator] ❌ 解析 XML 失败:', parseError);
                        // 不阻塞流程，继续处理后续内容
                    }

                    // 清空 buffer，保留标签后的内容
                    const afterTag = this.currentToolXML.substring(endMatch.index + '</tool_use>'.length);
                    this.buffer = afterTag;
                    this.currentToolXML = '';
                }
            } else {
                // 不在工具标签或思考标签内，累积为展示文本
                this.displayText += deltaText;
                this.buffer = ''; // 清空 buffer
            }

            return {
                hasToolCalls: this.completedCalls.length > 0,
                displayText: this.displayText,
                error: null
            };

        } catch (error) {
            // ✅ P0: 顶层错误边界 - 捕获所有异常
            console.error('[XMLStreamAccumulator] ❌ processDelta 异常:', error);
            // 恢复策略：重置状态，返回当前结果
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
     * ✅ P1: 获取已完成的思考块（Claude 4 Extended Thinking with Tools）
     * @returns {Array<string>} 思考内容数组
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
        this.inThinking = false;  // ✅ P1: 重置思考状态
        this.currentToolXML = '';
        this.currentThinking = '';  // ✅ P1: 重置当前思考
        this.completedCalls = [];
        this.thinkingBlocks = [];  // ✅ P1: 重置思考块
    }
}
