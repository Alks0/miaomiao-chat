/**
 * Markdown 解析和处理
 * 依赖全局的 marked.js 库
 */

import { escapeHtml, extractBase64Images, restoreBase64Images } from './helpers.js';
import { MAX_MARKDOWN_LENGTH } from './constants.js';

// 性能优化：DOMPurify 配置常量（避免每次创建对象）
const DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'code', 'pre', 'a',
        'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr',
        'th', 'td', 'img', 'hr', 'del', 'span', 'div',
        'sup', 'sub', 'mark', 'small', 'b', 'i', 'u', 's',
        // KaTeX MathML 支持（数学公式渲染）
        'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'mfrac', 'msup', 'msub',
        'munder', 'mover', 'munderover', 'msqrt', 'mroot', 'mtext', 'mspace',
        'mtable', 'mtr', 'mtd', 'annotation', 'annotation-xml',
        // SVG 支持（图标、图形渲染）
        'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
        'ellipse', 'g', 'defs', 'use', 'symbol', 'marker', 'clipPath',
        'linearGradient', 'radialGradient', 'stop', 'text', 'tspan'
    ],
    ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class', 'style',
        'id', 'data-*', 'aria-*', 'role', 'target', 'rel',
        // KaTeX 需要的 MathML 属性
        'xmlns', 'encoding', 'mathvariant', 'mathsize', 'mathcolor',
        'mathbackground', 'displaystyle', 'scriptlevel',
        // SVG 需要的属性
        'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
        'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'points', 'transform', 'opacity', 'fill-opacity', 'stroke-opacity',
        'gradientUnits', 'gradientTransform', 'offset', 'stop-color'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'oninput', 'onchange'],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true
};

// 性能优化：简单的 LRU 缓存（缓存最近解析的结果）
class MarkdownCache {
    constructor(maxSize = 50) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        // LRU：访问时移到最后
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        // 如果已存在，先删除（更新顺序）
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // 如果超出大小，删除最老的项（Map 第一项）
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
}

const markdownCache = new MarkdownCache(50);

/**
 * 生成缓存键（使用简单哈希）
 * @param {string} text - 文本内容
 * @returns {string} 缓存键
 */
function generateCacheKey(text) {
    // 对于短文本，直接使用文本作为键
    if (text.length < 1000) {
        return text;
    }
    // 对于长文本，使用长度 + 开头 + 结尾作为键
    return `${text.length}_${text.substring(0, 100)}_${text.substring(text.length - 100)}`;
}

/**
 * 安全地解析 Markdown
 * 支持 LaTeX 数学公式渲染
 * @param {string} text - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function safeMarkedParse(text) {
    // 如果 marked 未加载，降级为纯文本
    if (typeof marked === 'undefined') {
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    // 性能优化：检查缓存
    const cacheKey = generateCacheKey(text);
    const cached = markdownCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        // 1. 先提取 LaTeX 公式（避免被 marked 解析）
        const { text: textWithoutLatex, formulas } = extractLatexFormulas(text);

        // 2. 然后提取 base64 图片
        const { text: cleanText, images } = extractBase64Images(textWithoutLatex);

        let html;

        // 如果内容过大，分块处理
        if (cleanText.length > MAX_MARKDOWN_LENGTH) {
            console.warn(`内容过大 (${cleanText.length} 字符)，分块解析 Markdown`);
            const chunks = [];
            let remaining = cleanText;

            while (remaining.length > 0) {
                // 尝试在段落边界分割
                let splitIndex = MAX_MARKDOWN_LENGTH;
                const nearestNewline = remaining.lastIndexOf('\n\n', MAX_MARKDOWN_LENGTH);
                if (nearestNewline > MAX_MARKDOWN_LENGTH / 2) {
                    splitIndex = nearestNewline + 2;
                }

                const chunk = remaining.substring(0, splitIndex);
                remaining = remaining.substring(splitIndex);

                try {
                    // 优化：先解析，再统一净化（避免重复 sanitize）
                    const chunkHtml = marked.parse(chunk);
                    chunks.push(chunkHtml);
                } catch (e) {
                    // 单块解析失败，使用纯文本
                    chunks.push(`<pre>${escapeHtml(chunk)}</pre>`);
                }
            }
            // 优化：合并后统一净化，而不是每块都净化
            html = chunks.join('');
        } else {
            html = marked.parse(cleanText);
        }

        // ⚠️ 关键安全措施：使用 DOMPurify 净化 HTML，防止 XSS 攻击
        // 性能优化：使用预定义的配置常量
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
        } else {
            console.warn('DOMPurify 未加载，HTML 未经净化可能存在 XSS 风险！');
        }

        // 3. 还原 LaTeX 公式（在还原图片之前）
        if (formulas.length > 0) {
            html = restoreLatexFormulas(html, formulas);
        }

        // 4. 还原 base64 图片
        if (images.length > 0) {
            html = restoreBase64Images(html, images);
        }

        // 性能优化：将结果存入缓存
        markdownCache.set(cacheKey, html);

        return html;
    } catch (e) {
        console.error('Markdown 解析失败:', e);
        // 降级为纯文本显示
        return `<pre>${escapeHtml(text)}</pre>`;
    }
}

/**
 * 清除 Markdown 缓存（用于内存管理）
 */
