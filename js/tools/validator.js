/**
 * 工具参数验证模块
 * 基于 JSON Schema 验证工具输入参数
 */

/**
 * 验证工具参数（内部函数）
 * @param {Object} args - 工具参数
 * @param {Object} schema - JSON Schema 定义
 * @returns {{valid: boolean, errors: Array}} 验证结果
 * @private
 */
function validateToolArgs(args, schema) {
    const errors = [];

    // 如果没有 schema，通过验证
    if (!schema || typeof schema !== 'object') {
        return { valid: true, errors: [] };
    }

    // 验证类型
    if (schema.type === 'object') {
        if (typeof args !== 'object' || args === null) {
            errors.push({
                path: '',
                message: `参数必须是对象，收到: ${typeof args}`
            });
            return { valid: false, errors };
        }

        // 验证必填字段
        if (schema.required && Array.isArray(schema.required)) {
            for (const requiredField of schema.required) {
                if (!(requiredField in args)) {
                    errors.push({
                        path: requiredField,
                        message: `缺少必填字段: ${requiredField}`
                    });
                }
            }
        }

        // 验证属性
        if (schema.properties) {
            for (const [key, value] of Object.entries(args)) {
                const propSchema = schema.properties[key];

                if (!propSchema) {
                    // 检查是否允许额外属性
                    if (schema.additionalProperties === false) {
                        errors.push({
                            path: key,
                            message: `不允许的额外属性: ${key}`
                        });
                    }
                    continue;
                }

                // 递归验证嵌套属性
                const propErrors = validateValue(value, propSchema, key);
                errors.push(...propErrors);
            }
        }
    } else {
        // 非对象类型的直接验证
        const valueErrors = validateValue(args, schema, '');
        errors.push(...valueErrors);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 验证单个值
 * @param {*} value - 值
 * @param {Object} schema - Schema 定义
 * @param {string} path - 字段路径
 * @returns {Array} 错误列表
 */
function validateValue(value, schema, path) {
    const errors = [];

    // 类型验证
    if (schema.type) {
        const actualType = getJSONType(value);

        if (actualType !== schema.type && !(schema.type === 'integer' && actualType === 'number')) {
            errors.push({
                path,
                message: `类型错误: 期望 ${schema.type}, 收到 ${actualType}`
            });
            return errors; // 类型错误，后续验证无意义
        }
    }

    // 字符串验证
    if (schema.type === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push({
                path,
                message: `字符串长度不足: 最少 ${schema.minLength} 个字符，当前 ${value.length}`
            });
        }

        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            errors.push({
                path,
                message: `字符串过长: 最多 ${schema.maxLength} 个字符，当前 ${value.length}`
            });
        }

        if (schema.pattern) {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(value)) {
                errors.push({
                    path,
                    message: `字符串格式不匹配: ${schema.pattern}`
                });
            }
        }

        if (schema.enum && !schema.enum.includes(value)) {
            errors.push({
                path,
                message: `值必须是以下之一: ${schema.enum.join(', ')}`
            });
        }
    }

    // 数字验证
    if (schema.type === 'number' || schema.type === 'integer') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push({
                path,
                message: `数值过小: 最小值 ${schema.minimum}，当前 ${value}`
            });
        }

        if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push({
                path,
                message: `数值过大: 最大值 ${schema.maximum}，当前 ${value}`
            });
        }

        if (schema.type === 'integer' && !Number.isInteger(value)) {
            errors.push({
                path,
                message: `必须是整数，收到: ${value}`
            });
        }
    }

    // 数组验证
    if (schema.type === 'array') {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            errors.push({
                path,
                message: `数组长度不足: 最少 ${schema.minItems} 项，当前 ${value.length}`
            });
        }

        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            errors.push({
                path,
                message: `数组过长: 最多 ${schema.maxItems} 项，当前 ${value.length}`
            });
        }

        // 验证数组项
        if (schema.items) {
            value.forEach((item, index) => {
                const itemErrors = validateValue(item, schema.items, `${path}[${index}]`);
                errors.push(...itemErrors);
            });
        }
    }

    // 对象验证（嵌套）
    if (schema.type === 'object' && schema.properties) {
        for (const [key, propValue] of Object.entries(value)) {
            const propSchema = schema.properties[key];
            if (propSchema) {
                const propErrors = validateValue(propValue, propSchema, `${path}.${key}`);
                errors.push(...propErrors);
            }
        }

        // 验证必填字段
        if (schema.required) {
            for (const requiredField of schema.required) {
                if (!(requiredField in value)) {
                    errors.push({
                        path: `${path}.${requiredField}`,
                        message: `缺少必填字段: ${requiredField}`
                    });
                }
            }
        }
    }

    return errors;
}

/**
 * 获取 JavaScript 值的 JSON Schema 类型
 * @param {*} value - 值
 * @returns {string} JSON Schema 类型
 */
function getJSONType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';

    const jsType = typeof value;

    switch (jsType) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'string':
            return 'string';
        case 'object':
            return 'object';
        default:
            return jsType;
    }
}

/**
 * 安全验证（捕获异常）
 * @param {Object} args - 工具参数
 * @param {Object} schema - JSON Schema
 * @returns {{valid: boolean, errors: Array}}
 */
export function safeValidate(args, schema) {
    try {
        return validateToolArgs(args, schema);
    } catch (error) {
        console.error('[Validator] 验证过程出错:', error);
        return {
            valid: false,
            errors: [{
                path: '',
                message: `验证器内部错误: ${error.message}`
            }]
        };
    }
}

/**
 * 格式化验证错误为人类可读字符串
 * @param {Array} errors - 错误列表
 * @returns {string} 格式化字符串
 */
export function formatValidationErrors(errors) {
    if (!errors || errors.length === 0) {
        return '参数验证通过';
    }

    const lines = errors.map(err => {
        const pathStr = err.path ? `字段 "${err.path}": ` : '';
        return `  • ${pathStr}${err.message}`;
    });

    return `参数验证失败:\n${lines.join('\n')}`;
}
