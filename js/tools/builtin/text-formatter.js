/**
 * 文本格式化工具
 * 文本大小写转换、截取、替换、去除空格、编码等操作
 */

/**
 * 工具定义（OpenAI 格式）
 */
export const textFormatterTool = {
    name: 'text_formatter',
    description: '文本格式化工具。支持操作: uppercase（大写）, lowercase（小写）, capitalize（首字母大写）, trim（去除空格）, replace（替换）, substring（截取）, reverse（反转）, encode（编码）, count（统计）。',
    parameters: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['uppercase', 'lowercase', 'capitalize', 'title_case', 'trim', 'replace', 'substring', 'reverse', 'encode', 'decode', 'count', 'split', 'join'],
                description: '操作类型'
            },
            text: {
                type: 'string',
                description: '要处理的文本'
            },
            find: {
                type: 'string',
                description: '要查找的文本（用于 replace 操作）'
            },
            replace_with: {
                type: 'string',
                description: '替换为的文本（用于 replace 操作）'
            },
            start: {
                type: 'number',
                description: '起始位置（用于 substring 操作）'
            },
            end: {
                type: 'number',
                description: '结束位置（用于 substring 操作）'
            },
            encoding: {
                type: 'string',
                enum: ['base64', 'url', 'uri', 'html'],
                description: '编码类型（用于 encode/decode 操作）'
            },
            separator: {
                type: 'string',
                description: '分隔符（用于 split/join 操作）'
            },
            parts: {
                type: 'array',
                items: { type: 'string' },
                description: '要连接的文本数组（用于 join 操作）'
            }
        },
        required: ['operation', 'text']
    }
};

/**
 * 工具处理器
 * @param {Object} args - 参数
 * @returns {Promise<Object>} 处理结果
 */
export async function textFormatterHandler(args) {
    const { operation, text, find, replace_with, start, end, encoding, separator, parts } = args;

    console.log(`[TextFormatter] 执行操作: ${operation}`, { textLength: text?.length });

    try {
        let result;
        let metadata = {};

        switch (operation) {
            case 'uppercase':
                result = text.toUpperCase();
                break;

            case 'lowercase':
                result = text.toLowerCase();
                break;

            case 'capitalize':
                result = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
                break;

            case 'title_case':
                result = toTitleCase(text);
                break;

            case 'trim':
                result = text.trim();
                metadata = {
                    removed_chars: text.length - result.length,
                    leading: text.length - text.trimStart().length,
                    trailing: text.length - text.trimEnd().length
                };
                break;

            case 'replace':
                if (!find) {
                    throw new Error('replace 操作需要 find 参数');
                }
                const replaceWith = replace_with || '';
                result = text.split(find).join(replaceWith);
                metadata = {
                    occurrences: (text.match(new RegExp(escapeRegex(find), 'g')) || []).length,
                    find,
                    replace_with: replaceWith
                };
                break;

            case 'substring':
                const startPos = start || 0;
                const endPos = end !== undefined ? end : text.length;
                result = text.substring(startPos, endPos);
                metadata = {
                    start: startPos,
                    end: endPos,
                    extracted_length: result.length
                };
                break;

            case 'reverse':
                result = text.split('').reverse().join('');
                break;

            case 'encode':
                if (!encoding) {
                    throw new Error('encode 操作需要 encoding 参数');
                }
                result = encodeText(text, encoding);
                metadata = { encoding };
                break;

            case 'decode':
                if (!encoding) {
                    throw new Error('decode 操作需要 encoding 参数');
                }
                result = decodeText(text, encoding);
                metadata = { encoding };
                break;

            case 'count':
                result = text;
                metadata = getTextStatistics(text);
                break;

            case 'split':
                const sep = separator || ' ';
                const splitResult = text.split(sep);
                result = text;
                metadata = {
                    separator: sep,
                    parts: splitResult,
                    count: splitResult.length
                };
                break;

            case 'join':
                if (!parts || !Array.isArray(parts)) {
                    throw new Error('join 操作需要 parts 数组参数');
                }
                const joinSep = separator || '';
                result = parts.join(joinSep);
                metadata = {
                    separator: joinSep,
                    parts_count: parts.length
                };
                break;

            default:
                throw new Error(`不支持的操作: ${operation}`);
        }

        return {
            operation,
            success: true,
            input: {
                text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
                length: text.length
            },
            output: {
                text: result,
                length: result.length
            },
            metadata
        };

    } catch (error) {
        console.error(`[TextFormatter] 错误:`, error);
        throw new Error(`文本格式化失败: ${error.message}`);
    }
}

/**
 * 标题格式化（每个单词首字母大写）
 * @param {string} text - 文本
 * @returns {string}
 */
function toTitleCase(text) {
    return text.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * 编码文本
 * @param {string} text - 文本
 * @param {string} encoding - 编码类型
 * @returns {string}
 */
function encodeText(text, encoding) {
    switch (encoding) {
        case 'base64':
            return btoa(unescape(encodeURIComponent(text)));
        case 'url':
        case 'uri':
            return encodeURIComponent(text);
        case 'html':
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        default:
            throw new Error(`不支持的编码类型: ${encoding}`);
    }
}

/**
 * 解码文本
 * @param {string} text - 文本
 * @param {string} encoding - 编码类型
 * @returns {string}
 */
function decodeText(text, encoding) {
    switch (encoding) {
        case 'base64':
            return decodeURIComponent(escape(atob(text)));
        case 'url':
        case 'uri':
            return decodeURIComponent(text);
        case 'html':
            return text
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'");
        default:
            throw new Error(`不支持的解码类型: ${encoding}`);
    }
}

/**
 * 获取文本统计信息
 * @param {string} text - 文本
 * @returns {Object}
 */
function getTextStatistics(text) {
    const lines = text.split('\n');
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;

    return {
        characters: chars,
        characters_no_spaces: charsNoSpaces,
        words: words.length,
        lines: lines.length,
        sentences: (text.match(/[.!?]+/g) || []).length,
        paragraphs: text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length,
        avg_word_length: words.length > 0 ? (charsNoSpaces / words.length).toFixed(2) : 0
    };
}

/**
 * 转义正则表达式特殊字符
 * @param {string} string - 字符串
 * @returns {string}
 */
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log('[TextFormatter Tool] 📝 文本格式化工具已加载');
