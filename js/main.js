/**
 * 主入口文件
 * 初始化所有模块并启动应用
 */

// ========== 全局错误处理器（H1 修复）==========

/**
 * 全局未捕获的 Promise rejection 处理器
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('🚨 未捕获的 Promise rejection:', event.reason);

    // 阻止默认的错误抛出行为
    event.preventDefault();

    // 尝试显示用户友好的错误消息
    const errorMessage = event.reason?.message || String(event.reason) || '未知错误';

    // 如果有 UI 通知系统，显示错误
    if (window.eventBus) {
        window.eventBus.emit('ui:notification', {
            message: `操作失败: ${errorMessage}`,
            type: 'error'
        });
    }
});

/**
 * 全局错误处理器（捕获同步错误）
 */
window.addEventListener('error', (event) => {
    console.error('🚨 全局错误:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
    });

    // 阻止浏览器默认的错误提示
    event.preventDefault();
});

/**
 * 动态加载 Eruda 调试工具（仅 Android 平台）
 */
async function loadEruda() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'libs/eruda/eruda.js';
        script.onload = () => {
            if (window.eruda) {
                // 初始化 Eruda（自动显示悬浮按钮，但不展开控制台面板）
                window.eruda.init({
                    tool: ['console', 'elements', 'network', 'resources', 'info', 'snippets', 'sources'],
                    useShadowDom: true,
                    autoScale: true,
                    defaults: {
                        displaySize: 40,
                        transparency: 0.9,
                        theme: 'dark'
                    }
                });

                console.log('🔧 Eruda 调试工具已启动（Android 专用）');
                console.log('📱 Eruda 版本:', window.eruda.version);
            } else {
                console.error('❌ window.eruda 未定义');
            }
            resolve();
        };
        script.onerror = (error) => {
            console.error('⚠️ Eruda 加载失败:', error);
            resolve(); // 不阻塞应用启动
        };
        document.head.appendChild(script);
    });
}

/**
 * 初始化 Electron 自定义标题栏
 */
function initElectronTitlebar() {
    if (!window.electronAPI?.isElectron?.()) return;

    const titlebar = document.getElementById('electron-titlebar');
    if (!titlebar) return;

    titlebar.style.display = '';

    document.getElementById('titlebar-devtools')?.addEventListener('click', () => {
        window.electronAPI.toggleDevTools();
    });
    document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
        window.electronAPI.windowMinimize();
    });
    document.getElementById('titlebar-maximize')?.addEventListener('click', () => {
        window.electronAPI.windowMaximize();
    });
    document.getElementById('titlebar-close')?.addEventListener('click', () => {
        window.electronAPI.windowClose();
    });
}

// ========== Core Layer ==========
import './core/events.js';
import { eventBus } from './core/events.js';
import { state } from './core/state.js';
import { elements, initElements } from './core/elements.js';

// ========== Utils Layer ==========
import './utils/helpers.js';
import './utils/variables.js';
import './utils/markdown.js';
import './utils/images.js';
import './utils/prefill.js';
import './utils/errors.js';

// ========== UI Layer (Basic) ==========
import { loadTheme, initTheming } from './ui/theming.js';
import './ui/notifications.js';

// ========== State Layer ==========
import { initDB, loadPreference, isIndexedDBAvailable, isLocalStorageAvailable, migrateMCPServersFromLocalStorage, loadAllMCPServers, migrateSessionsToV4 } from './state/storage.js';
import { loadConfig, saveCurrentConfigImmediate } from './state/config.js';
import { loadSessions, switchToSession } from './state/sessions.js';
// initExportImport → 延迟动态加载
import { initQuickMessages } from './state/quick-messages.js';
// 新增：数据迁移
import {
    executeMigration,
    getMigrationStatus,
    acquireMigrationLock,
    releaseMigrationLock,
    MIGRATION_STATES
} from './state/migration.js';

// ========== Providers Layer ==========
import { migrateFromLegacyConfig } from './providers/manager.js';
// initProvidersUI → 延迟动态加载

