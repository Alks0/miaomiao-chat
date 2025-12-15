/**
 * 预填充消息编辑器
 * 处理预填充消息的添加、编辑、删除和预设管理
 */

import { state } from '../core/state.js';
import { saveCurrentConfig } from '../state/config.js';
import { showNotification } from './notifications.js';
import { escapeHtml } from '../utils/helpers.js';
import { showInputDialog, showConfirmDialog } from '../utils/dialogs.js';

/**
 * ✅ 自动调整文本框高度（通用函数）
 * @param {HTMLTextAreaElement} textarea - 文本框元素
 * @param {number} minHeight - 最小高度（默认 60px）
 * @param {number} maxHeight - 最大高度（默认 300px）
 */
function autoResizeTextareaGeneric(textarea, minHeight = 60, maxHeight = 300) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';
}

/**
 * 渲染预填充消息列表
 */
export function renderPrefillMessagesList() {
    const container = document.getElementById('prefill-messages-list');
    if (!container) return;

    container.innerHTML = state.prefillMessages.map((msg, idx) => `
        <div class="prefill-message-item" data-index="${idx}">
            <div class="prefill-message-header">
                <span class="prefill-msg-index">#${idx + 1}</span>
                <select class="prefill-role-select" data-index="${idx}">
                    <option value="user" ${msg.role === 'user' ? 'selected' : ''}>user</option>
                    <option value="assistant" ${msg.role === 'assistant' ? 'selected' : ''}>assistant</option>
                </select>
                <button class="delete-prefill-msg" data-index="${idx}" title="删除">×</button>
            </div>
            <textarea class="prefill-msg-content" data-index="${idx}" placeholder="消息内容...">${escapeHtml(msg.content)}</textarea>
        </div>
    `).join('');

    // 绑定事件
    container.querySelectorAll('.prefill-role-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.prefillMessages[idx].role = e.target.value;
            state.currentPrefillPresetName = '';
            saveCurrentConfig();
        });
    });

    container.querySelectorAll('.prefill-msg-content').forEach(textarea => {
        // ✅ 初始化时自动调整高度
        autoResizeTextareaGeneric(textarea);

        textarea.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.prefillMessages[idx].content = e.target.value;
            state.currentPrefillPresetName = '';
            saveCurrentConfig();
            // ✅ 输入时自动调整高度
            autoResizeTextareaGeneric(e.target);
        });
    });

    container.querySelectorAll('.delete-prefill-msg').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.prefillMessages.splice(idx, 1);
            state.currentPrefillPresetName = '';
            renderPrefillMessagesList();
            saveCurrentConfig();
        });
    });
}

/**
 * 保存预填充预设
 */
async function savePrefillPreset() {
    const name = await showInputDialog(
        '请输入预设名称:',
        state.currentPrefillPresetName || '新预设',
        '保存预设'
    );
    if (!name) return;

    const preset = {
        name,
        systemPrompt: state.systemPrompt,
        prefillMessages: JSON.parse(JSON.stringify(state.prefillMessages)),
        charName: state.charName,
        userName: state.userName
    };

    const idx = state.savedPrefillPresets.findIndex(p => p.name === name);
    if (idx >= 0) {
        state.savedPrefillPresets[idx] = preset;
    } else {
        state.savedPrefillPresets.push(preset);
    }

    state.currentPrefillPresetName = name;
    updatePrefillPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已保存`, 'info');
}

/**
 * 加载预填充预设
 */
function loadPrefillPreset() {
    const name = document.getElementById('prefill-preset-select')?.value;
    if (!name) {
        state.currentPrefillPresetName = '';
        return;
    }

    const preset = state.savedPrefillPresets.find(p => p.name === name);
    if (preset) {
        state.systemPrompt = preset.systemPrompt || '';
        state.prefillMessages = JSON.parse(JSON.stringify(preset.prefillMessages || []));
        state.charName = preset.charName || 'Assistant';
        state.userName = preset.userName || 'User';
        state.currentPrefillPresetName = name;

        const systemPromptInput = document.getElementById('system-prompt-input');
        const charNameInput = document.getElementById('char-name');
        const userNameInput = document.getElementById('user-name');

        if (systemPromptInput) systemPromptInput.value = state.systemPrompt;
        if (charNameInput) charNameInput.value = state.charName;
        if (userNameInput) userNameInput.value = state.userName;

        renderPrefillMessagesList();
        saveCurrentConfig();
    }
}

/**
 * 删除预填充预设
 */
async function deletePrefillPreset() {
    const name = document.getElementById('prefill-preset-select')?.value;
    if (!name) {
        showNotification('请先选择要删除的预设', 'error');
        return;
    }
    const confirmed = await showConfirmDialog(
        `确定删除预设 "${name}" 吗？`,
        '确认删除'
    );
    if (!confirmed) return;

    state.savedPrefillPresets = state.savedPrefillPresets.filter(p => p.name !== name);
    state.currentPrefillPresetName = '';
    updatePrefillPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已删除`, 'info');
}

