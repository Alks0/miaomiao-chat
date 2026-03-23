/**
 * 通用 XML 工具注入模块
 * 为不同 API 格式注入 XML 工具描述到 system prompt
 */

import { state } from '../core/state.js';
import { convertToolsToXML } from './xml-formatter.js';

/**
 * 为 OpenAI 格式注入 XML 工具描述
 * @param {Array} messages - OpenAI 格式的消息数组
 * @param {Array} tools - 工具列表（OpenAI 格式）
 */
export function injectToolsToOpenAI(messages, tools) {
    if (!state.xmlToolCallingEnabled || !tools || tools.length === 0) {
        return;
    }

    const xmlToolsDescription = convertToolsToXML(tools);

    // 注入到 system message
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
        systemMsg.content += xmlToolsDescription;
    } else {
        // 如果没有 system message，创建一个
        messages.unshift({
            role: 'system',
            content: xmlToolsDescription
        });
    }

    console.log('[Tool Injection] XML 工具描述已注入 OpenAI system prompt');
}

/**
 * 为 Claude 格式注入 XML 工具描述
 * @param {Object} requestBody - Claude API 请求体
 * @param {Array} tools - 工具列表（Claude 格式）
 */
export function injectToolsToClaude(requestBody, tools) {
    if (!state.xmlToolCallingEnabled || !tools || tools.length === 0) {
        return;
    }

    const xmlToolsDescription = convertToolsToXML(tools);

    // 注入到 system 参数（Claude 的 system 是顶层字符串）
    if (requestBody.system) {
        requestBody.system += xmlToolsDescription;
    } else {
        requestBody.system = xmlToolsDescription;
    }

    console.log('[Tool Injection] XML 工具描述已注入 Claude system 参数');
}

/**
 * 为 Gemini 格式注入 XML 工具描述
 * @param {Object} requestBody - Gemini API 请求体
 * @param {Array} tools - 工具列表（Gemini 格式，包含 functionDeclarations）
 */
export function injectToolsToGemini(requestBody, tools) {
    if (!state.xmlToolCallingEnabled || !tools || tools.length === 0) {
        return;
    }

    // 提取扁平的工具列表（去除 functionDeclarations 包装）
    const flatTools = tools.flatMap(t => t.functionDeclarations || [t]);
    const xmlToolsDescription = convertToolsToXML(flatTools);

    // 注入到 systemInstruction.parts（Gemini 支持多段）
    if (requestBody.systemInstruction) {
        requestBody.systemInstruction.parts.push({ text: xmlToolsDescription });
    } else {
        requestBody.systemInstruction = {
            parts: [{ text: xmlToolsDescription }]
        };
    }

    console.log('[Tool Injection] XML 工具描述已注入 Gemini systemInstruction');
}

/**
 * 性能监控 - 统计 XML 注入的 token 消耗
 * @param {Array} tools - 工具列表
 * @returns {Object} { toolCount, estimatedTokens }
 */
export function getXMLInjectionStats(tools) {
    if (!tools || tools.length === 0) {
        return { toolCount: 0, estimatedTokens: 0 };
    }

    const xmlDescription = convertToolsToXML(tools);
    // 粗略估算：1 token ≈ 4 字符
    const estimatedTokens = Math.ceil(xmlDescription.length / 4);

    return {
        toolCount: tools.length,
        estimatedTokens,
        descriptionLength: xmlDescription.length
    };
}

/**
 * 监控指标追踪（用于灰度发布和性能分析）
 * 在部署阶段 3（灰度发布）时启用
 */
const metrics = {
    xmlToolCallsAttempted: 0,
    xmlToolCallsSucceeded: 0,
    nativeToolCallsUsed: 0,
    averageXMLTokens: 0,
    errors: []
};

/**
 * 追踪 XML 工具调用的成功率和性能
 * @param {boolean} success - 是否成功
 * @param {number} tokenCount - 消耗的 token 数量
 * @param {string|null} error - 错误信息（如果失败）
 */
export function trackXMLToolCall(success, tokenCount, error = null) {
    metrics.xmlToolCallsAttempted++;

    if (success) {
        metrics.xmlToolCallsSucceeded++;
        // 计算平均 token 消耗（增量计算）
        metrics.averageXMLTokens =
            (metrics.averageXMLTokens * (metrics.xmlToolCallsSucceeded - 1) + tokenCount)
            / metrics.xmlToolCallsSucceeded;
    } else {
        metrics.errors.push({ timestamp: Date.now(), error });
        if (metrics.errors.length > 100) metrics.errors.shift();
    }

    // 每 100 次调用上报一次（可选：发送到监控服务）
    if (metrics.xmlToolCallsAttempted % 100 === 0) {
        console.log('[Tool Injection] 📊 XML Tool Calling Metrics:', metrics);
        // 可选：发送到监控服务
        // sendToMonitoringService(metrics);
    }
}

/**
 * 获取当前监控指标（用于调试和分析）
 */
export function getMetrics() {
    return {
        ...metrics,
        successRate: metrics.xmlToolCallsAttempted > 0
            ? (metrics.xmlToolCallsSucceeded / metrics.xmlToolCallsAttempted * 100).toFixed(2) + '%'
            : 'N/A',
        recentErrors: metrics.errors.slice(-10)  // 最近 10 个错误
    };
}

/**
 * 重置监控指标（用于测试）
 */
export function resetMetrics() {
    metrics.xmlToolCallsAttempted = 0;
    metrics.xmlToolCallsSucceeded = 0;
    metrics.nativeToolCallsUsed = 0;
    metrics.averageXMLTokens = 0;
    metrics.errors = [];
    console.log('[Tool Injection] 🧹 监控指标已重置');
}