// ========== Messages Layer ==========
import './messages/converters.js';
import './messages/sync.js';
import './messages/renderer.js';
import './messages/editor.js';
import './messages/restore.js';
import { initReplySelector } from './messages/reply-selector.js';

// ========== API Layer ==========
import './api/params.js';
import './api/parser.js';
import './api/openai.js';
import './api/gemini.js';
import './api/claude.js';
import './api/factory.js';
import { initAPIHandler } from './api/handler.js';

// ========== Stream Layer ==========
import './stream/stats.js';
import './stream/helpers.js';
import './stream/parser-openai.js';
import './stream/parser-claude.js';
import './stream/parser-gemini.js';
import './stream/tool-call-handler.js';

// ========== Tools Layer (第10层) ==========
import { initTools } from './tools/init.js';
import './tools/message-compat.js';

// ========== UI Layer (Critical — 首屏交互必需) ==========
import { initInputHandlers } from './ui/input.js';
import { initSidebar } from './ui/sidebar.js';
import { initScrollControl } from './ui/scroll.js';
import { initClearChat } from './ui/clear.js';
import { initKeyboard } from './ui/keyboard.js';
import { initInputResize, initPanelResize } from './ui/resize.js';
import { initModels } from './ui/models.js';
import { initFormatSwitcher } from './ui/format-switcher.js';
import { initQuickToggles, exposeToggleFunctions } from './ui/quick-toggles.js';
import { initPasswordToggles, initRippleEffects } from './ui/enhancements.js';
import { initMobileOverflowMenu } from './ui/mobile-overflow-menu.js';

// ========== UI Layer (Deferred — 非首屏，动态加载) ==========
// settings, viewer, prefill, config-helpers, custom-headers,
// session-search, mcp-settings, tool-manager, quick-messages-ui,
// tools-quick-selector, update-modal, export-import
// → 改为 init() 中延迟动态 import

// ========== Performance & Memory ==========
import { memoryManager } from './utils/memory-manager.js';

/**
 * 初始化应用
 */
