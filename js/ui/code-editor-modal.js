/**
 * 代码编辑器模态框
 * 支持三个标签页：分析、代码、预览
 */

import { eventBus } from '../core/events.js';
import { escapeHtml } from '../utils/helpers.js';

/**
 * 打开代码编辑器模态框
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 * @param {Function} onSave - 保存回调
 * @param {boolean} isReadOnly - 是否只读模式
 */
export function openCodeEditorModal(code, language, onSave, isReadOnly = false) {
    const modal = createCodeEditorModal(code, language, onSave, isReadOnly);
    document.body.appendChild(modal);

    // 焦点陷阱
    trapFocus(modal);

    // 禁用主内容交互
    document.querySelector('.app-container')?.setAttribute('inert', '');

    // 初始化标签页（默认显示「分析」）
    switchTab(modal, 'analysis');

    // 执行代码分析
    analyzeCode(modal, code, language);

    // 初始化代码编辑器（延迟执行确保 DOM 完全渲染）
    setTimeout(() => {
        const textarea = modal.querySelector('#code-editor-textarea');
        if (textarea) {
            initCodeEditor(modal, textarea, language);
        }
    }, 0);
}

/**
 * 创建模态框DOM
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 * @param {Function} onSave - 保存回调
 * @param {boolean} isReadOnly - 是否只读模式
 */
