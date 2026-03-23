/**
 * 工具调用 UI 模块 — 紧凑按钮 + 媒体提取 + 详情弹窗
 *
 * DOM 结构（插入到 assistant .message-content 顶部）:
 *   div.tool-calls-group
 *     ├── button.tool-calls-summary-btn   （紧凑按钮）
 *     └── div.tool-media-area             （提取的图片/视频）
 */

import { eventBus } from '../core/events.js';
import { getIcon } from '../utils/icons.js';
import { showConfirmDialog } from '../utils/dialogs.js';

// 工具名称映射
const TOOL_DISPLAY_NAMES = {
    'calculator': '计算器',
    'web_search': '网络搜索',
    'read_file': '读取文件',
    'write_file': '写入文件',
    'run_code': '执行代码',
    'get_weather': '天气查询'
};

// 每个 group DOM 元素 → 详情数据
const toolCallsDataMap = new WeakMap();

// 计时器管理
const groupTimers = new Map();

/**
 * 获取或创建 .tool-calls-group
 * 一个 assistant 消息中只有一个 group
 */
function getOrCreateGroup(targetContainer) {
    let group = targetContainer.querySelector('.tool-calls-group');
    if (group) return group;

    group = document.createElement('div');
    group.className = 'tool-calls-group';

    // 紧凑按钮
    const btn = document.createElement('button');
    btn.className = 'tool-calls-summary-btn';
    btn.setAttribute('data-status', 'executing');
    btn.innerHTML = `
        ${getIcon('tool', { size: 14 })}
        <span class="summary-text">1 个工具调用</span>
        <span class="summary-status">执行中...</span>
        <svg class="summary-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    `;
    btn.onclick = () => openToolDetailModal(group);

    // 媒体区域（按钮下方）
    const mediaArea = document.createElement('div');
    mediaArea.className = 'tool-media-area';

    group.append(btn, mediaArea);

    // 插入到 message-content 的最前面（文本上方）
    targetContainer.prepend(group);

    // 初始化数据存储
    toolCallsDataMap.set(group, {
        tools: [],          // { id, name, args, status, result, error, startTime, duration }
        completedCount: 0,
        failedCount: 0,
        totalCount: 0
    });

    // 启动 group 计时
    startGroupTimer(group);

    return group;
}

/**
 * 创建工具调用 UI（紧凑模式）
 * 第一个工具创建 group + 按钮，后续只更新计数
 */
export async function createToolCallUI(toolCall, targetContainer = null) {
    // 防止重复
    const existingGroup = document.querySelector('.tool-calls-group');
    if (existingGroup) {
        const data = toolCallsDataMap.get(existingGroup);
        if (data && data.tools.some(t => t.id === toolCall.id)) {
            console.warn(`[ToolDisplay] 工具已存在，跳过: ${toolCall.id}`);
            return existingGroup;
        }
    }

    const { state } = await import('../core/state.js');
    const target = targetContainer || state.currentAssistantMessage || document.querySelector('.message.assistant:last-child .message-content');

    if (!target) {
        console.warn('[ToolDisplay] 未找到 assistant 消息元素');
        return null;
    }

    const group = getOrCreateGroup(target);
    const data = toolCallsDataMap.get(group);

    // 记录工具信息
    data.tools.push({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args || {},
        status: 'executing',
        result: null,
        error: null,
        startTime: Date.now(),
        duration: null
    });
    data.totalCount = data.tools.length;

    // 更新按钮文本
    updateSummaryButton(group, data);

    // 滚动到底部
    const chatArea = document.getElementById('chat');
    if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

    eventBus.emit('tool:ui:created', { toolId: toolCall.id, toolName: toolCall.name });

    return group;
}

/**
 * 更新工具执行状态
 */
