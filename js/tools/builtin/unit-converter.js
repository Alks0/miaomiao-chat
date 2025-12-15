/**
 * 单位转换工具
 * 支持长度、重量、温度、面积、体积、速度等单位转换
 */

/**
 * 工具定义（OpenAI 格式）
 */
export const unitConverterTool = {
    name: 'unit_converter',
    description: '单位转换工具。支持类别: length（长度）, weight（重量）, temperature（温度）, area（面积）, volume（体积）, speed（速度）, time（时间）。',
    parameters: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                enum: ['length', 'weight', 'temperature', 'area', 'volume', 'speed', 'time'],
                description: '转换类别'
            },
            value: {
                type: 'number',
                description: '要转换的数值'
            },
            from: {
                type: 'string',
                description: '源单位（例如: meter, kilogram, celsius, square_meter 等）'
            },
            to: {
                type: 'string',
                description: '目标单位（例如: foot, pound, fahrenheit, square_foot 等）'
            }
        },
        required: ['category', 'value', 'from', 'to']
    }
};

/**
 * 单位转换系数表
 * 所有单位都转换为基准单位（meter, kilogram, celsius 等）
 */
const CONVERSION_FACTORS = {
    length: {
        // 基准: meter
        meter: 1,
        kilometer: 1000,
        centimeter: 0.01,
        millimeter: 0.001,
        mile: 1609.34,
        yard: 0.9144,
        foot: 0.3048,
        inch: 0.0254,
        nautical_mile: 1852
    },
    weight: {
        // 基准: kilogram
        kilogram: 1,
        gram: 0.001,
        milligram: 0.000001,
        ton: 1000,
        pound: 0.453592,
        ounce: 0.0283495,
        stone: 6.35029
    },
    temperature: {
        // 温度需要特殊处理（不是简单的乘法）
        celsius: 'celsius',
        fahrenheit: 'fahrenheit',
        kelvin: 'kelvin'
    },
    area: {
        // 基准: square_meter
        square_meter: 1,
        square_kilometer: 1000000,
        square_centimeter: 0.0001,
        square_mile: 2589988.11,
        square_yard: 0.836127,
        square_foot: 0.092903,
        square_inch: 0.00064516,
        hectare: 10000,
        acre: 4046.86
    },
    volume: {
        // 基准: liter
        liter: 1,
        milliliter: 0.001,
        cubic_meter: 1000,
        cubic_centimeter: 0.001,
        gallon: 3.78541,
        quart: 0.946353,
        pint: 0.473176,
        cup: 0.236588,
        fluid_ounce: 0.0295735,
        tablespoon: 0.0147868,
        teaspoon: 0.00492892
    },
    speed: {
        // 基准: meter_per_second
        meter_per_second: 1,
        kilometer_per_hour: 0.277778,
        mile_per_hour: 0.44704,
        foot_per_second: 0.3048,
        knot: 0.514444
    },
    time: {
        // 基准: second
        second: 1,
        minute: 60,
        hour: 3600,
        day: 86400,
        week: 604800,
        month: 2592000, // 30 天
        year: 31536000 // 365 天
    }
};

/**
 * 工具处理器
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 转换结果
 */
export async function unitConverterHandler(args) {
    const { category, value, from, to } = args;

    console.log(`[UnitConverter] 转换: ${value} ${from} -> ${to} (${category})`);

    try {
        // 验证类别
        if (!CONVERSION_FACTORS[category]) {
            throw new Error(`不支持的转换类别: ${category}`);
        }

        // 温度需要特殊处理
        if (category === 'temperature') {
            const result = convertTemperature(value, from, to);
            return formatResult(category, value, from, to, result);
        }

        // 获取转换系数
        const factors = CONVERSION_FACTORS[category];
        const fromFactor = factors[from];
        const toFactor = factors[to];

        if (fromFactor === undefined) {
            throw new Error(`不支持的源单位: ${from}（类别: ${category}）`);
        }
        if (toFactor === undefined) {
            throw new Error(`不支持的目标单位: ${to}（类别: ${category}）`);
        }

        // 转换公式: value * fromFactor / toFactor
        const result = (value * fromFactor) / toFactor;

        return formatResult(category, value, from, to, result);

    } catch (error) {
        console.error(`[UnitConverter] 错误:`, error);
        throw new Error(`单位转换失败: ${error.message}`);
    }
}

/**
 * 温度转换
 * @param {number} value - 温度值
 * @param {string} from - 源单位
 * @param {string} to - 目标单位
 * @returns {number} 转换后的值
 */
function convertTemperature(value, from, to) {
    // 先转换为 Celsius
    let celsius;
    switch (from) {
        case 'celsius':
            celsius = value;
            break;
        case 'fahrenheit':
            celsius = (value - 32) * 5 / 9;
            break;
        case 'kelvin':
            celsius = value - 273.15;
            break;
        default:
            throw new Error(`不支持的温度单位: ${from}`);
    }

    // 再从 Celsius 转换为目标单位
    switch (to) {
        case 'celsius':
            return celsius;
        case 'fahrenheit':
            return celsius * 9 / 5 + 32;
        case 'kelvin':
            return celsius + 273.15;
        default:
            throw new Error(`不支持的温度单位: ${to}`);
    }
}

/**
 * 格式化结果
 * @param {string} category - 类别
 * @param {number} value - 原始值
 * @param {string} from - 源单位
 * @param {string} to - 目标单位
 * @param {number} result - 结果值
 * @returns {Object}
 */
function formatResult(category, value, from, to, result) {
    return {
        category,
        input: {
            value,
            unit: from
        },
        output: {
            value: result,
            unit: to
        },
        formatted: `${value} ${from} = ${roundToSignificant(result, 6)} ${to}`,
        precision: {
            raw: result,
            rounded: roundToSignificant(result, 6),
            scientific: result.toExponential(4)
        }
    };
}

/**
 * 保留有效数字
 * @param {number} num - 数字
 * @param {number} digits - 有效数字位数
 * @returns {number}
 */
function roundToSignificant(num, digits) {
    if (num === 0) return 0;
    const magnitude = Math.floor(Math.log10(Math.abs(num)));
    const scale = Math.pow(10, digits - magnitude - 1);
    return Math.round(num * scale) / scale;
}

/**
 * 获取支持的单位列表
 * @param {string} category - 类别
 * @returns {Array<string>} 单位列表
 */
export function getSupportedUnits(category) {
    if (!CONVERSION_FACTORS[category]) {
        return [];
    }
    return Object.keys(CONVERSION_FACTORS[category]);
}

/**
 * 获取所有支持的类别
 * @returns {Array<string>} 类别列表
 */
export function getSupportedCategories() {
    return Object.keys(CONVERSION_FACTORS);
}

console.log('[UnitConverter Tool] 📏 单位转换工具已加载');
console.log('[UnitConverter Tool] 支持的类别:', getSupportedCategories().join(', '));
