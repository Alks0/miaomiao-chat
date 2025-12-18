/**
 * 工具调用 UI 模块
 * 显示工具调用状态、参数和结果
 *
 * 订阅事件:
 * - tool:execute:start
 * - tool:execute:success
 * - tool:execute:error
 */

import { eventBus } from '../core/events.js';
import { getIcon } from '../utils/icons.js';
import { showConfirmDialog } from '../utils/dialogs.js';

// 工具图标映射（图标名称）
const TOOL_ICONS = {
    'calculator': 'calculator',
    'web_search': 'search',
    'read_file': 'fileText',
    'write_file': 'edit',
    'run_code': 'settings',
    'get_weather': 'globe'
};

// 计时器管理
const durationTimers = new Map();

/**
 * 创建工具调用 UI
 * @param {Object} toolCall - 工具调用对象
 * @returns {HTMLElement} 工具调用 DOM 元素
 */
export async function createToolCallUI(toolCall) {
    // 检查是否已存在相同 tool-id 的 UI（防止重复创建）
    const existing = document.querySelector(`[data-tool-id="${CSS.escape(toolCall.id)}"]`);
    if (existing) {
        console.warn(`[ToolDisplay] 工具 UI 已存在，跳过创建: ${toolCall.id}`);
        return existing;
    }

    const container = document.createElement('div');
    container.className = 'tool-call-container';
    container.setAttribute('data-tool-id', toolCall.id);
    container.setAttribute('data-status', 'executing');

    // Header
    const header = document.createElement('div');
    header.className = 'tool-call-header';

    const icon = document.createElement('div');
    icon.className = 'tool-icon';
    icon.innerHTML = getToolIcon(toolCall.name);

    const info = document.createElement('div');
    info.className = 'tool-info';

    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = getToolDisplayName(toolCall.name);

    const status = document.createElement('span');
    status.className = 'tool-status';
    status.textContent = '准备执行...';

    info.append(name, status);

    const timestamp = document.createElement('div');
    timestamp.className = 'tool-timestamp';
    timestamp.textContent = formatTime(new Date());

    header.append(icon, info, timestamp);

    // 参数折叠面板
    const params = document.createElement('details');
    params.className = 'tool-params';

    const summary = document.createElement('summary');
    summary.textContent = `查看参数 (${Object.keys(toolCall.args).length} 项)`;

    const pre = document.createElement('pre');
    pre.className = 'params-content';
    const code = document.createElement('code');
    code.textContent = formatJSON(toolCall.args);
    pre.appendChild(code);

    params.append(summary, pre);

    // 执行状态
    const executionStatus = document.createElement('div');
    executionStatus.className = 'tool-execution-status';

    const spinner = document.createElement('div');
    spinner.className = 'status-spinner';

    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    statusText.textContent = '执行中...';

    const duration = document.createElement('span');
    duration.className = 'status-duration';
    duration.textContent = '0.0s';

    executionStatus.append(spinner, statusText, duration);

    // 结果和错误容器
    const resultEl = document.createElement('div');
    resultEl.className = 'tool-result';
    resultEl.style.display = 'none';

    const errorEl = document.createElement('div');
    errorEl.className = 'tool-error';
    errorEl.style.display = 'none';

    container.append(header, params, executionStatus, resultEl, errorEl);

    // 插入到当前的 assistant 消息内部（而不是chat容器）
    const { state } = await import('../core/state.js');
    const targetElement = state.currentAssistantMessage || document.querySelector('.message.assistant:last-child .message-content');

    if (targetElement) {
        targetElement.appendChild(container);
        console.log('[ToolDisplay] 工具UI已插入到消息内部');

        // 滚动到底部
        const chatArea = document.getElementById('chat');
        if (chatArea) {
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    } else {
        console.warn('[ToolDisplay] 未找到assistant消息元素，工具UI无法显示');
    }

    // 启动计时器
    startDurationTimer(container, toolCall.id);

    // 发出事件通知
    eventBus.emit('tool:ui:created', { toolId: toolCall.id, toolName: toolCall.name });

    return container;
}

/**
 * 更新工具执行状态
 * @param {string} toolId - 工具调用 ID
 * @param {string} status - 状态 ('executing' | 'completed' | 'failed')
 * @param {Object} data - 额外数据（结果或错误）
 */
export function updateToolCallStatus(toolId, status, data = {}) {
    console.log(`[ToolDisplay] updateToolCallStatus 调用: toolId=${toolId}, status=${status}`);
    const container = document.querySelector(`[data-tool-id="${toolId}"]`);
    if (!container) {
        console.warn(`[ToolDisplay] 未找到工具UI容器: ${toolId}`);
        return;
    }

    console.log(`[ToolDisplay] 找到工具容器，更新状态为: ${status}`);
    container.setAttribute('data-status', status);

    const statusEl = container.querySelector('.tool-status');
    const executionStatus = container.querySelector('.tool-execution-status');
    const resultEl = container.querySelector('.tool-result');
    const errorEl = container.querySelector('.tool-error');

    if (status === 'executing') {
        statusEl.textContent = data.message || '执行中...';
        const statusTextEl = container.querySelector('.status-text');
        if (statusTextEl) {
            statusTextEl.textContent = data.message || '执行中...';
        }

        eventBus.emit('tool:status:changed', { toolId, status: 'executing', message: data.message });
    }

    if (status === 'completed') {
        console.log('[ToolDisplay] 设置工具为completed状态');
        statusEl.innerHTML = `${getIcon('checkCircle', { size: 14 })} 执行成功`;
        executionStatus.style.display = 'none';
        console.log('[ToolDisplay] 已隐藏executionStatus（spinner）');
        resultEl.style.display = 'block';

        // 渲染结果
        renderToolResult(resultEl, data.result);

        // 停止计时器
        stopDurationTimer(toolId);

        // 添加撤销按钮
        addUndoButton(container);

        // 添加成功动画
        container.classList.add('success-flash');
        setTimeout(() => container.classList.remove('success-flash'), 500);

        eventBus.emit('tool:status:changed', { toolId, status: 'completed', result: data.result });
    }

    if (status === 'failed') {
        statusEl.innerHTML = `${getIcon('xCircle', { size: 14 })} 执行失败`;
        executionStatus.style.display = 'none';
        errorEl.style.display = 'flex';

        // 渲染错误
        const errorIcon = document.createElement('span');
        errorIcon.className = 'error-icon';
        errorIcon.innerHTML = getIcon('alertCircle', { size: 16 });

        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = data.error || '工具执行失败';

        // 添加重试按钮
        const retryButton = document.createElement('button');
        retryButton.className = 'retry-button';
        retryButton.textContent = '重试';
        retryButton.onclick = () => retryToolCall(toolId, data.toolName, data.toolArgs);

        errorEl.innerHTML = '';
        errorEl.append(errorIcon, errorMessage, retryButton);

        stopDurationTimer(toolId);

        eventBus.emit('tool:status:changed', { toolId, status: 'failed', error: data.error });
    }
}

/**
 * 渲染工具结果
 */
function renderToolResult(container, result) {
    const header = document.createElement('div');
    header.className = 'result-header';

    const icon = document.createElement('span');
    icon.className = 'result-icon';
    icon.innerHTML = getIcon('barChart', { size: 16 });

    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = '执行结果';

    header.append(icon, label);

    const contentEl = document.createElement('div');
    contentEl.className = 'result-content';

    // 根据结果类型选择渲染方式
    if (typeof result === 'string') {
        contentEl.textContent = result;
    } else if (Array.isArray(result)) {
        renderArrayResult(contentEl, result);
    } else if (typeof result === 'object') {
        renderObjectResult(contentEl, result);
    }

    container.innerHTML = '';
    container.append(header, contentEl);
}

/**
 * 渲染数组结果（如搜索结果列表）
 */
function renderArrayResult(container, items) {
    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-result';
        empty.textContent = '无结果';
        container.appendChild(empty);
        return;
    }

    const list = document.createElement('ul');
    list.className = 'result-list';

    items.slice(0, 10).forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'result-item';

        if (typeof item === 'object' && item.title && item.url) {
            const number = document.createElement('div');
            number.className = 'result-item-number';
            number.textContent = String(index + 1);

            const content = document.createElement('div');
            content.className = 'result-item-content';

            const link = document.createElement('a');
            link.href = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'result-item-title';
            link.textContent = item.title;

            content.appendChild(link);

            if (item.snippet) {
                const snippet = document.createElement('p');
                snippet.className = 'result-item-snippet';
                snippet.textContent = item.snippet;
                content.appendChild(snippet);
            }

            li.append(number, content);
        } else {
            li.textContent = JSON.stringify(item);
        }

        list.appendChild(li);
    });

    if (items.length > 10) {
        const more = document.createElement('li');
        more.className = 'result-more';
        more.textContent = `... 还有 ${items.length - 10} 项结果`;
        list.appendChild(more);
    }

    container.appendChild(list);
}