async function init() {
    console.log('🚀 Initializing Web Chat...');
    console.log('📦 Module system: ES6 Modules');
    console.log('🏗️  Architecture: 6-layer modular design');

    // 初始化 Eruda 移动端调试工具（仅 Android 平台）
    if (window.Capacitor && window.Capacitor.getPlatform() === 'android') {
        await loadEruda();
    }

    // 初始化 Electron 自定义标题栏（仅桌面端）
    initElectronTitlebar();

    try {
        // 0. 检查存储可用性（处理跟踪保护）
        console.log('🔍 Step 0/10: Checking storage availability...');
        const hasIndexedDB = isIndexedDBAvailable();
        const hasLocalStorage = isLocalStorageAvailable();

        if (!hasIndexedDB && !hasLocalStorage) {
            // ❌ 两种存储都不可用（严格跟踪保护模式）
            throw new Error(
                '存储功能被浏览器跟踪保护阻止\n\n' +
                '请尝试以下操作：\n' +
                '1. 关闭浏览器的严格跟踪保护（Safari: 设置 → 隐私 → 防止跨网站跟踪）\n' +
                '2. 将本站点添加到跟踪保护白名单\n' +
                '3. 使用其他浏览器（Chrome, Edge, Firefox）'
            );
        }

        if (!hasIndexedDB && hasLocalStorage) {
            console.warn('⚠️ IndexedDB 被阻止，将使用 localStorage 降级模式');
            state.storageMode = 'localStorage';
        }

        // 1. 初始化 DOM 元素引用（必须最先执行）
        console.log('📍 Step 1/10: Initializing DOM elements...');
        initElements();

        // 1. 配置 Marked.js（代码高亮）
        if (typeof marked !== 'undefined') {
            // 自定义链接渲染器：外部链接在新标签页打开
            const renderer = new marked.Renderer();
            renderer.link = function({ href, title, text }) {
                const titleAttr = title ? ` title="${title}"` : '';
                // 判断是否为外部链接（http/https 开头）
                if (href && /^https?:\/\//i.test(href)) {
                    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
                }
                // 内部链接或其他协议，正常渲染
                return `<a href="${href}"${titleAttr}>${text}</a>`;
            };

            marked.setOptions({
                breaks: true,
                gfm: true,
                renderer: renderer,
                highlight: function(code, lang) {
                    if (typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
                        return hljs.highlight(code, { language: lang }).value;
                    }
                    return code;
                }
            });
            console.log('Marked.js configured with syntax highlighting');
        }

        // 2. 核心层（同步）
        console.log('⚡ Step 1/9: Loading theme...');
        loadTheme();

        // 3. 存储层
        console.log('💾 Step 2/9: Initializing IndexedDB...');
        let dbReady = false;
        try {
            const dbInstance = await initDB();
            if (dbInstance) {
                dbReady = true;
            } else {
                console.warn('IndexedDB 初始化返回空实例，启用 localStorage 降级模式');
                state.storageMode = 'localStorage';
            }
        } catch (error) {
            console.error('IndexedDB 初始化失败，启用 localStorage 降级模式:', error);
            state.storageMode = 'localStorage';
            eventBus.emit('ui:notification', {
                message: 'IndexedDB 不可用，数据将保存到 localStorage',
                type: 'warning',
                duration: 5000
            });
        }

        // 3.4. v4 消息分离存储迁移（将 session 中嵌入的消息提取到独立 store）
        if (dbReady) {
            try {
                const v4Count = await migrateSessionsToV4();
                if (v4Count > 0) console.log(`[v4] 迁移完成: ${v4Count} 个会话`);
            } catch (e) {
                console.error('[v4] 消息分离迁移失败:', e);
            }
        }

        // 3.5. 迁移检查与配置加载并行（迁移已完成时省去串行等待）
        if (state.storageMode !== 'localStorage') {
            const [migrationStatus] = await Promise.all([
                getMigrationStatus(),
                // 乐观并行：多数情况迁移已完成，loadConfig 可以安全并行
                (async () => {
                    console.log('⚙️  Step 3/9: Loading configuration...');
                    await loadConfig();
                })()
            ]);

            if (migrationStatus !== MIGRATION_STATES.COMPLETED) {
                console.log(`迁移状态: ${migrationStatus}，执行迁移...`);
                try {
                    acquireMigrationLock();
                } catch (lockError) {
                    console.warn('迁移锁获取失败:', lockError.message);
                }
                if (localStorage.getItem('migration_lock')) {
                    try {
                        await executeMigration();
                        // 迁移完成后重新加载配置（覆盖乐观加载的结果）
                        await loadConfig();
                    } catch (migrationError) {
                        console.error('迁移失败:', migrationError);
                    } finally {
                        releaseMigrationLock();
                    }
                }
            }
        } else {
            console.log('⚙️  Step 3/9: Loading configuration...');
            await loadConfig();
        }

        // 迁移旧配置到提供商系统 (如果需要)
        console.log('🔄 Step 4/9: Migrating to provider system...');
        migrateFromLegacyConfig();

        // 并行加载会话、快捷消息、MCP 配置（三者互不依赖，都只依赖 IndexedDB）
        console.log('📚 Step 5/9: Loading sessions, quick messages, MCP config (parallel)...');

        const loadMCPConfig = async () => {
            if (state.storageMode !== 'localStorage') {
                try {
                    const migratedCount = await migrateMCPServersFromLocalStorage();
                    if (migratedCount > 0) {
                        console.log(`[Main] 迁移 ${migratedCount} 个 MCP 服务器`);
                    }
                    state.mcpServers = await loadAllMCPServers();
                    console.log(`[Main] 加载 ${state.mcpServers.length} 个 MCP 服务器`);
                } catch (error) {
                    console.error('[Main] 加载 MCP 配置失败:', error);
                    try {
                        const saved = localStorage.getItem('mcpServers');
                        if (saved) {
                            state.mcpServers = JSON.parse(saved);
                            console.log(`[Main] 从 localStorage 加载 ${state.mcpServers.length} 个 MCP 服务器`);
                        }
                    } catch (fallbackError) {
                        console.error('[Main] 从 localStorage 加载失败:', fallbackError);
                    }
                }
            } else {
                try {
                    const saved = localStorage.getItem('mcpServers');
                    if (saved) {
                        state.mcpServers = JSON.parse(saved);
                        console.log(`[Main] 从 localStorage 加载 ${state.mcpServers.length} 个 MCP 服务器`);
                    }
                } catch (error) {
                    console.error('[Main] 从 localStorage 加载 MCP 配置失败:', error);
                }
            }
        };

        await Promise.all([
            loadSessions(),
            initQuickMessages(),
            loadMCPConfig()
        ]);

        // 会话消息已渲染，移除骨架屏
        const skeleton = document.getElementById('app-skeleton');
        if (skeleton) skeleton.remove();

        // 4. API 层
        console.log('🌐 Step 6/9: Initializing API handler...');
        initAPIHandler();
        initReplySelector();

        // 5. UI 层（同步，绑定事件）
        // ⭐ Step 7.5/9: 初始化工具系统
        console.log('🔧 Step 7.5/9: Initializing tools system...');
        initTools();

        // 监听工具执行状态变化，保存结果到消息历史
        eventBus.on('tool:status:changed', ({ toolId, status, result }) => {
            if (status === 'completed' || status === 'failed') {
                import('./messages/sync.js').then(({ updateToolCallResult }) => {
                    updateToolCallResult(toolId, status, result);
                });
            }
        });

        console.log('🖱️  Step 8/9: Initializing UI handlers...');

        // 首屏关键 UI（同步，用户立即需要交互）
        initTheming();
        initKeyboard();
        initPasswordToggles();
        initRippleEffects();
        initInputHandlers();
        initClearChat();
        initModels();
        initFormatSwitcher();
        initQuickToggles();
        exposeToggleFunctions();
        initSidebar();
        initScrollControl();
        initMobileOverflowMenu();

        // 需要 await 的调整尺寸操作
        await Promise.all([
            initInputResize(),
            initPanelResize()
        ]);

        // 非首屏 UI（延迟动态加载，不阻塞首次交互）
        requestIdleCallback(async () => {
            const [
                { initSettings },
                { initImageViewer },
                { initEndpointInputListeners, initThinkingControls, initConfigManagement, initOtherConfigInputs },
                { initPrefillControls, initSystemPrefillControls, initGeminiSystemParts },
                { initCustomHeaders },
                { initQuickMessagesUI },
                { initSessionSearch },
                { initMCPSettings },
                { initToolManager },
                { initToolsQuickSelector },
                { initUpdateModal },
                { initExportImport },
                { initProvidersUI }
            ] = await Promise.all([
                import('./ui/settings.js'),
                import('./ui/viewer.js'),
                import('./ui/config-helpers.js'),
                import('./ui/prefill.js'),
                import('./ui/enhancements.js'),
                import('./ui/quick-messages.js'),
                import('./ui/session-search.js'),
                import('./ui/mcp-settings.js'),
                import('./ui/tool-manager.js'),
                import('./ui/tools-quick-selector.js'),
                import('./update/update-modal.js'),
                import('./state/export-import.js'),
                import('./providers/ui.js')
            ]);

            initSettings();
            initImageViewer();
            initEndpointInputListeners();
            initThinkingControls();
            initConfigManagement();
            initOtherConfigInputs();
            initPrefillControls();
            initSystemPrefillControls();
            initGeminiSystemParts();
            initCustomHeaders();
            initQuickMessagesUI();
            initSessionSearch();
            initProvidersUI();
            initMCPSettings();
            initToolManager();
            initToolsQuickSelector();
            initUpdateModal();
            initExportImport();

            // MCP 增强
            import('./ui/tool-manager-mcp-enhancements.js').then(({ initToolManagerMCPEnhancements }) => {
                initToolManagerMCPEnhancements();
            });
            import('./ui/tools-quick-selector-enhancements.js').then(({ initQuickSelectorEnhancements }) => {
                initQuickSelectorEnhancements();
            });

            // OpenClaw 模块（审批、屏幕截图、定时任务）
            import('./ui/openclaw-approval.js').then(({ initOpenClawApproval }) => {
                initOpenClawApproval();
            });
            import('./ui/openclaw-screen.js').then(({ initOpenClawScreen }) => {
                initOpenClawScreen();
            });
            import('./ui/openclaw-cron.js').then(({ initOpenClawCron }) => {
                initOpenClawCron();
            });

            // APK 更新（仅 Android）
            if (window.Capacitor && window.Capacitor.getPlatform() === 'android') {
                const { initAPKUpdater } = await import('./update/apk-updater.js');
                initAPKUpdater();
            }
        }, { timeout: 1000 });

        // 会话恢复已由 loadSessions() 处理（Line 183）
        // loadSessions() 中已包含：
        //   - 加载 currentSessionId（IndexedDB 优先）
        //   - switchToSession(currentId) 或 switchToSession(sessions[0].id)
        // 无需在此重复恢复

        // 6. 恢复侧边栏状态
        console.log('📂 Step 9/9: Restoring sidebar state...');
        // 从 IndexedDB 恢复侧边栏状态
        try {
            let savedSidebarState = null;
            if (state.storageMode !== 'localStorage') {
                savedSidebarState = await loadPreference('sidebarOpen');
            }
            // 降级：从 localStorage 读取
            if (savedSidebarState === null || savedSidebarState === undefined) {
                savedSidebarState = localStorage.getItem('sidebarOpen');
            }

            const shouldOpenSidebar = savedSidebarState === true || savedSidebarState === 'true';
            if (shouldOpenSidebar && elements.sidebar && !elements.sidebar.classList.contains('open')) {
                setTimeout(() => {
                    import('./ui/sidebar.js').then(({ toggleSidebar }) => {
                        toggleSidebar(true); // skipSave = true, 避免循环
                    });
                }, 100);
            }
        } catch (error) {
            console.error('恢复侧边栏状态失败:', error);
            // 降级处理
            const savedSidebarState = localStorage.getItem('sidebarOpen');
            const shouldOpenSidebar = savedSidebarState === true || savedSidebarState === 'true';
            if (shouldOpenSidebar && elements.sidebar && !elements.sidebar.classList.contains('open')) {
                setTimeout(() => {
                    import('./ui/sidebar.js').then(({ toggleSidebar }) => {
                        toggleSidebar(true);
                    });
                }, 100);
            }
        }

        console.log('Web Chat initialized successfully!');
        console.log(`📊 Modules loaded: ${Object.keys(import.meta).length}`);
        console.log(`💬 Sessions: ${state.sessions.length}`);
        console.log(`🎨 Theme: ${document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light'}`);
        console.log(`🔌 API Format: ${state.apiFormat}`);

        // 7. 延迟执行非关键任务
        // 请求持久化存储（不影响功能，延迟执行）
        if (dbReady) {
            import('./state/storage.js').then(({ requestPersistentStorage }) => {
                requestPersistentStorage();
            });
        }

        // 自动连接 MCP 服务器
        import('./ui/mcp-auto-connect.js').then(({ initMCPAutoConnect }) => {
            initMCPAutoConnect(1000);
        });

        // 添加页面关闭前保存配置
        window.addEventListener('beforeunload', () => {
            saveCurrentConfigImmediate();
        });

        // 添加页面visibility变化时保存配置（移动端）
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                saveCurrentConfigImmediate();
            }
        });

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// 启动应用
init().catch(error => {
    console.error('Fatal error during initialization:', error);
    document.body.innerHTML = `
        <div style="padding: 20px; color: red; font-family: monospace;">
            <h1>[!] Initialization Error</h1>
            <p><strong>Message:</strong> ${error.message}</p>
            <pre>${error.stack}</pre>
            <p>Please check the console for more details.</p>
        </div>
    `;
});
