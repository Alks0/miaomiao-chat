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
import { initDB, loadPreference, isIndexedDBAvailable, isLocalStorageAvailable, migrateMCPServersFromLocalStorage, loadAllMCPServers } from './state/storage.js';
import { loadConfig, saveCurrentConfigImmediate } from './state/config.js';
import { loadSessions, switchToSession } from './state/sessions.js';
import { initExportImport } from './state/export-import.js';
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
import { initProvidersUI } from './providers/ui.js';

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

// ========== UI Layer (Interactive) ==========
import { initInputHandlers } from './ui/input.js';
import { initSidebar } from './ui/sidebar.js';
import { initSettings } from './ui/settings.js';
import { initImageViewer } from './ui/viewer.js';
import { initScrollControl } from './ui/scroll.js';
import { initClearChat } from './ui/clear.js';
import { initModels } from './ui/models.js';
import { initFormatSwitcher } from './ui/format-switcher.js';
import { initKeyboard } from './ui/keyboard.js';
import { initQuickToggles, exposeToggleFunctions } from './ui/quick-toggles.js';
import { initEndpointInputListeners, initThinkingControls, initConfigManagement, initOtherConfigInputs } from './ui/config-helpers.js';
import { initInputResize, initPanelResize } from './ui/resize.js';
import { initPrefillControls, initSystemPrefillControls, initGeminiSystemParts } from './ui/prefill.js';
import { initPasswordToggles, initCustomHeaders, initRippleEffects } from './ui/enhancements.js';
import { initQuickMessagesUI } from './ui/quick-messages.js';
import { initSessionSearch } from './ui/session-search.js';
import { initMCPSettings } from './ui/mcp-settings.js';
import { initToolManager } from './ui/tool-manager.js';
import { initToolsQuickSelector } from './ui/tools-quick-selector.js';