function createCodeEditorModal(code, language, onSave, isReadOnly = false) {
    const modal = document.createElement('div');
    modal.id = 'code-editor-modal';
    modal.className = 'modal active';

    modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content code-editor-modal-content">
            <!-- 头部 -->
            <div class="modal-header">
                <h2>${isReadOnly ? '代码查看器' : '代码编辑器'}</h2>
                <button class="icon-button close-modal-btn" aria-label="关闭">×</button>
            </div>

            <!-- 标签页导航 -->
            <div class="code-editor-tabs">
                <button class="tab-btn" data-tab="analysis">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    分析
                </button>
                <button class="tab-btn" data-tab="code">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="16 18 22 12 16 6"></polyline>
                        <polyline points="8 6 2 12 8 18"></polyline>
                    </svg>
                    代码
                </button>
                <button class="tab-btn" data-tab="preview">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    预览
                </button>
            </div>

            <!-- 标签页内容 -->
            <div class="code-editor-body">
                <!-- 分析标签页 -->
                <div class="tab-content" data-tab="analysis">
                    <div id="analysis-container">
                        <div class="analysis-loading">
                            <div class="spinner"></div>
                            <p>正在分析代码...</p>
                        </div>
                    </div>
                </div>

                <!-- 代码标签页 -->
                <div class="tab-content" data-tab="code">
                    <div class="code-editor-container">
                        <!-- 左侧：编辑器 -->
                        <div class="code-editor-panel">
                            <div class="panel-header">
                                <span class="panel-title">编辑器</span>
                                <select class="language-selector" id="editor-language-selector">
                                    ${generateLanguageOptions(language)}
                                </select>
                            </div>
                            <div class="code-editor-wrapper">
                                <div class="code-line-numbers" id="code-line-numbers"></div>
                                <textarea class="code-editor-textarea" id="code-editor-textarea">${escapeHtml(code)}</textarea>
                            </div>
                        </div>

                        <!-- 右侧：预览 -->
                        <div class="code-preview-panel">
                            <div class="panel-header">
                                <span class="panel-title">预览</span>
                                <button class="refresh-preview-btn" title="刷新预览">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M1 4v6h6M23 20v-6h-6"/>
                                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10m22 4l-4.35 4.65A9 9 0 0 1 20.49 9"/>
                                    </svg>
                                </button>
                            </div>
                            <div class="code-preview-content" id="code-preview-content">
                                <iframe id="code-preview-iframe" sandbox="allow-scripts" class="code-preview-iframe"></iframe>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 预览标签页 -->
                <div class="tab-content" data-tab="preview">
                    <div class="live-preview-container">
                        <div class="live-preview-toolbar">
                            <span class="preview-label">实时预览</span>
                            <div style="display: flex; gap: 8px;">
                                <button class="fullscreen-preview-btn" title="全屏预览">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                                    </svg>
                                </button>
                                <button class="refresh-live-preview-btn" title="刷新预览">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M1 4v6h6M23 20v-6h-6"/>
                                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10m22 4l-4.35 4.65A9 9 0 0 1 20.49 9"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <iframe id="live-preview-iframe" sandbox="allow-scripts" class="live-preview-iframe"></iframe>
                        <div class="preview-console" id="preview-console">
                            <div class="preview-console-header">
                                <span>控制台输出</span>
                                <button class="clear-console-btn" title="清空">×</button>
                            </div>
                            <div class="preview-console-content" id="preview-console-content"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 底部按钮 -->
            <div class="modal-footer">
                ${isReadOnly ? `
                    <button class="btn-secondary cancel-btn">关闭</button>
                ` : `
                    <button class="btn-secondary cancel-btn">取消</button>
                    <button class="btn-primary save-btn">保存修改</button>
                `}
            </div>
        </div>
    `;

    // 绑定事件
    bindModalEvents(modal, code, language, onSave, isReadOnly);

    return modal;
}

/**
 * 生成语言选项
 */
function generateLanguageOptions(currentLang) {
    const languages = [
        'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
        'go', 'rust', 'php', 'ruby', 'bash', 'sql', 'html', 'css',
        'json', 'yaml', 'markdown', 'text'
    ];

    return languages.map(lang =>
        `<option value="${lang}" ${lang === currentLang ? 'selected' : ''}>${lang.toUpperCase()}</option>`
    ).join('');
}

/**
 * 绑定模态框事件
 * @param {HTMLElement} modal - 模态框元素
 * @param {string} originalCode - 原始代码
 * @param {string} originalLanguage - 原始语言
 * @param {Function} onSave - 保存回调
 * @param {boolean} isReadOnly - 是否只读模式
 */
function bindModalEvents(modal, originalCode, originalLanguage, onSave, isReadOnly = false) {
    const closeBtn = modal.querySelector('.close-modal-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const saveBtn = modal.querySelector('.save-btn');
    const overlay = modal.querySelector('.modal-overlay');

    // 关闭模态框
    const closeModal = () => {
        modal.remove();
        document.body.style.overflow = '';
        document.querySelector('.app-container')?.removeAttribute('inert');
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    // ESC键关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // 保存按钮（只在非只读模式下绑定）
    if (!isReadOnly && saveBtn) {
        saveBtn.addEventListener('click', () => {
            const textarea = modal.querySelector('#code-editor-textarea');
            const newCode = textarea.value;
            const newLanguage = modal.querySelector('#editor-language-selector').value;

            // 验证
            if (!newCode.trim()) {
                eventBus.emit('ui:notification', {
                    message: '代码不能为空',
                    type: 'warning'
                });
                return;
            }

            // 调用保存回调
            onSave(newCode, newLanguage);

            closeModal();

            eventBus.emit('ui:notification', {
                message: '代码已保存',
                type: 'success'
            });
        });
    }

    // 只读模式：禁用编辑功能
    if (isReadOnly) {
        const textarea = modal.querySelector('#code-editor-textarea');
        const langSelector = modal.querySelector('#editor-language-selector');

        if (textarea) {
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.cursor = 'default';
        }

        if (langSelector) {
            langSelector.setAttribute('disabled', 'disabled');
        }
    }

    // 标签页切换
    const tabBtns = modal.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(modal, tab);

            const textarea = modal.querySelector('#code-editor-textarea');
            const language = modal.querySelector('#editor-language-selector')?.value || originalLanguage;

            // 切换到代码标签页时刷新预览
            if (tab === 'code') {
                setTimeout(() => {
                    updateCodePreview(modal, textarea.value, language);
                }, 50);
            }

            // 切换到预览标签页时自动运行实时预览
            if (tab === 'preview') {
                runLivePreview(modal, textarea.value, language);
            }
        });
    });

    // 刷新预览按钮
    const refreshBtn = modal.querySelector('.refresh-preview-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const textarea = modal.querySelector('#code-editor-textarea');
            const language = modal.querySelector('#editor-language-selector').value;
            updateCodePreview(modal, textarea.value, language);
        });
    }

    // 语言选择器变化
    const langSelector = modal.querySelector('#editor-language-selector');
    if (langSelector) {
        langSelector.addEventListener('change', () => {
            const textarea = modal.querySelector('#code-editor-textarea');
            updateCodePreview(modal, textarea.value, langSelector.value);
        });
    }

    // 刷新实时预览按钮
    const refreshLivePreviewBtn = modal.querySelector('.refresh-live-preview-btn');
    if (refreshLivePreviewBtn) {
        refreshLivePreviewBtn.addEventListener('click', () => {
            const textarea = modal.querySelector('#code-editor-textarea');
            const language = modal.querySelector('#editor-language-selector').value;
            runLivePreview(modal, textarea.value, language);
        });
    }

    // 清空控制台按钮
    const clearConsoleBtn = modal.querySelector('.clear-console-btn');
    if (clearConsoleBtn) {
        clearConsoleBtn.addEventListener('click', () => {
            const consoleContent = modal.querySelector('#preview-console-content');
            if (consoleContent) {
                consoleContent.innerHTML = '';
            }
        });
    }

    // 全屏预览按钮
    const fullscreenBtn = modal.querySelector('.fullscreen-preview-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const iframe = modal.querySelector('#live-preview-iframe');
            if (iframe) {
                openFullscreenPreview(iframe.srcdoc);
            }
        });
    }
}

/**
 * 切换标签页
 * @param {HTMLElement} modal - 模态框元素
 * @param {string} tabName - 标签页名称
 */
function switchTab(modal, tabName) {
    // 更新按钮状态
    modal.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新内容显示
    modal.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.dataset.tab === tabName);
    });
}

/**
 * 初始化代码编辑器
 * @param {HTMLElement} modal - 模态框元素
 * @param {HTMLElement} textarea - 文本编辑器
 * @param {string} language - 语言
 */
function initCodeEditor(modal, textarea, language) {
    const wrapper = textarea.parentElement;
    const lineNumbers = wrapper.querySelector('.code-line-numbers');

    // 更新行号
    const updateLineNumbers = () => {
        const lines = textarea.value.split('\n').length;
        lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) =>
            `<div class="line-number">${i + 1}</div>`
        ).join('');

        // 同步滚动
        lineNumbers.scrollTop = textarea.scrollTop;
    };

    // 初始化和监听
    updateLineNumbers();
    textarea.addEventListener('input', updateLineNumbers);
    textarea.addEventListener('scroll', () => {
        lineNumbers.scrollTop = textarea.scrollTop;
    });

    // Tab键支持（插入4个空格）
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) +
                           '    ' +
                           textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 4;
            updateLineNumbers();
            updateCodePreview(modal, textarea.value, language);
        }
    });

    // 自动更新预览
    let previewTimer;
    textarea.addEventListener('input', () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            const currentLang = modal.querySelector('#editor-language-selector')?.value || language;
            updateCodePreview(modal, textarea.value, currentLang);
        }, 500);
    });

    // 初始预览
    updateCodePreview(modal, textarea.value, language);
}

/**
 * 更新代码预览（右侧面板的实时预览）
 * @param {HTMLElement} modal - 模态框元素
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 */
function updateCodePreview(modal, code, language) {
    const iframe = modal.querySelector('#code-preview-iframe');
    if (!iframe) {
        return;
    }

    // 根据语言类型生成预览内容
    let previewHTML = '';

    if (language === 'html') {
        previewHTML = code;
    } else if (language === 'css') {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>${code}</style>
            </head>
            <body>
                <div class="preview-sample">
                    <h1>CSS 预览</h1>
                    <p>这是一个示例段落。</p>
                    <button>按钮</button>
                </div>
            </body>
            </html>
        `;
    } else if (language === 'javascript' || language === 'js') {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: monospace; padding: 20px; }
                </style>
            </head>
            <body>
                <div id="output"></div>
                <script>
                    const output = document.getElementById('output');
                    const originalLog = console.log;
                    console.log = function(...args) {
                        const message = args.map(arg =>
                            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                        ).join(' ');
                        const div = document.createElement('div');
                        div.textContent = message;
                        div.style.borderBottom = '1px solid #ddd';
                        div.style.padding = '8px 0';
                        output.appendChild(div);
                        originalLog.apply(console, args);
                    };

                    try {
                        ${code}
                    } catch (error) {
                        const errorDiv = document.createElement('div');
                        errorDiv.style.color = 'red';
                        errorDiv.textContent = 'Error: ' + error.message;
                        output.appendChild(errorDiv);
                    }
                </script>
            </body>
            </html>
        `;
    } else {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: monospace; padding: 20px;">
                <p>该语言 (${language}) 不支持实时预览</p>
            </body>
            </html>
        `;
    }

    // 写入 iframe
    iframe.srcdoc = previewHTML;
}

