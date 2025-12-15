/**
 * 工具系统初始化
 * 注册所有内置工具
 */

import { registerBuiltinTool, loadToolStates } from './manager.js';
import { calculatorTool, calculatorHandler } from './builtin/calculator.js';
import { datetimeTool, datetimeHandler } from './builtin/datetime.js';
import { unitConverterTool, unitConverterHandler } from './builtin/unit-converter.js';
import { textFormatterTool, textFormatterHandler } from './builtin/text-formatter.js';
import { randomGeneratorTool, randomGeneratorHandler } from './builtin/random-generator.js';

/**
 * 初始化工具系统
 * 在应用启动时调用
 */
export async function initTools() {
    console.log('[Tools] 🔧 初始化工具系统...');

    // 注册内置工具
    registerBuiltins();

    // 加载工具启用状态
    try {
        await loadToolStates();
    } catch (error) {
        console.warn('[Tools] 加载工具状态失败:', error);
    }

    // 加载工具调用历史
    try {
        const { loadToolHistory } = await import('./history.js');
        loadToolHistory();
    } catch (error) {
        console.warn('[Tools] 加载历史记录失败:', error);
    }

    // ✅ 暴露调试函数到控制台
    if (typeof window !== 'undefined') {
        window.getToolSystemStatus = getToolSystemStatus;
        console.log('[Tools] 💡 调试函数已暴露: window.getToolSystemStatus()');
    }

    console.log('[Tools] ✅ 工具系统初始化完成');
}

/**
 * 注册所有内置工具
 */
function registerBuiltins() {
    // 1. Calculator 工具
    registerBuiltinTool('calculator', calculatorTool, calculatorHandler);

    // 2. DateTime 工具
    registerBuiltinTool('datetime', datetimeTool, datetimeHandler);

    // 3. UnitConverter 工具
    registerBuiltinTool('unit_converter', unitConverterTool, unitConverterHandler);

    // 4. TextFormatter 工具
    registerBuiltinTool('text_formatter', textFormatterTool, textFormatterHandler);

    // 5. RandomGenerator 工具
    registerBuiltinTool('random_generator', randomGeneratorTool, randomGeneratorHandler);

    // 注意：web_search 保持原有实现（硬编码在 API 层），不迁移到工具系统
    // 这是用户的明确要求："关于websearch这个功能，不要改就现在这样就行了"

    console.log('[Tools] 📦 已注册 5 个内置工具: calculator, datetime, unit_converter, text_formatter, random_generator');
}

/**
 * 获取工具系统状态
 * @returns {Promise<Object>} 状态信息
 */
export async function getToolSystemStatus() {
    const { getToolStats, debugTools } = await import('./manager.js');

    return {
        initialized: true,
        stats: getToolStats(),
        debug: debugTools() // ✅ 调用函数而非传递引用
    };
}
