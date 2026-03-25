/**
 * OpenClaw 审批弹窗
 * 当 Agent 执行危险操作时弹出确认对话框
 */

import { eventBus } from '../core/events.js';
import { openclawClient } from '../api/openclaw.js';

let countdownTimer = null;
let countdownSeconds = 60;

/**
 * 初始化审批系统
 */
export function initOpenClawApproval() {
    eventBus.on('openclaw:approval-requested', showApprovalModal);

    const approveBtn = document.getElementById('openclaw-approve-btn');
    const rejectBtn = document.getElementById('openclaw-reject-btn');

    if (approveBtn) {
        approveBtn.addEventListener('click', () => respondApproval(true));
    }
    if (rejectBtn) {
        rejectBtn.addEventListener('click', () => respondApproval(false));
    }
}

/**
 * 显示审批弹窗
 * @param {Object} payload - 审批请求数据
 */
function showApprovalModal(payload) {
    const overlay = document.getElementById('openclaw-approval-overlay');
    if (!overlay) return;

    const { approvalId, description, tool, command, riskLevel } = payload;
    overlay.dataset.approvalId = approvalId;

    // 填充内容
    const descEl = document.getElementById('openclaw-approval-desc');
    const toolEl = document.getElementById('openclaw-approval-tool');
    const cmdEl = document.getElementById('openclaw-approval-command');
    const riskEl = document.getElementById('openclaw-approval-risk');
    const countdownEl = document.getElementById('openclaw-approval-countdown');

    if (descEl) descEl.textContent = description || '未知操作';
    if (toolEl) toolEl.textContent = tool || '';
    if (cmdEl) {
        cmdEl.textContent = command || '';
        cmdEl.parentElement.style.display = command ? '' : 'none';
    }

    // 风险等级
    if (riskEl) {
        const riskLabels = { low: '低', medium: '中', high: '高', critical: '极高' };
        const riskColors = { low: '#4caf50', medium: '#ff9800', high: '#f44336', critical: '#d32f2f' };
        const level = riskLevel || 'medium';
        riskEl.textContent = riskLabels[level] || level;
        riskEl.style.color = riskColors[level] || '#ff9800';
    }

    // 倒计时
    countdownSeconds = payload.timeoutSeconds || 60;
    if (countdownEl) countdownEl.textContent = countdownSeconds;

    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        countdownSeconds--;
        if (countdownEl) countdownEl.textContent = countdownSeconds;
        if (countdownSeconds <= 0) {
            respondApproval(false); // 超时自动拒绝
        }
    }, 1000);

    overlay.style.display = 'block';
}

/**
 * 响应审批
 * @param {boolean} approved - 是否批准
 */
async function respondApproval(approved) {
    const overlay = document.getElementById('openclaw-approval-overlay');
    if (!overlay) return;

    const approvalId = overlay.dataset.approvalId;
    if (!approvalId) return;

    clearInterval(countdownTimer);
    overlay.style.display = 'none';

    try {
        await openclawClient.approveAction(approvalId, approved);
        console.log(`[OpenClaw] 审批响应: ${approved ? '允许' : '拒绝'} (${approvalId})`);
    } catch (e) {
        console.error('[OpenClaw] 审批响应失败:', e);
    }
}
