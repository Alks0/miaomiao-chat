/**
 * OpenClaw 屏幕画面实时展示
 * 在聊天消息流中内嵌显示 Agent 操作的屏幕截图
 */

import { eventBus } from '../core/events.js';
import { state } from '../core/state.js';
import { openImageViewer } from './viewer.js';

// 截图上限（防止内存溢出）
const MAX_SCREENSHOTS = 50;

// 当前截图时间线（仅存 URL，不存原始 base64）
let screenshots = [];
let currentIndex = -1;

/**
 * 初始化屏幕展示组件
 */
export function initOpenClawScreen() {
    eventBus.on('openclaw:screen-capture', handleScreenCapture);
    eventBus.on('openclaw:chat-done', markScreenEnded);
}

/**
 * 处理屏幕截图事件
 * @param {Object} data - { image, timestamp, width, height }
 */
function handleScreenCapture(data) {
    if (!data?.image) return;

    const { image, timestamp } = data;

    // 获取或创建截图容器
    const container = getOrCreateScreenViewer();
    if (!container) return;

    // 淘汰最老的截图（防止内存膨胀）
    if (screenshots.length >= MAX_SCREENSHOTS) {
        const evicted = screenshots.shift();
        // 如果用了 objectURL 则 revoke
        if (evicted.blobUrl) URL.revokeObjectURL(evicted.blobUrl);
        // 移除对应缩略图 DOM
        const timeline = container.querySelector('.openclaw-screen-timeline');
        const firstThumb = timeline?.querySelector('.openclaw-screen-thumb');
        if (firstThumb) firstThumb.remove();
        // 重新编号所有缩略图
        timeline?.querySelectorAll('.openclaw-screen-thumb').forEach((t, i) => {
            t.dataset.index = i;
        });
    }

    // 保存截图（存原始 data URL，缩略图复用同一 src）
    screenshots.push({ image, timestamp: timestamp || Date.now() });
    currentIndex = screenshots.length - 1;

    // 更新主画面
    const mainImg = container.querySelector('.openclaw-screen-current');
    if (mainImg) mainImg.src = image;

    // 更新 badge
    const badge = container.querySelector('.openclaw-screen-badge');
    if (badge) {
        badge.classList.remove('ended');
        badge.textContent = '';
        badge.insertAdjacentHTML('afterbegin', '<span></span>实时画面');
    }

    // 添加缩略图
    const timeline = container.querySelector('.openclaw-screen-timeline');
    if (timeline) {
        timeline.querySelectorAll('.openclaw-screen-thumb').forEach(t => t.classList.remove('active'));

        const thumb = document.createElement('img');
        thumb.className = 'openclaw-screen-thumb active';
        thumb.src = image;
        thumb.dataset.index = currentIndex;
        thumb.addEventListener('click', () => {
            selectScreenshot(container, parseInt(thumb.dataset.index));
        });
        timeline.appendChild(thumb);
        timeline.scrollLeft = timeline.scrollWidth;
    }
}

/**
 * 获取或创建截图容器（嵌入到当前 assistant 消息中）
 */
function getOrCreateScreenViewer() {
    const contentEl = state.currentAssistantMessage;
    if (!contentEl) return null;

    let viewer = contentEl.querySelector('.openclaw-screen-viewer');
    if (viewer) return viewer;

    viewer = document.createElement('div');
    viewer.className = 'openclaw-screen-viewer';
    viewer.innerHTML = `
        <div class="openclaw-screen-main">
            <img class="openclaw-screen-current" src="" alt="屏幕截图" />
            <div class="openclaw-screen-badge">实时画面</div>
        </div>
        <div class="openclaw-screen-timeline"></div>
    `;

    // 主画面点击放大
    viewer.querySelector('.openclaw-screen-main').addEventListener('click', () => {
        if (currentIndex >= 0 && screenshots[currentIndex]) {
            openImageViewer(screenshots[currentIndex].image);
        }
    });

    contentEl.appendChild(viewer);

    // 重置时间线
    screenshots = [];
    currentIndex = -1;

    return viewer;
}

/**
 * 选择时间线中的截图
 */
function selectScreenshot(container, index) {
    if (index < 0 || index >= screenshots.length) return;
    currentIndex = index;

    const mainImg = container.querySelector('.openclaw-screen-current');
    if (mainImg) mainImg.src = screenshots[index].image;

    container.querySelectorAll('.openclaw-screen-thumb').forEach(t => {
        t.classList.toggle('active', parseInt(t.dataset.index) === index);
    });
}

/**
 * 标记截图流结束
 */
function markScreenEnded() {
    document.querySelectorAll('.openclaw-screen-viewer .openclaw-screen-badge:not(.ended)').forEach(badge => {
        badge.classList.add('ended');
        badge.textContent = '已结束';
    });
}