/**
 * 渲染对象结果
 */
function renderObjectResult(container, obj) {
    // 多模态支持：检测并渲染图片
    const hasImage = obj && typeof obj === 'object' && obj.image;
    const hasText = obj && typeof obj === 'object' && obj.text;

    // 渲染图片
    if (hasImage) {
        const imageData = obj.image;
        let imageUrl;

        // 处理 base64 格式: "data:image/png;base64,..."
        if (typeof imageData === 'string') {
            imageUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
        }
        // 处理对象格式
        else if (typeof imageData === 'object') {
            // Gemini 格式: { inlineData: { mimeType, data } }
            if (imageData.inlineData) {
                imageUrl = `data:${imageData.inlineData.mimeType};base64,${imageData.inlineData.data}`;
            }
            // Claude 格式: { source: { media_type, data } }
            else if (imageData.source) {
                imageUrl = `data:${imageData.source.media_type || imageData.source.mimeType};base64,${imageData.source.data}`;
            }
            // 简化格式: { mimeType, data } 或 { media_type, data }
            else if (imageData.data) {
                const mimeType = imageData.mimeType || imageData.media_type || 'image/png';
                imageUrl = `data:${mimeType};base64,${imageData.data}`;
            }
        }

        if (imageUrl) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'result-image-container';

            const img = document.createElement('img');
            img.className = hasText ? 'result-image' : 'result-image no-text';
            img.src = imageUrl;
            img.alt = '工具返回的图片';

            imgContainer.appendChild(img);
            container.appendChild(imgContainer);
        }
    }

    // 渲染文本
    if (hasText) {
        const textEl = document.createElement('div');
        textEl.className = 'result-text';
        textEl.textContent = obj.text;
        container.appendChild(textEl);
    }

    // 渲染其他字段（如果有）
    const otherFields = { ...obj };
    delete otherFields.image;
    delete otherFields.text;

    if (Object.keys(otherFields).length > 0 || (!hasImage && !hasText)) {
        const pre = document.createElement('pre');
        pre.className = 'result-json';
        // 如果有 image/text，只显示其他字段；否则显示完整对象
        const displayObj = (hasImage || hasText) ? otherFields : obj;
        pre.textContent = JSON.stringify(displayObj, null, 2);
        container.appendChild(pre);
    }
}

