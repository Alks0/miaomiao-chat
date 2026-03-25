/**
 * OpenClaw 定时任务管理面板
 * 通过 Gateway 的 cron.* 方法管理自动化任务
 */

import { eventBus } from '../core/events.js';
import { openclawClient } from '../api/openclaw.js';
import { escapeHtml } from '../utils/helpers.js';

let cronJobs = [];

/**
 * 初始化定时任务面板
 */
export function initOpenClawCron() {
    document.getElementById('openclaw-cron-close')?.addEventListener('click', closeCronPanel);
    document.getElementById('openclaw-cron-add')?.addEventListener('click', addCronJob);

    document.getElementById('openclaw-cron-schedule')?.addEventListener('change', (e) => {
        const customInput = document.getElementById('openclaw-cron-custom');
        if (customInput) {
            customInput.style.display = e.target.value === 'custom' ? '' : 'none';
        }
    });

    document.getElementById('openclaw-cron-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'openclaw-cron-overlay') closeCronPanel();
    });

    // 事件委托：列表内按钮点击
    document.getElementById('openclaw-cron-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const item = btn.closest('.openclaw-cron-item');
        const cronId = item?.dataset.cronId;
        if (!cronId) return;

        if (btn.dataset.action === 'toggle') {
            toggleCronJob(cronId, btn.dataset.enabled === 'true');
        } else if (btn.dataset.action === 'delete') {
            deleteCronJob(cronId);
        }
    });

    eventBus.on('openclaw:cron-event', handleCronEvent);
}

/**
 * 打开定时任务面板
 */
export async function openCronPanel() {
    const overlay = document.getElementById('openclaw-cron-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    await refreshCronList();
}

/**
 * 关闭面板
 */
function closeCronPanel() {
    const overlay = document.getElementById('openclaw-cron-overlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * 刷新任务列表
 */
async function refreshCronList() {
    const listEl = document.getElementById('openclaw-cron-list');
    if (!listEl) return;

    if (!openclawClient.connected) {
        listEl.innerHTML = '<div class="openclaw-cron-empty">未连接到 OpenClaw</div>';
        return;
    }

    try {
        cronJobs = await openclawClient.send('cron.list');
        renderCronList(listEl);
    } catch (e) {
        listEl.innerHTML = `<div class="openclaw-cron-empty">加载失败: ${escapeHtml(e.message)}</div>`;
    }
}

/**
 * 渲染任务列表
 */
function renderCronList(listEl) {
    if (!Array.isArray(cronJobs) || cronJobs.length === 0) {
        listEl.innerHTML = '<div class="openclaw-cron-empty">暂无定时任务</div>';
        return;
    }

    listEl.innerHTML = cronJobs.map(job => {
        const enabled = job.enabled !== false;
        return `
        <div class="openclaw-cron-item" data-cron-id="${escapeHtml(job.id)}">
            <div class="openclaw-cron-item-header">
                <span class="openclaw-cron-item-message">${escapeHtml(job.message || job.description || '-')}</span>
            </div>
            <div class="openclaw-cron-item-meta">
                <span>${cronToHuman(job.schedule)}</span>
                ${job.nextRun ? `<span>下次: ${formatTime(job.nextRun)}</span>` : ''}
                ${job.lastRun ? `<span>上次: ${formatTime(job.lastRun)}</span>` : ''}
                <span class="openclaw-cron-item-status ${enabled ? '' : 'paused'}">${enabled ? '运行中' : '已暂停'}</span>
            </div>
            <div class="openclaw-cron-item-actions">
                <button data-action="toggle" data-enabled="${enabled}">${enabled ? '暂停' : '恢复'}</button>
                <button data-action="delete" class="delete">删除</button>
            </div>
        </div>`;
    }).join('');
}

/**
 * 添加定时任务
 */
async function addCronJob() {
    const messageInput = document.getElementById('openclaw-cron-message');
    const scheduleSelect = document.getElementById('openclaw-cron-schedule');
    const customInput = document.getElementById('openclaw-cron-custom');

    const message = messageInput?.value.trim();
    if (!message) return;

    let schedule = scheduleSelect?.value;
    if (schedule === 'custom') {
        schedule = customInput?.value.trim();
        if (!schedule) return;
    }

    try {
        await openclawClient.send('cron.create', { schedule, message });
        if (messageInput) messageInput.value = '';
        await refreshCronList();
    } catch (e) {
        console.error('[OpenClaw Cron] 创建失败:', e);
    }
}

/**
 * 切换任务启停
 */
async function toggleCronJob(id, currentlyEnabled) {
    try {
        await openclawClient.send('cron.update', { id, enabled: !currentlyEnabled });
        await refreshCronList();
    } catch (e) {
        console.error('[OpenClaw Cron] 切换失败:', e);
    }
}

/**
 * 删除任务
 */
async function deleteCronJob(id) {
    try {
        await openclawClient.send('cron.delete', { id });
        await refreshCronList();
    } catch (e) {
        console.error('[OpenClaw Cron] 删除失败:', e);
    }
}

/**
 * 处理 cron 事件
 */
function handleCronEvent(payload) {
    if (payload?.type === 'executed') {
        refreshCronList();
    }
}

/**
 * cron 表达式转人类可读
 */
function cronToHuman(expr) {
    if (!expr) return '-';
    const map = {
        '*/5 * * * *': '每 5 分钟',
        '*/10 * * * *': '每 10 分钟',
        '*/15 * * * *': '每 15 分钟',
        '*/30 * * * *': '每 30 分钟',
        '0 * * * *': '每小时',
        '0 9 * * *': '每天 09:00',
        '0 9 * * 1-5': '工作日 09:00',
        '0 0 * * *': '每天 00:00',
        '0 12 * * *': '每天 12:00',
        '0 18 * * *': '每天 18:00',
    };
    return map[expr] || expr;
}

/**
 * 格式化时间
 */
function formatTime(ts) {
    if (!ts) return '-';
    try {
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return String(ts);
    }
}