export function updateToolCallStatus(toolId, status, data = {}) {
    // 找到包含该工具的 group
    let group = null;
    let toolInfo = null;

    for (const g of document.querySelectorAll('.tool-calls-group')) {
        const gData = toolCallsDataMap.get(g);
        if (!gData) continue;
        const found = gData.tools.find(t => t.id === toolId);
        if (found) {
            group = g;
            toolInfo = found;
            break;
        }
    }

    if (!group || !toolInfo) {
        console.warn(`[ToolDisplay] 未找到工具: ${toolId}`);
        return;
    }

    const gData = toolCallsDataMap.get(group);

    if (status === 'completed') {
        toolInfo.status = 'completed';
        toolInfo.result = data.result;
        toolInfo.duration = ((Date.now() - toolInfo.startTime) / 1000).toFixed(1);
        gData.completedCount++;

        // 提取媒体到 media area
        extractMediaToGroup(group, data.result, toolInfo.name);

        eventBus.emit('tool:status:changed', { toolId, status: 'completed', result: data.result });
    }

    if (status === 'failed') {
        toolInfo.status = 'failed';
        toolInfo.error = data.error || '执行失败';
        toolInfo.duration = ((Date.now() - toolInfo.startTime) / 1000).toFixed(1);
        gData.failedCount++;

        eventBus.emit('tool:status:changed', { toolId, status: 'failed', error: data.error });
    }

    if (status === 'executing') {
        toolInfo.status = 'executing';
        eventBus.emit('tool:status:changed', { toolId, status: 'executing', message: data.message });
    }

    // 更新按钮状态
    updateSummaryButton(group, gData);

    // 全部完成时停止计时
    const allDone = gData.completedCount + gData.failedCount >= gData.totalCount;
    if (allDone) {
        stopGroupTimer(group);
    }
}

// ==================== 按钮更新 ====================

function updateSummaryButton(group, data) {
    const btn = group.querySelector('.tool-calls-summary-btn');
    if (!btn) return;

    const textEl = btn.querySelector('.summary-text');
    const statusEl = btn.querySelector('.summary-status');

    const total = data.totalCount;
    const done = data.completedCount + data.failedCount;
    const allDone = done >= total;

    // 文本
    textEl.textContent = `${total} 个工具调用`;

    // 状态
    if (allDone) {
        if (data.failedCount > 0) {
            statusEl.textContent = `${data.failedCount} 个失败`;
            btn.setAttribute('data-status', 'failed');
        } else {
            statusEl.textContent = '全部完成';
            btn.setAttribute('data-status', 'completed');
        }
    } else {
        statusEl.textContent = `执行中 ${done}/${total}`;
        btn.setAttribute('data-status', 'executing');
    }
}

// ==================== 媒体提取 ====================

/**
 * 从工具结果中提取图片/视频，插入到 media area
 */
function extractMediaToGroup(group, result, _toolName) {
    if (!result || typeof result !== 'object') return;

    const mediaArea = group.querySelector('.tool-media-area');
    if (!mediaArea) return;

    // 解包嵌套 result
    const obj = (result.success === true && result.result !== undefined) ? result.result : result;

    const mediaItems = collectMedia(obj);

    for (const item of mediaItems) {
        if (item.type === 'image') {
            const wrapper = createImageWrapper(item.url);
            mediaArea.appendChild(wrapper);
        } else if (item.type === 'video') {
            const wrapper = createVideoWrapper(item.url);
            mediaArea.appendChild(wrapper);
        }
    }
}

/**
 * 从结果对象中收集所有媒体 URL
 */
function collectMedia(obj) {
    if (!obj || typeof obj !== 'object') return [];

    const items = [];

    // 单张图片
    if (obj.image) {
        const url = resolveImageUrl(obj.image);
        if (url) items.push({ type: 'image', url });
    }

    // 多张图片 (images 数组)
    if (Array.isArray(obj.images)) {
        for (const img of obj.images) {
            let url;
            if (typeof img === 'string') {
                url = img;
            } else if (img && typeof img === 'object') {
                url = img.url || img.image_url?.url;
                if (!url && img.data) {
                    const mime = img.mimeType || img.media_type || 'image/png';
                    url = `data:${mime};base64,${img.data}`;
                }
            }
            if (url) items.push({ type: 'image', url });
        }
    }

    // 视频
    if (typeof obj.video === 'string') {
        items.push({ type: 'video', url: obj.video });
    }
    if (Array.isArray(obj.videos)) {
        const seen = new Set();
        for (const v of obj.videos) {
            const url = typeof v === 'string' ? v : v?.url;
            if (url && !seen.has(url)) {
                seen.add(url);
                items.push({ type: 'video', url });
            }
        }
    }

    return items;
}

/**
 * 解析各种格式的图片数据为 URL
 */