export function clearMarkdownCache() {
    markdownCache.clear();
    console.log('Markdown 缓存已清除');
}

/**
 * 获取缓存统计信息
 */
export function getMarkdownCacheStats() {
    return markdownCache.getStats();
}

/**
 * 提取 LaTeX 公式（避免被 Markdown 解析器误处理）
 * 支持行内公式 $...$ 和块级公式 $$...$$
 * @param {string} text - 原始文本
 * @returns {Object} { text: 处理后的文本, formulas: 公式数组 }
 */
function extractLatexFormulas(text) {
    const formulas = [];
    let result = text;

    // 1. 提取块级公式 $$...$$ （必须在行内公式之前处理）
    result = result.replace(/\$\$([^$]+?)\$\$/g, (match, formula) => {
        const index = formulas.length;
        formulas.push({ formula: formula.trim(), display: true });
        return `<span class="latex-placeholder" data-index="${index}"></span>`;
    });

    // 2. 提取行内公式 $...$ （避免与货币符号冲突，要求公式前后有空格或标点）
    result = result.replace(/(?:^|[\s(])(\$[^$\n]+?\$)(?=[\s.,;:!?)']|$)/gm, (match, formulaWithDollar, offset, fullText) => {
        // 检查是否是真正的公式（包含数学符号）
        const formula = formulaWithDollar.slice(1, -1); // 移除 $ 符号
        if (!/[a-zA-Z\\{}^_=+\-*/<>]/.test(formula)) {
            // 可能是货币符号，不处理
            return match;
        }

        const index = formulas.length;
        formulas.push({ formula: formula.trim(), display: false });

        // 保留前导字符（空格或括号）
        const prefix = match.charAt(0) === '$' ? '' : match.charAt(0);
        return `${prefix}<span class="latex-placeholder" data-index="${index}"></span>`;
    });

    return { text: result, formulas };
}

/**
 * 还原 LaTeX 公式为渲染后的 HTML
 * 使用 KaTeX 渲染数学公式
 * @param {string} html - HTML 内容
 * @param {Array} formulas - 公式数组
 * @returns {string} 还原后的 HTML
 */
function restoreLatexFormulas(html, formulas) {
    if (typeof katex === 'undefined') {
        console.warn('KaTeX 未加载，无法渲染数学公式');
        // 降级：还原原始公式文本
        formulas.forEach((item, index) => {
            const original = item.display ? `$$${item.formula}$$` : `$${item.formula}$`;
            const placeholder = `<span class="latex-placeholder" data-index="${index}"></span>`;
            html = html.replace(placeholder, `<code class="latex-fallback">${escapeHtml(original)}</code>`);
        });
        return html;
    }

    formulas.forEach((item, index) => {
        try {
            const rendered = katex.renderToString(item.formula, {
                displayMode: item.display,
                throwOnError: false,
                output: 'html',
                trust: false, // 安全：不信任 HTML/JavaScript
                strict: 'warn'
            });

            // 包装渲染结果
            const wrapper = item.display
                ? `<div class="katex-display-wrapper">${rendered}</div>`
                : `<span class="katex-inline-wrapper">${rendered}</span>`;

            const placeholder = `<span class="latex-placeholder" data-index="${index}"></span>`;
            html = html.replace(placeholder, wrapper);
        } catch (e) {
            console.error('LaTeX 渲染失败:', e, '公式:', item.formula);
            // 降级：显示原始公式
            const original = item.display ? `$$${item.formula}$$` : `$${item.formula}$`;
            const placeholder = `<span class="latex-placeholder" data-index="${index}"></span>`;
            html = html.replace(
                placeholder,
                `<code class="latex-error" title="公式渲染失败: ${escapeHtml(e.message)}">${escapeHtml(original)}</code>`
            );
        }
    });

    return html;
}
