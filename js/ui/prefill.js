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
 * 自动调整文本框高度（通用函数）
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
        // 初始化时自动调整高度
        autoResizeTextareaGeneric(textarea);

        textarea.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.prefillMessages[idx].content = e.target.value;
            state.currentPrefillPresetName = '';
            saveCurrentConfig();
            // 输入时自动调整高度
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
        // 初始化时同步 state 到 UI（防止首次加载时 UI 和 state 不同步）
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

// ==================== System 预填充消息（开场对话） ====================

/**
 * 渲染 System 预填充消息列表（开场对话）
 */
export function renderSystemPrefillMessagesList() {
    const container = document.getElementById('system-prefill-messages-list');
    if (!container) return;

    if (state.systemPrefillMessages.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--md-muted); font-size: 12px; padding: 12px;">暂无开场对话</div>';
        return;
    }

    container.innerHTML = state.systemPrefillMessages.map((msg, idx) => `
        <div class="prefill-message-item" data-index="${idx}">
            <div class="prefill-message-header">
                <span class="prefill-msg-index">#${idx + 1}</span>
                <select class="prefill-role-select system-prefill-role" data-index="${idx}">
                    <option value="user" ${msg.role === 'user' ? 'selected' : ''}>user</option>
                    <option value="assistant" ${msg.role === 'assistant' ? 'selected' : ''}>assistant</option>
                </select>
                <button class="delete-prefill-msg delete-system-prefill-msg" data-index="${idx}" title="删除">×</button>
            </div>
            <textarea class="prefill-msg-content system-prefill-content" data-index="${idx}" placeholder="开场消息内容...">${escapeHtml(msg.content)}</textarea>
        </div>
    `).join('');

    // 绑定事件
    container.querySelectorAll('.system-prefill-role').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.systemPrefillMessages[idx].role = e.target.value;
            state.currentSystemPrefillPresetName = '';
            updateSystemPrefillPresetSelect();
            saveCurrentConfig();
        });
    });

    container.querySelectorAll('.system-prefill-content').forEach(textarea => {
        // 初始化时自动调整高度
        autoResizeTextareaGeneric(textarea);

        textarea.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.systemPrefillMessages[idx].content = e.target.value;
            state.currentSystemPrefillPresetName = '';
            updateSystemPrefillPresetSelect();
            saveCurrentConfig();
            autoResizeTextareaGeneric(e.target);
        });
    });

    container.querySelectorAll('.delete-system-prefill-msg').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.systemPrefillMessages.splice(idx, 1);
            state.currentSystemPrefillPresetName = '';
            renderSystemPrefillMessagesList();
            updateSystemPrefillPresetSelect();
            saveCurrentConfig();
        });
    });
}

/**
 * 保存 System 预填充预设
 */
async function saveSystemPrefillPreset() {
    const name = await showInputDialog(
        '请输入预设名称:',
        state.currentSystemPrefillPresetName || '新预设',
        '保存开场对话预设'
    );
    if (!name) return;

    const preset = {
        name,
        systemPrefillMessages: JSON.parse(JSON.stringify(state.systemPrefillMessages))
    };

    const idx = state.savedSystemPrefillPresets.findIndex(p => p.name === name);
    if (idx >= 0) {
        state.savedSystemPrefillPresets[idx] = preset;
    } else {
        state.savedSystemPrefillPresets.push(preset);
    }

    state.currentSystemPrefillPresetName = name;
    updateSystemPrefillPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已保存`, 'info');
}

/**
 * 加载 System 预填充预设
 */
function loadSystemPrefillPreset() {
    const name = document.getElementById('system-prefill-preset-select')?.value;
    if (!name) {
        state.currentSystemPrefillPresetName = '';
        return;
    }

    const preset = state.savedSystemPrefillPresets.find(p => p.name === name);
    if (preset) {
        state.systemPrefillMessages = JSON.parse(JSON.stringify(preset.systemPrefillMessages || []));
        state.currentSystemPrefillPresetName = name;

        renderSystemPrefillMessagesList();
        saveCurrentConfig();
    }
}

/**
 * 删除 System 预填充预设
 */
async function deleteSystemPrefillPreset() {
    const name = document.getElementById('system-prefill-preset-select')?.value;
    if (!name) {
        showNotification('请先选择要删除的预设', 'error');
        return;
    }
    const confirmed = await showConfirmDialog(
        `确定删除预设 "${name}" 吗？`,
        '确认删除'
    );
    if (!confirmed) return;

    state.savedSystemPrefillPresets = state.savedSystemPrefillPresets.filter(p => p.name !== name);
    state.currentSystemPrefillPresetName = '';
    updateSystemPrefillPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已删除`, 'info');
}

/**
 * 更新 System 预填充预设选择器
 */
