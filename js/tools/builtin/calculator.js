/**
 * 计算器工具
 * 使用 math.js 执行安全的数学表达式计算
 * 无 eval/Function 风险
 */

// 使用全局 math 对象（由 UMD 构建版本提供）
// math.js 已通过 <script> 标签在 index.html 中加载
const math = window.math;

if (!math) {
    throw new Error('math.js 未加载，请确保在 index.html 中包含了 math.js 的 script 标签');
}

// 配置安全选项
math.config({
    number: 'number', // 使用原生 JavaScript 数字
    precision: 64 // 精度
});

/**
 * 工具定义（OpenAI 格式）
 */
export const calculatorTool = {
    name: 'calculator',
    description: '执行数学计算。支持基本运算（+、-、*、/）、幂运算（^）、括号以及常见数学函数（sin、sqrt、log 等）。',
    parameters: {
        type: 'object',
        properties: {
            expression: {
                type: 'string',
                description: '要计算的数学表达式，例如: "2 + 3 * 4", "sqrt(16)", "2^10", "sin(pi/2)"'
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

        // 使用 math.js 安全执行（无 eval）
        const result = math.evaluate(expression);

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

    // 黑名单：禁止危险的函数调用
    // math.js 已经限制了作用域，这里是额外的防护层
    const forbiddenKeywords = [
        'eval', 'Function', 'setTimeout', 'setInterval',
        'require', 'import', 'export', 'fetch', 'XMLHttpRequest',
        'localStorage', 'sessionStorage', 'document', 'window',
        '__proto__', 'constructor', 'prototype'
    ];

    const lowerExpression = expression.toLowerCase();
    for (const keyword of forbiddenKeywords) {
        if (lowerExpression.includes(keyword.toLowerCase())) {
            throw new Error(`表达式包含禁止的关键字: ${keyword}`);
        }
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
        'sqrt(16)',
        '2^10',
        'pi * 2',
        'sin(pi / 2)',
        '(5 + 3) * 2',
        '100 / 3',
        'log(100, 10)', // log base 10
        'abs(-5)'
    ];

    console.log('=== Calculator 测试 (math.js) ===');

    for (const expr of testCases) {
        try {
            const result = calculatorHandler({ expression: expr });
            result.then(res => {
                console.log(`${expr} = ${res.formatted}`);
            });
        } catch (error) {
            console.error(`❌ ${expr} -> ${error.message}`);
        }
    }
}