/**
 * 更新预设选择器
 */
export function updatePrefillPresetSelect() {
    const select = document.getElementById('prefill-preset-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- 自定义 --</option>' +
        state.savedPrefillPresets.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === state.currentPrefillPresetName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
}

/**
 * 初始化预填充控件
 */
export function initPrefillControls() {
    // 开关
    document.getElementById('prefill-enabled')?.addEventListener('change', (e) => {
        state.prefillEnabled = e.target.checked;
        document.getElementById('prefill-config')?.classList.toggle('disabled', !e.target.checked);
        saveCurrentConfig();
    });

    // System Prompt
    const systemPromptInput = document.getElementById('system-prompt-input');
    if (systemPromptInput) {
        // ✅ 初始化时同步 state 到 UI（防止首次加载时 UI 和 state 不同步）
        systemPromptInput.value = state.systemPrompt || '';

        systemPromptInput.addEventListener('input', (e) => {
            state.systemPrompt = e.target.value;
            state.currentPrefillPresetName = '';
            console.log('[Prefill] System Prompt 已更新:', state.systemPrompt.substring(0, 50) + '...');
            saveCurrentConfig();
        });
    }

    // 变量
    document.getElementById('char-name')?.addEventListener('input', (e) => {
        state.charName = e.target.value;
        saveCurrentConfig();
    });
    document.getElementById('user-name')?.addEventListener('input', (e) => {
        state.userName = e.target.value;
        saveCurrentConfig();
    });

    // 添加消息
    document.getElementById('add-prefill-message')?.addEventListener('click', () => {
        state.prefillMessages.push({ role: 'user', content: '' });
        state.currentPrefillPresetName = '';
        renderPrefillMessagesList();
        saveCurrentConfig();
    });

    // 预设管理
    document.getElementById('save-prefill-preset')?.addEventListener('click', savePrefillPreset);
    document.getElementById('delete-prefill-preset')?.addEventListener('click', deletePrefillPreset);
    document.getElementById('prefill-preset-select')?.addEventListener('change', loadPrefillPreset);

    // 初始渲染
    renderPrefillMessagesList();
    updatePrefillPresetSelect();

    console.log('Prefill controls initialized');
}

/**
 * 渲染 Gemini System Parts 列表
 */
function renderGeminiSystemPartsList() {
    const container = document.getElementById('gemini-system-parts-list');
    if (!container) return;

    if (state.geminiSystemParts.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--md-muted); font-size: 12px; padding: 12px;">暂无 System Parts</div>';
        return;
    }

    container.innerHTML = state.geminiSystemParts.map((part, idx) => `
        <div class="system-part-item" data-index="${idx}">
            <div class="system-part-header">
                <span class="system-part-index">Part #${idx + 1}</span>
                <button class="delete-system-part" data-index="${idx}" title="删除">×</button>
            </div>
            <textarea class="system-part-content" data-index="${idx}" placeholder="System Instruction Part 内容...">${escapeHtml(part.text || '')}</textarea>
        </div>
    `).join('');

    // 绑定事件
    container.querySelectorAll('.system-part-content').forEach(textarea => {
        // ✅ 初始化时自动调整高度
        autoResizeTextareaGeneric(textarea);

        textarea.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.geminiSystemParts[idx].text = e.target.value;
            saveCurrentConfig();
            // ✅ 输入时自动调整高度
            autoResizeTextareaGeneric(e.target);
        });
    });

    container.querySelectorAll('.delete-system-part').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.geminiSystemParts.splice(idx, 1);
            renderGeminiSystemPartsList();
            saveCurrentConfig();
        });
    });
}

/**
 * 添加 Gemini System Part
 */
function addGeminiSystemPart() {
    const input = document.getElementById('gemini-system-part-input');
    if (!input) return;

    const text = input.value.trim();
    if (!text) {
        showNotification('请输入 System Part 内容', 'warning');
        return;
    }

    state.geminiSystemParts.push({ text });
    input.value = '';
    renderGeminiSystemPartsList();
    saveCurrentConfig();
    showNotification('System Part 已添加', 'success');
}

/**
 * 初始化 Gemini System Parts 控件
 */
export function initGeminiSystemParts() {
    // 添加按钮
    const addBtn = document.getElementById('add-gemini-system-part');
    addBtn?.addEventListener('click', addGeminiSystemPart);

    // 输入框回车快捷键
    const input = document.getElementById('gemini-system-part-input');
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            addGeminiSystemPart();
        }
    });

    // 初始渲染
    renderGeminiSystemPartsList();

    console.log('Gemini system parts initialized');
}