/**
 * 焦点陷阱（从 viewer.js 复制）
 */
function trapFocus(element) {
    const focusableElements = element.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    e.preventDefault();
                    lastFocusable.focus();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    e.preventDefault();
                    firstFocusable.focus();
                }
            }
        }
    });

    // 初始聚焦
    setTimeout(() => firstFocusable?.focus(), 100);
}

/**
 * 执行代码分析
 * @param {HTMLElement} modal - 模态框元素
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 */
async function analyzeCode(modal, code, language) {
    const container = modal.querySelector('#analysis-container');
    if (!container) {
        console.error('[代码分析] 找不到分析容器');
        return;
    }

    // 显示加载状态
    container.innerHTML = `
        <div class="analysis-loading">
            <div class="spinner"></div>
            <p>正在分析代码...</p>
        </div>
    `;

    // 延迟执行分析（模拟异步）
    setTimeout(() => {
        const analysis = performStaticAnalysis(code, language);
        renderAnalysisResult(analysis, container);
    }, 300);
}

/**
 * 执行静态代码分析
 */
function performStaticAnalysis(code, language) {
    const lines = code.split('\n');

    // ✅ 性能优化：限制分析的代码行数，避免大文件卡顿
    const MAX_LINES_FOR_ANALYSIS = 2000;
    const shouldLimitAnalysis = lines.length > MAX_LINES_FOR_ANALYSIS;
    const analysisCode = shouldLimitAnalysis
        ? lines.slice(0, MAX_LINES_FOR_ANALYSIS).join('\n')
        : code;

    const analysis = {
        basicInfo: {
            lines: lines.length,
            characters: code.length,
            language: language,
            isLimited: shouldLimitAnalysis
        },
        functions: [],
        classes: [],
        imports: [],
        complexity: 'low'
    };

    // 提取函数（JavaScript/TypeScript）
    if (['javascript', 'typescript', 'js', 'ts'].includes(language)) {
        const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*:\s*(?:async\s+)?\()/g;
        let match;
        let matchCount = 0;
        while ((match = functionRegex.exec(analysisCode)) !== null) {
            const funcName = match[1] || match[2] || match[3];
            if (funcName) analysis.functions.push(funcName);
            matchCount++;
            if (matchCount > 1000) break;
        }

        // 提取类
        const classRegex = /class\s+(\w+)/g;
        matchCount = 0;
        while ((match = classRegex.exec(analysisCode)) !== null) {
            analysis.classes.push(match[1]);
            matchCount++;
            if (matchCount > 1000) break;
        }

        // 提取导入
        const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
        matchCount = 0;
        while ((match = importRegex.exec(analysisCode)) !== null) {
            analysis.imports.push(match[1]);
            matchCount++;
            if (matchCount > 1000) break;
        }
    }

    // 提取函数（Python）
    if (language === 'python') {
        const functionRegex = /def\s+(\w+)\s*\(/g;
        let match;
        let matchCount = 0;
        while ((match = functionRegex.exec(analysisCode)) !== null) {
            analysis.functions.push(match[1]);
            matchCount++;
            if (matchCount > 1000) break;
        }

        const classRegex = /class\s+(\w+)/g;
        matchCount = 0;
        while ((match = classRegex.exec(analysisCode)) !== null) {
            analysis.classes.push(match[1]);
            matchCount++;
            if (matchCount > 1000) break;
        }

        const importRegex = /(?:from\s+(\S+)\s+)?import\s+([^#\n]+)/g;
        matchCount = 0;
        while ((match = importRegex.exec(analysisCode)) !== null) {
            const module = match[1] || match[2].split(',')[0].trim();
            analysis.imports.push(module);
            matchCount++;
            if (matchCount > 1000) break;
        }
    }

    // 计算复杂度（简单估算）
    const complexityIndicators = (analysisCode.match(/\b(if|for|while|switch|catch)\b/g) || []).length;
    if (complexityIndicators > 20) {
        analysis.complexity = 'high';
    } else if (complexityIndicators > 10) {
        analysis.complexity = 'medium';
    }

    return analysis;
}

/**
 * 渲染分析结果
 */
function renderAnalysisResult(analysis, container) {
    const { basicInfo, functions, classes, imports, complexity } = analysis;

    const complexityClass = `complexity-${complexity}`;
    const complexityText = { low: '低', medium: '中', high: '高' }[complexity];

    container.innerHTML = `
        ${basicInfo.isLimited ? `
        <div class="analysis-section" style="background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107;">
            <p style="margin: 0; color: #f57c00; font-size: 13px;">
                ⚠️ 代码文件较大（${basicInfo.lines} 行），分析结果仅基于前 2000 行
            </p>
        </div>
        ` : ''}

        <!-- 基本信息 -->
        <div class="analysis-section">
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                基本信息
            </h3>
            <div class="analysis-stats">
                <div class="stat-item">
                    <span class="stat-label">代码行数</span>
                    <span class="stat-value">${basicInfo.lines}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">字符数</span>
                    <span class="stat-value">${basicInfo.characters}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">语言</span>
                    <span class="stat-value">${basicInfo.language.toUpperCase()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">复杂度</span>
                    <span class="stat-value ${complexityClass}">${complexityText}</span>
                </div>
            </div>
        </div>

        ${functions.length > 0 ? `
        <!-- 函数列表 -->
        <div class="analysis-section">
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                </svg>
                函数 (${functions.length})
            </h3>
            <ul class="analysis-list">
                ${functions.map(fn => `<li>${escapeHtml(fn)}</li>`).join('')}
            </ul>
        </div>
        ` : ''}

        ${classes.length > 0 ? `
        <!-- 类列表 -->
        <div class="analysis-section">
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                </svg>
                类 (${classes.length})
            </h3>
            <ul class="analysis-list">
                ${classes.map(cls => `<li>${escapeHtml(cls)}</li>`).join('')}
            </ul>
        </div>
        ` : ''}

        ${imports.length > 0 ? `
        <!-- 依赖导入 -->
        <div class="analysis-section">
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                依赖导入 (${imports.length})
            </h3>
            <ul class="analysis-list">
                ${imports.slice(0, 10).map(imp => `<li>${escapeHtml(imp)}</li>`).join('')}
                ${imports.length > 10 ? `<li>... 还有 ${imports.length - 10} 个依赖</li>` : ''}
            </ul>
        </div>
        ` : ''}
    `;
}

/**
 * 打开全屏预览
 * @param {string} htmlContent - HTML内容
 */
function openFullscreenPreview(htmlContent) {
    // 创建全屏预览容器
    const fullscreenOverlay = document.createElement('div');
    fullscreenOverlay.id = 'fullscreen-preview-overlay';
    fullscreenOverlay.className = 'fullscreen-preview-overlay';

    fullscreenOverlay.innerHTML = `
        <div class="fullscreen-preview-header">
            <span class="fullscreen-preview-title">全屏预览</span>
            <button class="fullscreen-preview-close" title="退出全屏 (ESC)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
            </button>
        </div>
        <iframe class="fullscreen-preview-iframe" sandbox="allow-scripts"></iframe>
    `;

    document.body.appendChild(fullscreenOverlay);

    // 写入内容到 iframe
    const iframe = fullscreenOverlay.querySelector('.fullscreen-preview-iframe');
    iframe.srcdoc = htmlContent;

    // 关闭全屏预览
    const closeFullscreen = () => {
        fullscreenOverlay.remove();
        document.removeEventListener('keydown', escHandler);
    };

    // ESC 键关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeFullscreen();
        }
    };
    document.addEventListener('keydown', escHandler);

    // 点击关闭按钮
    const closeBtn = fullscreenOverlay.querySelector('.fullscreen-preview-close');
    closeBtn.addEventListener('click', closeFullscreen);

    // 动画效果
    requestAnimationFrame(() => {
        fullscreenOverlay.classList.add('active');
    });
}

/**
 * 运行实时预览
 * @param {HTMLElement} modal - 模态框元素
 * @param {string} code - 代码内容
 * @param {string} language - 语言
 */
function runLivePreview(modal, code, language) {
    const iframe = modal.querySelector('#live-preview-iframe');
    const consoleContent = modal.querySelector('#preview-console-content');

    if (!iframe || !consoleContent) {
        console.error('[实时预览] 找不到 iframe 或控制台元素');
        return;
    }

    // 清空控制台
    consoleContent.innerHTML = '';

    // 根据语言类型生成预览内容
    let previewHTML = '';

    if (language === 'html') {
        previewHTML = code;
    } else if (language === 'css') {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>${code}</style>
            </head>
            <body>
                <div class="preview-sample">
                    <h1>CSS 预览</h1>
                    <p>这是一个示例段落。</p>
                    <button>按钮</button>
                </div>
            </body>
            </html>
        `;
    } else if (language === 'javascript' || language === 'js') {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: monospace; padding: 20px; }
                </style>
            </head>
            <body>
                <div id="output"></div>
                <script>
                    // 重定向 console.log 到页面
                    const output = document.getElementById('output');
                    const originalLog = console.log;
                    console.log = function(...args) {
                        const message = args.map(arg =>
                            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                        ).join(' ');
                        const div = document.createElement('div');
                        div.textContent = message;
                        div.style.borderBottom = '1px solid #ddd';
                        div.style.padding = '8px 0';
                        output.appendChild(div);
                        originalLog.apply(console, args);
                    };

                    try {
                        ${code}
                    } catch (error) {
                        const errorDiv = document.createElement('div');
                        errorDiv.style.color = 'red';
                        errorDiv.textContent = 'Error: ' + error.message;
                        output.appendChild(errorDiv);
                    }
                </script>
            </body>
            </html>
        `;
    } else {
        previewHTML = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: monospace; padding: 20px;">
                <p>该语言 (${language}) 不支持实时预览</p>
            </body>
            </html>
        `;
    }

    // 写入 iframe
    iframe.srcdoc = previewHTML;
}
