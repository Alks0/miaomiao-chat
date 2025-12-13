/**
 * 模板变量处理
 * 处理 {{char}}, {{user}}, {{date}}, {{time}} 等占位符
 */

/**
 * 处理模板变量替换
 * @param {string} template - 包含变量的模板字符串
 * @param {{charName?: string, userName?: string}} options - 变量配置
 * @returns {string} 替换后的字符串
 */
export function processVariables(template, options = {}) {
    if (!template) return '';

    const now = new Date();
    const vars = {
        '{{char}}': options.charName || 'Assistant',
        '{{user}}': options.userName || 'User',
        '{{date}}': now.toLocaleDateString('zh-CN'),
        '{{time}}': now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };

    let result = template;
    Object.entries(vars).forEach(([key, value]) => {
        // 转义正则表达式特殊字符
        result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    });

    return result;
}

/**
 * 获取预填充消息（根据 API 格式返回对应格式）
 * 注意：此函数依赖 state，将在实际使用时从 state 获取数据
 * @param {Array} prefillMessages - 预填充消息数组
 * @param {string} format - API 格式 ('openai'|'gemini'|'claude')
 * @param {{charName: string, userName: string}} variableOptions - 变量配置
 * @returns {Array} 预填充消息数组
 */
export function getPrefillMessages(prefillMessages, format, variableOptions) {
    if (!prefillMessages || !prefillMessages.length) return [];

    return prefillMessages
        .filter(m => m.role !== 'system')  // 过滤 system，避免混入对话
        .map(m => {
            const content = processVariables(m.content, variableOptions);

            if (format === 'gemini') {
                // Gemini 只支持 user 和 model 角色
                return {
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: content }]
                };
            }
            // OpenAI 和 Claude 格式相同
            return {
                role: m.role,
                content: content
            };
        });
}