// ========== 计时器管理 ==========

function startDurationTimer(container, toolId) {
    const startTime = Date.now();
    const durationEl = container.querySelector('.status-duration');

    const timer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (durationEl) {
            durationEl.textContent = `${elapsed.toFixed(1)}s`;
        }
    }, 100);

    durationTimers.set(toolId, timer);
}

function stopDurationTimer(toolId) {
    const timer = durationTimers.get(toolId);
    if (timer) {
        clearInterval(timer);
        durationTimers.delete(toolId);
    }
}

// ========== 辅助函数 ==========

function getToolIcon(toolName) {
    const iconName = TOOL_ICONS[toolName] || 'tool';
    return getIcon(iconName, { size: 16 });
}

function getToolDisplayName(toolName) {
    const names = {
        'calculator': '计算器',
        'web_search': '网络搜索',
        'read_file': '读取文件',
        'write_file': '写入文件',
        'run_code': '执行代码',
        'get_weather': '天气查询'
    };
    return names[toolName] || toolName;
}

function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatJSON(obj) {
    return JSON.stringify(obj, null, 2);
}

/**
 * 重试工具调用
 */
async function retryToolCall(toolId, toolName, toolArgs) {
    console.log('[ToolDisplay] 重试工具调用:', toolName);

    // 重置 UI 状态
    updateToolCallStatus(toolId, 'executing', { message: '重试中...' });

    try {
        const { executeTool } = await import('../tools/executor.js');
        const result = await executeTool(toolName, toolArgs);

        updateToolCallStatus(toolId, 'completed', { result });
    } catch (error) {
        updateToolCallStatus(toolId, 'failed', {
            error: error.message,
            toolName,
            toolArgs
        });
    }
}

/**
 * 添加撤销按钮到工具调用卡片
 * @param {HTMLElement} container - 工具调用容器元素
 */
function addUndoButton(container) {
    // 检查是否已存在撤销按钮
    if (container.querySelector('.tool-undo-button')) {
        return;
    }

    // 创建撤销按钮容器
    const undoContainer = document.createElement('div');
    undoContainer.className = 'tool-undo-container';

    const undoButton = document.createElement('button');
    undoButton.className = 'tool-undo-button';
    undoButton.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"></path>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
        </svg>
        <span>撤销工具调用</span>
    `;
    undoButton.title = '撤销此工具调用，恢复到调用前的状态';

    undoButton.onclick = async () => {
        const confirmed = await confirmUndo();
        if (!confirmed) return;

        try {
            undoButton.disabled = true;
            undoButton.textContent = '撤销中...';

            const { undo, canUndoNow } = await import('../tools/undo.js');

            if (!canUndoNow()) {
                eventBus.emit('ui:notification', {
                    message: '没有可撤销的操作',
                    type: 'warning'
                });
                return;
            }

            const result = undo();

            if (result && result.success) {
                eventBus.emit('ui:notification', {
                    message: `已撤销，恢复到 ${result.snapshot.messageCount} 条消息`,
                    type: 'success'
                });

                // 移除工具调用 UI
                container.remove();
            } else {
                eventBus.emit('ui:notification', {
                    message: '撤销失败',
                    type: 'error'
                });
            }
        } catch (error) {
            console.error('[ToolDisplay] 撤销失败:', error);
            eventBus.emit('ui:notification', {
                message: `撤销失败: ${error.message}`,
                type: 'error'
            });
        } finally {
            undoButton.disabled = false;
            undoButton.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v6h6"></path>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
                </svg>
                <span>撤销工具调用</span>
            `;
        }
    };

    undoContainer.appendChild(undoButton);
    container.appendChild(undoContainer);
}

/**
 * 确认撤销操作
 * @returns {Promise<boolean>}
 */
async function confirmUndo() {
    return await showConfirmDialog(
        '确定要撤销此工具调用吗？\n\n' +
        '这将恢复到工具调用前的消息状态，' +
        '并移除工具调用产生的所有消息。\n\n' +
        '此操作不可逆！',
        '确认撤销'
    );
}