function resolveImageUrl(imageData) {
    if (typeof imageData === 'string') {
        return imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
    }
    if (typeof imageData === 'object') {
        if (imageData.inlineData) {
            return `data:${imageData.inlineData.mimeType};base64,${imageData.inlineData.data}`;
        }
        if (imageData.source) {
            return `data:${imageData.source.media_type || imageData.source.mimeType || 'image/png'};base64,${imageData.source.data}`;
        }
        if (imageData.data) {
            const mime = imageData.mimeType || imageData.media_type || 'image/png';
            return `data:${mime};base64,${imageData.data}`;
        }
    }
    return null;
}

/**
 * 创建图片 wrapper（可点击查看大图 + 下载）
 */
function createImageWrapper(url) {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper';

    const img = document.createElement('img');
    img.src = url;
    img.alt = '工具返回的图片';
    img.title = '点击查看大图';
    img.style.cursor = 'pointer';
    img.onclick = () => eventBus.emit('ui:open-image-viewer', { url });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'download-image-btn';
    downloadBtn.title = '下载原图';
    downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadMedia(url, `tool-image-${Date.now()}.png`);
    };

    wrapper.append(img, downloadBtn);
    return wrapper;
}

/**
 * 创建视频 wrapper
 */
function createVideoWrapper(url) {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper video-wrapper';

    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    wrapper.appendChild(video);
    return wrapper;
}

/**
 * 下载媒体文件
 */
