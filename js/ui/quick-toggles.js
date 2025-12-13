/**
 * 快捷开关功能
 * 处理顶部快捷开关（流式/思维链/网络搜索）
 */

import { state } from '../core/state.js';
import { saveCurrentConfig } from '../state/config.js';
import { handleAttachFile } from './input.js';

/**
 * 同步快捷开关状态
 */
export function syncQuickToggles() {
    document.getElementById('toggle-stream')?.classList.toggle('active', state.streamEnabled);
    document.getElementById('toggle-thinking')?.classList.toggle('active', state.thinkingEnabled);
    document.getElementById('toggle-websearch')?.classList.toggle('active', state.webSearchEnabled);
}

/**
 * 初始化快捷开关
 */
export function initQuickToggles() {
    // 流式开关
    const toggleStream = document.getElementById('toggle-stream');
    if (toggleStream) {
        toggleStream.classList.toggle('active', state.streamEnabled);
        toggleStream.addEventListener('click', () => {
            state.streamEnabled = !state.streamEnabled;
            toggleStream.classList.toggle('active', state.streamEnabled);
            // 同步设置面板开关
            const panelSwitch = document.getElementById('stream-enabled');
            if (panelSwitch) panelSwitch.checked = state.streamEnabled;
            saveCurrentConfig();
        });
    }

    // 思维链开关
    const toggleThinking = document.getElementById('toggle-thinking');
    if (toggleThinking) {
        toggleThinking.classList.toggle('active', state.thinkingEnabled);
        toggleThinking.addEventListener('click', () => {
            state.thinkingEnabled = !state.thinkingEnabled;
            toggleThinking.classList.toggle('active', state.thinkingEnabled);
            // 同步设置面板开关
            const panelSwitch = document.getElementById('thinking-enabled');
            if (panelSwitch) panelSwitch.checked = state.thinkingEnabled;
            // 显示/隐藏强度选择
            const strengthGroup = document.getElementById('thinking-strength-group');
            if (strengthGroup) strengthGroup.style.display = state.thinkingEnabled ? 'flex' : 'none';
            saveCurrentConfig();
        });
    }

    // 网络搜索开关
    const toggleWebsearch = document.getElementById('toggle-websearch');
    if (toggleWebsearch) {
        toggleWebsearch.classList.toggle('active', state.webSearchEnabled);
        toggleWebsearch.addEventListener('click', () => {
            state.webSearchEnabled = !state.webSearchEnabled;
            toggleWebsearch.classList.toggle('active', state.webSearchEnabled);
            // 同步设置面板开关
            const panelSwitch = document.getElementById('web-search-enabled');
            if (panelSwitch) panelSwitch.checked = state.webSearchEnabled;
            saveCurrentConfig();
        });
    }

    // 上传按钮（复用 handleAttachFile）
    const attachFileMini = document.getElementById('attach-file-mini');
    if (attachFileMini) {
        attachFileMini.addEventListener('click', handleAttachFile);
    }

    console.log('Quick toggles initialized');
}

/**
 * 暴露到全局供 HTML 使用
 */
export function exposeToggleFunctions() {
    // 思维链折叠/展开
    window.toggleThinking = function(header) {
        const block = header.parentElement;
        const isCollapsed = block.classList.toggle('collapsed');
        header.setAttribute('aria-expanded', !isCollapsed);
    };

    // 思维链键盘事件
    window.handleThinkingKeydown = function(event, header) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.toggleThinking(header);
        }
    };
}
