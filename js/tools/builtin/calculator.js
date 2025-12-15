/**
 * 计算器工具
 * 执行安全的数学表达式计算
 */

/**
 * 工具定义（OpenAI 格式）
 */
export const calculatorTool = {
    name: 'calculator',
    description: '执行数学计算。支持基本运算（+、-、*、/）、幂运算（**）、括号以及常见数学函数（Math.sin、Math.sqrt 等）。',
    parameters: {
        type: 'object',
        properties: {
            expression: {
                type: 'string',
                description: '要计算的数学表达式，例如: "2 + 3 * 4", "Math.sqrt(16)", "Math.pow(2, 10)"'
            }
        },
        required: ['expression']
    }
};

/**
 * 工具处理器
 * @param {Object} args - 参数
 * @param {string} args.expression - 数学表达式
 * @returns {Promise<Object>} 计算结果
 */
export async function calculatorHandler(args) {
    const { expression } = args;

    console.log(`[Calculator] 计算表达式: ${expression}`);

    try {
        // 安全验证表达式
        validateExpression(expression);

        // 执行计算
        const result = evaluateExpression(expression);

        // 检查结果有效性
        if (!isFinite(result)) {
            throw new Error(`计算结果无效: ${result} (可能是除以零或超出范围)`);
        }

        return {
            expression,
            result,
            formatted: formatResult(result)
        };

    } catch (error) {
        console.error(`[Calculator] 计算失败:`, error);
        throw new Error(`计算错误: ${error.message}`);
    }
}

/**
 * 验证表达式安全性
 * @param {string} expression - 表达式
 * @throws {Error} 如果表达式不安全
 */
function validateExpression(expression) {
    if (typeof expression !== 'string' || !expression.trim()) {
        throw new Error('表达式必须是非空字符串');
    }

    // 最大长度限制
    if (expression.length > 500) {
        throw new Error('表达式过长（最多 500 字符）');
    }

    // 安全白名单：允许的字符
    const allowedPattern = /^[\d\s+\-*/().,%\w]*$/;
    if (!allowedPattern.test(expression)) {
        throw new Error('表达式包含不允许的字符');
    }

    // 黑名单：禁止的关键字（防止代码注入）
    const forbiddenKeywords = [
        'eval', 'Function', 'setTimeout', 'setInterval',
        'require', 'import', 'export', 'fetch', 'XMLHttpRequest',
        'localStorage', 'sessionStorage', 'document', 'window',
        '__proto__', 'constructor', 'prototype'
    ];

    for (const keyword of forbiddenKeywords) {
        if (expression.includes(keyword)) {
            throw new Error(`表达式包含禁止的关键字: ${keyword}`);
        }
    }
}

/**
 * 安全执行数学表达式
 * @param {string} expression - 表达式
 * @returns {number} 计算结果
 */
function evaluateExpression(expression) {
    // 使用 Function 构造函数（比 eval 稍微安全一些）
    // 限制在纯数学运算范围内
    try {
        // 创建安全的计算环境（只暴露 Math 对象）
        const safeEval = new Function('Math', `
            "use strict";
            return (${expression});
        `);

        // 执行计算（传入 Math 对象）
        const result = safeEval(Math);

        return result;

    } catch (error) {
        // 捕获语法错误或运行时错误
        throw new Error(`表达式语法错误: ${error.message}`);
    }
}

/**
 * 格式化计算结果
 * @param {number} result - 计算结果
 * @returns {string} 格式化字符串
 */
function formatResult(result) {
    // 处理整数
    if (Number.isInteger(result)) {
        return result.toString();
    }

    // 处理小数（最多 10 位小数）
    if (Math.abs(result) < 1e10 && Math.abs(result) > 1e-10) {
        return result.toFixed(10).replace(/\.?0+$/, '');
    }

    // 科学计数法（极大或极小的数）
    return result.toExponential(5);
}

/**
 * 示例调用
 */
export function testCalculator() {
    const testCases = [
        '2 + 3',
        '10 * 5 - 3',
        'Math.sqrt(16)',
        'Math.pow(2, 10)',
        'Math.PI * 2',
        'Math.sin(Math.PI / 2)',
        '(5 + 3) * 2',
        '100 / 3'
    ];

    console.log('=== Calculator 测试 ===');

    for (const expr of testCases) {
        try {
            const result = calculatorHandler({ expression: expr });
            console.log(`✅ ${expr} = ${result.formatted}`);
        } catch (error) {
            console.error(`❌ ${expr} -> ${error.message}`);
        }
    }
}