export function updateSystemPrefillPresetSelect() {
    const select = document.getElementById('system-prefill-preset-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- 自定义 --</option>' +
        state.savedSystemPrefillPresets.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === state.currentSystemPrefillPresetName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
}

/**
 * 初始化 System 预填充控件
 */
export function initSystemPrefillControls() {
    // 添加消息
    document.getElementById('add-system-prefill-message')?.addEventListener('click', () => {
        state.systemPrefillMessages.push({ role: 'user', content: '' });
        state.currentSystemPrefillPresetName = '';
        renderSystemPrefillMessagesList();
        updateSystemPrefillPresetSelect();
        saveCurrentConfig();
    });

    // 预设管理
    document.getElementById('save-system-prefill-preset')?.addEventListener('click', saveSystemPrefillPreset);
    document.getElementById('delete-system-prefill-preset')?.addEventListener('click', deleteSystemPrefillPreset);
    document.getElementById('system-prefill-preset-select')?.addEventListener('change', loadSystemPrefillPreset);

    // 初始渲染
    renderSystemPrefillMessagesList();
    updateSystemPrefillPresetSelect();

    console.log('System prefill controls initialized');
}

// ==================== Gemini System Parts ====================

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
        // 初始化时自动调整高度
        autoResizeTextareaGeneric(textarea);

        textarea.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.geminiSystemParts[idx].text = e.target.value;
            state.currentGeminiPartsPresetName = '';  // 修改后清除当前预设名
            updateGeminiPartsPresetSelect();
            saveCurrentConfig();
            // 输入时自动调整高度
            autoResizeTextareaGeneric(e.target);
        });
    });

    container.querySelectorAll('.delete-system-part').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            state.geminiSystemParts.splice(idx, 1);
            state.currentGeminiPartsPresetName = '';  // 删除后清除当前预设名
            renderGeminiSystemPartsList();
            updateGeminiPartsPresetSelect();
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
    state.currentGeminiPartsPresetName = '';  // 修改后清除当前预设名
    input.value = '';
    renderGeminiSystemPartsList();
    updateGeminiPartsPresetSelect();
    saveCurrentConfig();
    showNotification('System Part 已添加', 'success');
}

/**
 * 保存 Gemini System Parts 预设
 */
async function saveGeminiPartsPreset() {
    const name = await showInputDialog(
        '请输入预设名称:',
        state.currentGeminiPartsPresetName || '新预设',
        '保存预设'
    );
    if (!name) return;

    const preset = {
        name,
        geminiSystemParts: JSON.parse(JSON.stringify(state.geminiSystemParts))
    };

    const idx = state.savedGeminiPartsPresets.findIndex(p => p.name === name);
    if (idx >= 0) {
        state.savedGeminiPartsPresets[idx] = preset;
    } else {
        state.savedGeminiPartsPresets.push(preset);
    }

    state.currentGeminiPartsPresetName = name;
    updateGeminiPartsPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已保存`, 'info');
}

/**
 * 加载 Gemini System Parts 预设
 */
function loadGeminiPartsPreset() {
    const name = document.getElementById('gemini-parts-preset-select')?.value;
    if (!name) {
        state.currentGeminiPartsPresetName = '';
        return;
    }

    const preset = state.savedGeminiPartsPresets.find(p => p.name === name);
    if (preset) {
        state.geminiSystemParts = JSON.parse(JSON.stringify(preset.geminiSystemParts || []));
        state.currentGeminiPartsPresetName = name;

        renderGeminiSystemPartsList();
        saveCurrentConfig();
    }
}

/**
 * 删除 Gemini System Parts 预设
 */
async function deleteGeminiPartsPreset() {
    const name = document.getElementById('gemini-parts-preset-select')?.value;
    if (!name) {
        showNotification('请先选择要删除的预设', 'error');
        return;
    }
    const confirmed = await showConfirmDialog(
        `确定删除预设 "${name}" 吗？`,
        '确认删除'
    );
    if (!confirmed) return;

    state.savedGeminiPartsPresets = state.savedGeminiPartsPresets.filter(p => p.name !== name);
    state.currentGeminiPartsPresetName = '';
    updateGeminiPartsPresetSelect();
    saveCurrentConfig();
    showNotification(`预设 "${name}" 已删除`, 'info');
}

/**
 * 更新 Gemini System Parts 预设选择器
 */
export function updateGeminiPartsPresetSelect() {
    const select = document.getElementById('gemini-parts-preset-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- 自定义 --</option>' +
        state.savedGeminiPartsPresets.map(p =>
            `<option value="${escapeHtml(p.name)}" ${p.name === state.currentGeminiPartsPresetName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
}

/**
 * 初始化 Gemini System Parts 控件
 */
export function initGeminiSystemParts() {
    // 开关事件
    const enabledToggle = document.getElementById('gemini-system-parts-enabled');
    if (enabledToggle) {
        // 初始化时同步 UI
        enabledToggle.checked = state.geminiSystemPartsEnabled;
        document.getElementById('gemini-system-parts-content')?.classList.toggle('disabled', !state.geminiSystemPartsEnabled);

        enabledToggle.addEventListener('change', (e) => {
            state.geminiSystemPartsEnabled = e.target.checked;
            document.getElementById('gemini-system-parts-content')?.classList.toggle('disabled', !e.target.checked);
            saveCurrentConfig();
            console.log('[Prefill] Gemini System Parts 开关:', state.geminiSystemPartsEnabled);
        });
    }

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

    // 预设管理
    document.getElementById('save-gemini-parts-preset')?.addEventListener('click', saveGeminiPartsPreset);
    document.getElementById('delete-gemini-parts-preset')?.addEventListener('click', deleteGeminiPartsPreset);
    document.getElementById('gemini-parts-preset-select')?.addEventListener('change', loadGeminiPartsPreset);

    // 初始渲染
    renderGeminiSystemPartsList();
    updateGeminiPartsPresetSelect();

    console.log('Gemini system parts initialized');
}