// ========== Update Layer ==========
import { initUpdateModal } from './update/update-modal.js';

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
            marked.setOptions({
                breaks: true,
                gfm: true,
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

        // 3. 存储层（异步，按顺序）
        console.log('💾 Step 2/9: Initializing IndexedDB...');
        // 增强错误处理：IndexedDB 失败时启用降级模式
        try {
            const dbInstance = await initDB();

            // 请求持久化存储（防止 Android/iOS 自动清理）
            if (dbInstance) {
                const { requestPersistentStorage } = await import('./state/storage.js');
                await requestPersistentStorage();
            } else {
                console.warn('IndexedDB 初始化返回空实例，启用 localStorage 降级模式');
                state.storageMode = 'localStorage';
            }
        } catch (error) {
            console.error('IndexedDB 初始化失败，启用 localStorage 降级模式:', error);
            state.storageMode = 'localStorage';
            // 显示警告通知（通过 eventBus）
            import('./core/events.js').then(({ eventBus }) => {
                eventBus.emit('ui:notification', {
                    message: 'IndexedDB 不可用，数据将保存到 localStorage',
                    type: 'warning',
                    duration: 5000
                });
            });
        }

        // 3.5. 执行一次性迁移（仅第一次运行或失败时重试）
        if (state.storageMode !== 'localStorage') {
            console.log('🔄 Step 2.5/9: Checking migration status...');
            const migrationStatus = await getMigrationStatus();

            if (migrationStatus !== MIGRATION_STATES.COMPLETED) {
                console.log(`迁移状态: ${migrationStatus}，准备执行迁移...`);

                // 并发保护：检查其他标签页是否正在迁移
                try {
                    acquireMigrationLock();
                } catch (lockError) {
                    console.warn('迁移锁获取失败:', lockError.message);
                    console.log('跳过迁移，使用现有数据');
                    // 不阻塞初始化，继续加载配置
                }

                // 只有成功获取锁时才执行迁移
                if (localStorage.getItem('migration_lock')) {
                    try {
                        console.log('🔄 开始执行数据迁移...');
                        await executeMigration();
                        console.log('迁移完成');
                    } catch (migrationError) {
                        console.error('迁移失败:', migrationError);
                        // 迁移失败不阻塞初始化
                    } finally {
                        releaseMigrationLock();
                    }
                }
            } else {
                console.log('迁移已完成，跳过');
            }
        }

        console.log('⚙️  Step 3/9: Loading configuration...');
        await loadConfig();

        // 迁移旧配置到提供商系统 (如果需要)
        console.log('🔄 Step 4/9: Migrating to provider system...');
        migrateFromLegacyConfig();

        console.log('📚 Step 5/9: Loading sessions...');
        await loadSessions();

        // 加载快捷消息（在配置和会话加载后）
        console.log('💬 Step 5.5/9: Loading quick messages...');
        await initQuickMessages();

        // 加载 MCP 配置（在 IndexedDB 初始化后）
        console.log('🔌 Step 5.6/9: Loading MCP configuration...');
        if (state.storageMode !== 'localStorage') {
            try {
                // 执行迁移（仅首次运行或需要时）
                const migratedCount = await migrateMCPServersFromLocalStorage();
                if (migratedCount > 0) {
                    console.log(`[Main] 迁移 ${migratedCount} 个 MCP 服务器`);
                }

                // 加载 MCP 服务器配置
                state.mcpServers = await loadAllMCPServers();
                console.log(`[Main] 加载 ${state.mcpServers.length} 个 MCP 服务器`);
            } catch (error) {
                console.error('[Main] ❌ 加载 MCP 配置失败:', error);
                // 降级：从 localStorage 读取
                try {
                    const saved = localStorage.getItem('mcpServers');
                    if (saved) {
                        state.mcpServers = JSON.parse(saved);
                        console.log(`[Main] ⚠️ 从 localStorage 加载 ${state.mcpServers.length} 个 MCP 服务器`);
                    }
                } catch (fallbackError) {
                    console.error('[Main] ❌ 从 localStorage 加载失败:', fallbackError);
                }
            }
        } else {
            // 使用 localStorage 模式
            try {
                const saved = localStorage.getItem('mcpServers');
                if (saved) {
                    state.mcpServers = JSON.parse(saved);
                    console.log(`[Main] 从 localStorage 加载 ${state.mcpServers.length} 个 MCP 服务器`);
                }
            } catch (error) {
                console.error('[Main] ❌ 从 localStorage 加载 MCP 配置失败:', error);
            }
        }

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

        // 基础UI
        initTheming();
        initKeyboard();
        initPasswordToggles();
        initRippleEffects();

        // 输入和消息
        initInputHandlers();
        await initInputResize(); // 改为 await（需要从 IndexedDB 加载高度）
        initClearChat();

        // API和配置
        initModels();
        initFormatSwitcher();
        initEndpointInputListeners();
        initThinkingControls();
        initConfigManagement();
        initOtherConfigInputs();

        // 快捷开关
        initQuickToggles();
        exposeToggleFunctions();

        // 面板和侧边栏
        initSidebar();
        initSettings();
        await initPanelResize(); // 改为 await（需要从 IndexedDB 加载宽度）

        // 更新系统
        initUpdateModal();  // Electron 更新

        // APK 更新（仅 Android Capacitor 环境）
        if (window.Capacitor && window.Capacitor.getPlatform() === 'android') {
            const { initAPKUpdater } = await import('./update/apk-updater.js');
            initAPKUpdater();
        }

        // 快捷消息 UI（数据已在 Step 5.5 加载）
        initQuickMessagesUI();

        // 会话搜索
        initSessionSearch();

        // 其他UI
        initImageViewer();
        initScrollControl();
        initProvidersUI();
        initMCPSettings();
        initToolManager();
        initToolsQuickSelector();

        // 初始化工具管理器 MCP 增强
        import('./ui/tool-manager-mcp-enhancements.js').then(({ initToolManagerMCPEnhancements }) => {
            initToolManagerMCPEnhancements();
        });

        // 初始化快速选择器 MCP 增强
        import('./ui/tools-quick-selector-enhancements.js').then(({ initQuickSelectorEnhancements }) => {
            initQuickSelectorEnhancements();
        });

        // 高级功能
        initPrefillControls();
        initSystemPrefillControls();
        initGeminiSystemParts();
        initCustomHeaders();

        // 导入导出
        initExportImport();

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

        // 7. 自动连接 MCP 服务器
        console.log('🔗 Step 10/10: Auto-connecting MCP servers...');
        import('./ui/mcp-auto-connect.js').then(({ initMCPAutoConnect }) => {
            initMCPAutoConnect(1000); // 延迟 1 秒后开始连接，确保 UI 已完全加载
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