function downloadMedia(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ==================== 详情弹窗 ====================

function openToolDetailModal(group) {
    const data = toolCallsDataMap.get(group);
    if (!data) return;

    // 移除已有弹窗
    document.querySelector('.tool-detail-modal')?.remove();

    // 最外层：fixed 全屏遮罩 + 居中
    const modal = document.createElement('div');
    modal.className = 'tool-detail-modal';

    const overlay = document.createElement('div');
    overlay.className = 'tool-detail-overlay';
    overlay.onclick = () => modal.remove();

    // 内容面板：自建，不用 .modal-content（避免其 overflow:hidden）
    const panel = document.createElement('div');
    panel.className = 'tool-detail-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'tool-detail-panel-header';
    const title = document.createElement('h3');
    title.textContent = '工具调用详情';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tool-detail-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => modal.remove();
    header.append(title, closeBtn);

    // Body — 滚动区域，固定高度
    const body = document.createElement('div');
    body.className = 'tool-detail-panel-body';

    for (const tool of data.tools) {
        body.appendChild(createToolDetailItem(tool));
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'tool-detail-panel-footer';

    const undoBtn = document.createElement('button');
    undoBtn.className = 'tool-undo-button';
    undoBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"></path>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
        </svg>
        <span>撤销所有工具调用</span>
    `;
    undoBtn.onclick = async () => {
        const confirmed = await showConfirmDialog(
            '确定要撤销所有工具调用吗？\n\n这将恢复到工具调用前的消息状态。\n此操作不可逆！',
            '确认撤销'
        );
        if (!confirmed) return;

        try {
            undoBtn.disabled = true;
            const { undo, canUndoNow } = await import('../tools/undo.js');
            if (!canUndoNow()) {
                eventBus.emit('ui:notification', { message: '没有可撤销的操作', type: 'warning' });
                return;
            }
            const result = undo();
            if (result?.success) {
                eventBus.emit('ui:notification', {
                    message: `已撤销，恢复到 ${result.snapshot.messageCount} 条消息`,
                    type: 'success'
                });
                group.remove();
                modal.remove();
            } else {
                eventBus.emit('ui:notification', { message: '撤销失败', type: 'error' });
            }
        } catch (err) {
            eventBus.emit('ui:notification', { message: `撤销失败: ${err.message}`, type: 'error' });
        } finally {
            undoBtn.disabled = false;
        }
    };

    footer.appendChild(undoBtn);

    panel.append(header, body, footer);
    modal.append(overlay, panel);
    document.body.appendChild(modal);

    // ESC 关闭
    const onKeydown = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', onKeydown);
        }
    };
    document.addEventListener('keydown', onKeydown);
}

/**
 * 创建单个工具的详情面板
 */
function createToolDetailItem(tool) {
    const item = document.createElement('div');
    item.className = 'tool-detail-item';
    item.setAttribute('data-status', tool.status);

    // 头部
    const header = document.createElement('div');
    header.className = 'tool-detail-header';

    const statusIcon = document.createElement('span');
    statusIcon.className = 'tool-detail-status-icon';
    if (tool.status === 'completed') {
        statusIcon.innerHTML = getIcon('checkCircle', { size: 16 });
    } else if (tool.status === 'failed') {
        statusIcon.innerHTML = getIcon('xCircle', { size: 16 });
    } else {
        statusIcon.innerHTML = getIcon('loader', { size: 16 });
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'tool-detail-name';
    nameEl.textContent = TOOL_DISPLAY_NAMES[tool.name] || tool.name;

    const durationEl = document.createElement('span');
    durationEl.className = 'tool-detail-duration';
    durationEl.textContent = tool.duration ? `${tool.duration}s` : '';

    header.append(statusIcon, nameEl, durationEl);

    // 折叠面板
    const details = document.createElement('details');
    details.className = 'tool-detail-body';

    const summary = document.createElement('summary');
    summary.textContent = '查看详情';

    // 参数
    const argsSection = document.createElement('div');
    argsSection.className = 'tool-detail-section';
    argsSection.innerHTML = `<div class="tool-detail-section-label">参数</div>`;
    const argsPre = document.createElement('pre');
    argsPre.className = 'tool-detail-json';
    argsPre.textContent = JSON.stringify(tool.args, null, 2);
    argsSection.appendChild(argsPre);

    details.append(summary, argsSection);

    // 结果/错误
    if (tool.status === 'completed' && tool.result != null) {
        const resultSection = document.createElement('div');
        resultSection.className = 'tool-detail-section';
        resultSection.innerHTML = `<div class="tool-detail-section-label">结果</div>`;
        const resultContent = document.createElement('div');
        resultContent.className = 'tool-detail-result-content';
        renderDetailResult(resultContent, tool.result);
        resultSection.appendChild(resultContent);
        details.appendChild(resultSection);
    }

    if (tool.status === 'failed' && tool.error) {
        const errorSection = document.createElement('div');
        errorSection.className = 'tool-detail-section tool-detail-error';
        errorSection.innerHTML = `<div class="tool-detail-section-label">错误</div>`;
        const errorMsg = document.createElement('div');
        errorMsg.className = 'tool-detail-error-msg';
        errorMsg.textContent = tool.error;
        errorSection.appendChild(errorMsg);
        details.appendChild(errorSection);
    }

    item.append(header, details);
    return item;
}

/**
 * 在弹窗中渲染工具结果
 */
function renderDetailResult(container, result) {
    const normalized = (result?.success === true && result.result !== undefined) ? result.result : result;

    if (typeof normalized === 'string') {
        container.textContent = normalized;
        return;
    }

    if (Array.isArray(normalized)) {
        // 简化：搜索结果列表
        if (normalized.length === 0) {
            container.textContent = '(无结果)';
            return;
        }
        for (const item of normalized.slice(0, 10)) {
            if (typeof item === 'object' && item.title && item.url) {
                const link = document.createElement('a');
                link.href = item.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'tool-detail-link';
                link.textContent = item.title;
                container.appendChild(link);
                if (item.snippet) {
                    const snippet = document.createElement('p');
                    snippet.className = 'tool-detail-snippet';
                    snippet.textContent = item.snippet;
                    container.appendChild(snippet);
                }
            } else {
                const pre = document.createElement('pre');
                pre.className = 'tool-detail-json';
                pre.textContent = JSON.stringify(item, null, 2);
                container.appendChild(pre);
            }
        }
        if (normalized.length > 10) {
            const more = document.createElement('div');
            more.className = 'tool-detail-more';
            more.textContent = `... 还有 ${normalized.length - 10} 项`;
            container.appendChild(more);
        }
        return;
    }

    if (typeof normalized === 'object') {
        // 图片在弹窗中也展示缩略图
        const media = collectMedia(normalized);
        for (const m of media) {
            if (m.type === 'image') {
                const img = document.createElement('img');
                img.src = m.url;
                img.className = 'tool-detail-image';
                img.onclick = () => eventBus.emit('ui:open-image-viewer', { url: m.url });
                container.appendChild(img);
            }
        }

        // 文本
        if (normalized.text) {
            const textEl = document.createElement('div');
            textEl.className = 'tool-detail-text';
            textEl.textContent = normalized.text;
            container.appendChild(textEl);
        }

        // 其他字段
        const other = { ...normalized };
        delete other.image; delete other.images; delete other.video; delete other.videos; delete other.text;
        if (Object.keys(other).length > 0) {
            const pre = document.createElement('pre');
            pre.className = 'tool-detail-json';
            pre.textContent = JSON.stringify(other, null, 2);
            container.appendChild(pre);
        }
    }
}

// ==================== Group 计时器 ====================

function startGroupTimer(group) {
    const startTime = Date.now();
    const btn = group.querySelector('.tool-calls-summary-btn');
    const statusEl = btn?.querySelector('.summary-status');

    const timer = setInterval(() => {
        const data = toolCallsDataMap.get(group);
        if (!data) return;
        const done = data.completedCount + data.failedCount;
        if (done >= data.totalCount) return;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (statusEl) {
            statusEl.textContent = `执行中 ${done}/${data.totalCount} · ${elapsed}s`;
        }
    }, 500);

    // 用 group 的内存地址作为 key
    groupTimers.set(group, timer);
}

function stopGroupTimer(group) {
    const timer = groupTimers.get(group);
    if (timer) {
        clearInterval(timer);
        groupTimers.delete(group);
    }
}

// ==================== 恢复用 API ====================

/**
 * 恢复工具调用 UI（从持久化数据重建）
 * @param {Array} toolCalls - 保存的工具调用数据
 * @param {HTMLElement} contentDiv - 消息的 .message-content 元素
 */
export async function restoreToolCallsGroup(toolCalls, contentDiv) {
    if (!toolCalls || toolCalls.length === 0 || !contentDiv) return;

    const group = document.createElement('div');
    group.className = 'tool-calls-group';

    // 按钮
    const btn = document.createElement('button');
    btn.className = 'tool-calls-summary-btn';
    btn.onclick = () => openToolDetailModal(group);

    // 媒体区
    const mediaArea = document.createElement('div');
    mediaArea.className = 'tool-media-area';

    group.append(btn, mediaArea);

    // 构建数据
    const data = {
        tools: [],
        completedCount: 0,
        failedCount: 0,
        totalCount: toolCalls.length
    };

    for (const tc of toolCalls) {
        const toolInfo = {
            id: tc.id,
            name: tc.name,
            args: tc.arguments || tc.input || {},
            status: tc.status || 'completed',
            result: tc.result || null,
            error: tc.error ? (tc.error.message || tc.error) : null,
            startTime: 0,
            duration: tc.duration || null
        };

        if (toolInfo.status === 'completed') data.completedCount++;
        if (toolInfo.status === 'failed') data.failedCount++;

        data.tools.push(toolInfo);

        // 提取已完成的媒体
        if (toolInfo.status === 'completed' && toolInfo.result) {
            const normalized = (toolInfo.result?.success === true && toolInfo.result.result !== undefined)
                ? toolInfo.result.result : toolInfo.result;
            const mediaItems = collectMedia(normalized);
            for (const item of mediaItems) {
                if (item.type === 'image') {
                    mediaArea.appendChild(createImageWrapper(item.url));
                } else if (item.type === 'video') {
                    mediaArea.appendChild(createVideoWrapper(item.url));
                }
            }
        }
    }

    toolCallsDataMap.set(group, data);

    // 设置按钮状态
    const allDone = data.completedCount + data.failedCount >= data.totalCount;
    let statusText = '全部完成';
    let statusAttr = 'completed';
    if (!allDone) {
        statusText = `执行中 ${data.completedCount + data.failedCount}/${data.totalCount}`;
        statusAttr = 'executing';
    } else if (data.failedCount > 0) {
        statusText = `${data.failedCount} 个失败`;
        statusAttr = 'failed';
    }

    btn.setAttribute('data-status', statusAttr);
    btn.innerHTML = `
        ${getIcon('tool', { size: 14 })}
        <span class="summary-text">${data.totalCount} 个工具调用</span>
        <span class="summary-status">${statusText}</span>
        <svg class="summary-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    `;

    // 插入到 message-content 最前面
    contentDiv.prepend(group);
}
