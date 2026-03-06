/**
 * IndexedDB 存储管理
 * 处理会话数据的持久化
 */

import { eventBus } from '../core/events.js';

// IndexedDB 配置
const DB_NAME = 'GeminiChatDB';
const DB_VERSION = 3;  // 升级到版本 3（添加 MCP 服务器存储）
const STORE_NAME = 'sessions';

// 新增：对象存储名称常量
const STORES = {
    SESSIONS: 'sessions',
    CONFIG: 'config',
    PREFERENCES: 'preferences',
    QUICK_MESSAGES: 'quickMessages',
    MCP_SERVERS: 'mcpServers'  // 版本 3 新增
};

let db = null;

/**
 * 检测 IndexedDB 是否可用
 * 增强版：实际测试访问权限（处理跟踪保护）
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
    try {
        // 基础检查
        if (!('indexedDB' in window) || indexedDB === null) {
            return false;
        }

        // 实际测试访问（处理 Safari/Firefox 跟踪保护）
        // 尝试打开一个测试数据库
        const testRequest = indexedDB.open('test-db-availability');

        // 如果能创建请求对象，说明有访问权限
        if (testRequest) {
            // 立即关闭和删除测试数据库
            testRequest.onsuccess = () => {
                testRequest.result.close();
                indexedDB.deleteDatabase('test-db-availability');
            };
            testRequest.onerror = () => {
                // 静默处理错误
            };
            return true;
        }
        return false;
    } catch (e) {
        // SecurityError, QuotaExceededError 等都会被捕获
        console.warn('IndexedDB 不可用（可能被跟踪保护阻止）:', e.name);
        return false;
    }
}

/**
 * 检测 localStorage 是否可用
 * 处理跟踪保护阻止 localStorage 的情况
 * @returns {boolean}
 */
export function isLocalStorageAvailable() {
    try {
        const testKey = '__ls_test__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
        return true;
    } catch (e) {
        console.warn('localStorage 不可用（可能被跟踪保护阻止）:', e.name);
        return false;
    }
}

/**
 * 安全的 localStorage 读取（处理跟踪保护）
 * @param {string} key - 键名
 * @returns {string|null} 值或null
 */
export function safeLocalStorageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn(`localStorage.getItem('${key}') 失败:`, e.name);
        return null;
    }
}

/**
 * 安全的 localStorage 写入（处理跟踪保护）
 * @param {string} key - 键名
 * @param {string} value - 值
 * @returns {boolean} 是否成功
 */
export function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn(`localStorage.setItem('${key}') 失败:`, e.name);
        return false;
    }
}

/**
 * 请求持久化存储（避免数据被清理）
 * 适用于 Electron, Android, iOS 等环境
 * @returns {Promise<boolean>} 是否成功获取持久化权限
 */
export async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const isPersisted = await navigator.storage.persist();
            if (isPersisted) {
                console.log('已获取持久化存储权限（数据不会被自动清理）');
            } else {
                console.warn('⚠️ 持久化存储权限被拒绝（Android/iOS 可能在 7 天后清理数据）');
                console.log('💡 提示：定期访问应用可防止数据被清理');
            }
            return isPersisted;
        } catch (error) {
            console.error('请求持久化存储失败:', error);
            return false;
        }
    } else {
        console.log('ℹ️ 当前环境不支持持久化存储 API（可能是旧版浏览器）');
        return false;
    }
}

/**
 * 检查当前存储是否已持久化
 * @returns {Promise<boolean>} 是否已持久化
 */
export async function checkPersistentStorage() {
    if (navigator.storage && navigator.storage.persisted) {
        try {
            const isPersisted = await navigator.storage.persisted();
            return isPersisted;
        } catch (error) {
            console.error('检查持久化状态失败:', error);
            return false;
        }
    }
    return false;
}

/**
 * 初始化 IndexedDB
 * @returns {Promise<IDBDatabase|null>} 数据库实例，失败时返回 null
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        // 增强降级处理：检测 IndexedDB 可用性
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB 不可用，将使用 localStorage 降级模式');
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB 打开失败:', request.error);
            // 降级处理：不抛出错误，返回 null
            console.warn('IndexedDB 初始化失败，将使用 localStorage 降级模式');
            resolve(null);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log(`IndexedDB 初始化成功（版本 ${DB_VERSION}）`);
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            const oldVersion = event.oldVersion;
            const newVersion = event.newVersion;

            console.log(`升级 IndexedDB: v${oldVersion} → v${newVersion}`);

            // 版本 1: 创建会话存储
            if (oldVersion < 1) {
                if (!database.objectStoreNames.contains(STORES.SESSIONS)) {
                    const store = database.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    console.log('创建对象存储: sessions');
                }
            }

            // 版本 2: 创建配置、偏好设置、快捷消息存储
            if (oldVersion < 2) {
                // 创建配置存储
                if (!database.objectStoreNames.contains(STORES.CONFIG)) {
                    database.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
                    console.log('创建对象存储: config');
                }

                // 创建偏好设置存储
                if (!database.objectStoreNames.contains(STORES.PREFERENCES)) {
                    database.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' });
                    console.log('创建对象存储: preferences');
                }

                // 创建快捷消息存储
                if (!database.objectStoreNames.contains(STORES.QUICK_MESSAGES)) {
                    const qmStore = database.createObjectStore(STORES.QUICK_MESSAGES, { keyPath: 'id' });
                    qmStore.createIndex('category', 'category', { unique: false });
                    qmStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    console.log('创建对象存储: quickMessages');
                }
            }

            // 版本 3: 创建 MCP 服务器存储
            if (oldVersion < 3) {
                if (!database.objectStoreNames.contains(STORES.MCP_SERVERS)) {
                    const mcpStore = database.createObjectStore(STORES.MCP_SERVERS, { keyPath: 'id' });
                    mcpStore.createIndex('type', 'type', { unique: false });
                    mcpStore.createIndex('enabled', 'enabled', { unique: false });
                    mcpStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    console.log('创建对象存储: mcpServers');
                }
            }
        };
    });
}

/**
 * 保存单个会话到 IndexedDB
 * @param {Object} session - 会话对象
 * @returns {Promise<void>}
 */
export function saveSessionToDB(session) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(session);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            const error = request.error;
            console.error('保存会话失败:', error);

            // 检测存储配额超出错误
            if (error && (error.name === 'QuotaExceededError' ||
                         error.message?.includes('quota') ||
                         error.message?.includes('storage'))) {
                // 发出事件让 UI 层显示通知
                eventBus.emit('storage:quota-exceeded', {
                    message: '存储空间不足！请清理一些旧会话或浏览器数据'
                });
            }
            reject(error);
        };

        // 监听事务错误（某些浏览器在事务级别报告配额错误）
        transaction.onerror = (event) => {
            const error = event.target.error;
            if (error && (error.name === 'QuotaExceededError' ||
                         error.message?.includes('quota'))) {
                eventBus.emit('storage:quota-exceeded', {
                    message: '存储空间不足！请清理一些旧会话或浏览器数据'
                });
            }
        };
    });
}

/**
 * 从 IndexedDB 加载所有会话
 * @returns {Promise<Array>} 会话数组
 */
export function loadAllSessionsFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            // 按更新时间排序，最新的在前
            const sessions = request.result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            resolve(sessions);
        };
        request.onerror = () => {
            console.error('加载会话失败:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 从 IndexedDB 删除会话
 * @param {string} sessionId - 会话 ID
 * @returns {Promise<void>}
 */
export function deleteSessionFromDB(sessionId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(sessionId);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('删除会话失败:', request.error);
            reject(request.error);
        };
    });
}

/**
 * 从 localStorage 迁移数据到 IndexedDB
 * @returns {Promise<Array|null>} 迁移的会话数组或 null
 */
export async function migrateFromLocalStorage() {
    const saved = localStorage.getItem('geminiChatSessions');
    if (saved) {
        try {
            const sessions = JSON.parse(saved);
            console.log(`正在迁移 ${sessions.length} 个会话到 IndexedDB...`);

            for (const session of sessions) {
                await saveSessionToDB(session);
            }

            // 迁移成功后删除 localStorage 数据
            localStorage.removeItem('geminiChatSessions');
            console.log('迁移完成，已清除 localStorage 中的旧数据');

            return sessions;
        } catch (e) {
            console.error('迁移失败:', e);
        }
    }
    return null;
}

/**
 * 获取数据库实例（用于高级操作）
 * @returns {IDBDatabase|null}
 */
export function getDB() {
    return db;
}

// ========== 通用存储 API ==========

/**
 * 通用保存函数（带配额检测）
 * @param {string} storeName - 对象存储名称
 * @param {string} key - 键
 * @param {any} value - 值
 * @returns {Promise<void>}
 */
export async function saveToStore(storeName, key, value) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const data = { key, value, updatedAt: Date.now() };
            const request = store.put(data);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                const error = request.error;
                console.error(`保存到 ${storeName} 失败:`, error);

                // 配额检测
                if (error && (error.name === 'QuotaExceededError' ||
                             error.message?.includes('quota') ||
                             error.message?.includes('storage'))) {
                    eventBus.emit('storage:quota-exceeded', {
                        message: `IndexedDB 存储空间不足（${storeName}）`
                    });
                }
                reject(error);
            };

            transaction.onerror = (event) => {
                const error = event.target.error;
                if (error && (error.name === 'QuotaExceededError' ||
                             error.message?.includes('quota'))) {
                    eventBus.emit('storage:quota-exceeded', {
                        message: `IndexedDB 存储空间不足（${storeName}）`
                    });
                }
            };
        } catch (error) {
            console.error(`保存到 ${storeName} 异常:`, error);
            reject(error);
        }
    });
}

/**
 * 通用加载函数
 * @param {string} storeName - 对象存储名称
 * @param {string} key - 键
 * @returns {Promise<any|null>} 值，不存在时返回 null
 */
export async function loadFromStore(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : null);
            };
            request.onerror = () => {
                console.error(`从 ${storeName} 加载失败:`, request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error(`从 ${storeName} 加载异常:`, error);
            reject(error);
        }
    });
}

/**
 * 通用删除函数
 * @param {string} storeName - 对象存储名称
 * @param {string} key - 键
 * @returns {Promise<void>}
 */
export async function deleteFromStore(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.error(`从 ${storeName} 删除失败:`, request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error(`从 ${storeName} 删除异常:`, error);
            reject(error);
        }
    });
}

/**
 * 加载对象存储中的所有数据
 * @param {string} storeName - 对象存储名称
 * @returns {Promise<Array>} 所有数据
 */
export async function loadAllFromStore(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };
            request.onerror = () => {
                console.error(`从 ${storeName} 加载所有数据失败:`, request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error(`从 ${storeName} 加载所有数据异常:`, error);
            reject(error);
        }
    });
}

// ========== 配置存储 API ==========

/**
 * 保存当前配置
 * @param {Object} config - 配置对象
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
    return saveToStore(STORES.CONFIG, 'current', config);
}

/**
 * 加载当前配置
 * @returns {Promise<Object|null>} 配置对象
 */
export async function loadConfig() {
    return loadFromStore(STORES.CONFIG, 'current');
}

/**
 * 保存已保存的配置列表
 * @param {Array} configs - 配置数组
 * @returns {Promise<void>}
 */
export async function saveSavedConfigs(configs) {
    return saveToStore(STORES.CONFIG, 'saved_configs', configs);
}

/**
 * 加载已保存的配置列表
 * @returns {Promise<Array|null>} 配置数组
 */
export async function loadSavedConfigs() {
    return loadFromStore(STORES.CONFIG, 'saved_configs');
}

// ========== 偏好设置存储 API ==========

/**
 * 保存偏好设置
 * @param {string} key - 偏好设置键
 * @param {any} value - 偏好设置值
 * @returns {Promise<void>}
 */
export async function savePreference(key, value) {
    const fallbackValue = typeof value === 'string' ? value : JSON.stringify(value);

    // IndexedDB 不可用时，降级到 localStorage
    if (!db) {
        if (!safeLocalStorageSet(key, fallbackValue)) {
            throw new Error(`保存偏好设置失败（localStorage 不可用）: ${key}`);
        }
        return;
    }

    try {
        await saveToStore(STORES.PREFERENCES, key, value);
    } catch (error) {
        console.warn(`[Storage] savePreference("${key}") 写入 IndexedDB 失败，降级到 localStorage:`, error);
        if (!safeLocalStorageSet(key, fallbackValue)) {
            throw error;
        }
    }
}

/**
 * 加载偏好设置
 * @param {string} key - 偏好设置键
 * @returns {Promise<any|null>} 偏好设置值
 */
export async function loadPreference(key) {
    // IndexedDB 不可用时，直接从 localStorage 读取
    if (!db) {
        return safeLocalStorageGet(key);
    }

    try {
        const value = await loadFromStore(STORES.PREFERENCES, key);
        // 兼容历史数据：IndexedDB 没有时尝试 localStorage
        if (value === null || value === undefined) {
            return safeLocalStorageGet(key);
        }
        return value;
    } catch (error) {
        console.warn(`[Storage] loadPreference("${key}") 读取 IndexedDB 失败，降级到 localStorage:`, error);
        return safeLocalStorageGet(key);
    }
}

/**
 * 加载所有偏好设置
 * @returns {Promise<Object>} 偏好设置对象
 */
export async function loadAllPreferences() {
    const items = await loadAllFromStore(STORES.PREFERENCES);
    const prefs = {};
    items.forEach(item => {
        prefs[item.key] = item.value;
    });
    return prefs;
}

// ========== 快捷消息存储 API ==========

/**
 * 保存快捷消息
 * @param {Object} message - 快捷消息对象
 * @returns {Promise<void>}
 */
export async function saveQuickMessage(message) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.QUICK_MESSAGES], 'readwrite');
            const store = transaction.objectStore(STORES.QUICK_MESSAGES);
            const request = store.put(message);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.error('保存快捷消息失败:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('保存快捷消息异常:', error);
            reject(error);
        }
    });
}

/**
 * 加载所有快捷消息
 * @returns {Promise<Array>} 快捷消息数组
 */
export async function loadAllQuickMessages() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.QUICK_MESSAGES], 'readonly');
            const store = transaction.objectStore(STORES.QUICK_MESSAGES);
            const request = store.getAll();

            request.onsuccess = () => {
                const messages = request.result || [];
                // 按更新时间排序
                messages.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                resolve(messages);
            };
            request.onerror = () => {
                console.error('加载快捷消息失败:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('加载快捷消息异常:', error);
            reject(error);
        }
    });
}

/**
 * 删除快捷消息
 * @param {string} id - 快捷消息 ID
 * @returns {Promise<void>}
 */
export async function deleteQuickMessage(id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.QUICK_MESSAGES], 'readwrite');
            const store = transaction.objectStore(STORES.QUICK_MESSAGES);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.error('删除快捷消息失败:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('删除快捷消息异常:', error);
            reject(error);
        }
    });
}

// ========================================
// MCP 服务器存储 API（版本 3 新增）
// ========================================

/**
 * 保存单个 MCP 服务器到 IndexedDB
 * @param {Object} server - MCP 服务器对象
 * @returns {Promise<void>}
 */
export async function saveMCPServer(server) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        const serverData = { ...server, updatedAt: Date.now() };

        try {
            const transaction = db.transaction([STORES.MCP_SERVERS], 'readwrite');
            const store = transaction.objectStore(STORES.MCP_SERVERS);
            const request = store.put(serverData);

            // 监听请求成功
            request.onsuccess = () => {
                console.log(`[Storage] 保存 MCP 服务器: ${server.id}`);
                resolve();
            };

            // 监听请求错误
            request.onerror = () => {
                console.error('[Storage] ❌ 保存 MCP 服务器失败:', request.error);
                reject(request.error);
            };

            // 监听事务错误（事务级别的错误）
            transaction.onerror = () => {
                console.error('[Storage] ❌ 事务错误:', transaction.error);
                reject(transaction.error);
            };

            // 监听事务中止
            transaction.onabort = () => {
                console.error('[Storage] ❌ 事务被中止');
                reject(new Error('事务被中止'));
            };
        } catch (error) {
            console.error('[Storage] ❌ 保存 MCP 服务器异常:', error);
            reject(error);
        }
    });
}

/**
 * 从 IndexedDB 加载所有 MCP 服务器
 * @returns {Promise<Array>} MCP 服务器数组
 */
export async function loadAllMCPServers() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.MCP_SERVERS], 'readonly');
            const store = transaction.objectStore(STORES.MCP_SERVERS);
            const request = store.getAll();

            request.onsuccess = () => {
                // 按更新时间排序，最新的在前
                const servers = request.result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                console.log(`[Storage] 加载 ${servers.length} 个 MCP 服务器`);
                resolve(servers);
            };
            request.onerror = () => {
                console.error('[Storage] ❌ 加载 MCP 服务器失败:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('[Storage] ❌ 加载 MCP 服务器异常:', error);
            reject(error);
        }
    });
}

/**
 * 从 IndexedDB 加载单个 MCP 服务器
 * @param {string} serverId - 服务器 ID
 * @returns {Promise<Object|null>} MCP 服务器对象或 null
 */
export async function loadMCPServer(serverId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.MCP_SERVERS], 'readonly');
            const store = transaction.objectStore(STORES.MCP_SERVERS);
            const request = store.get(serverId);

            request.onsuccess = () => {
                resolve(request.result || null);
            };
            request.onerror = () => {
                console.error('[Storage] ❌ 加载 MCP 服务器失败:', request.error);
                reject(request.error);
            };
        } catch (error) {
            console.error('[Storage] ❌ 加载 MCP 服务器异常:', error);
            reject(error);
        }
    });
}

/**
 * 从 IndexedDB 删除 MCP 服务器
 * @param {string} serverId - 服务器 ID
 * @returns {Promise<void>}
 */
export async function deleteMCPServer(serverId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.MCP_SERVERS], 'readwrite');
            const store = transaction.objectStore(STORES.MCP_SERVERS);
            const request = store.delete(serverId);

            request.onsuccess = () => {
                console.log(`[Storage] 删除 MCP 服务器: ${serverId}`);
                resolve();
            };
            request.onerror = () => {
                console.error('[Storage] ❌ 删除 MCP 服务器失败:', request.error);
                reject(request.error);
            };

            // 监听事务错误
            transaction.onerror = () => {
                console.error('[Storage] ❌ 事务错误:', transaction.error);
                reject(transaction.error);
            };

            // 监听事务中止
            transaction.onabort = () => {
                console.error('[Storage] ❌ 事务被中止');
                reject(new Error('事务被中止'));
            };
        } catch (error) {
            console.error('[Storage] ❌ 删除 MCP 服务器异常:', error);
            reject(error);
        }
    });
}

/**
 * 批量保存 MCP 服务器到 IndexedDB
 * @param {Array} servers - MCP 服务器数组
 * @returns {Promise<void>}
 */
export async function saveAllMCPServers(servers) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('数据库未初始化'));
            return;
        }

        try {
            const transaction = db.transaction([STORES.MCP_SERVERS], 'readwrite');
            const store = transaction.objectStore(STORES.MCP_SERVERS);

            // 批量写入
            servers.forEach(server => {
                const serverData = { ...server, updatedAt: Date.now() };
                store.put(serverData);
            });

            transaction.oncomplete = () => {
                console.log(`[Storage] 批量保存 ${servers.length} 个 MCP 服务器`);
                resolve();
            };
            transaction.onerror = () => {
                console.error('[Storage] ❌ 批量保存 MCP 服务器失败:', transaction.error);
                reject(transaction.error);
            };
        } catch (error) {
            console.error('[Storage] ❌ 批量保存 MCP 服务器异常:', error);
            reject(error);
        }
    });
}

/**
 * 从 localStorage 迁移 MCP 服务器到 IndexedDB（一次性操作）
 * @returns {Promise<number>} 迁移的服务器数量
 */
export async function migrateMCPServersFromLocalStorage() {
    const MIGRATION_LOCK_KEY = 'mcpMigrationLock';
    const MIGRATION_COMPLETE_KEY = 'mcpMigrationComplete';

    // 检查是否已完成迁移
    if (localStorage.getItem(MIGRATION_COMPLETE_KEY) === 'true') {
        console.log('[Storage] 🔄 MCP 服务器迁移已完成，跳过');
        return 0;
    }

    // 防止多标签页同时迁移
    const lock = localStorage.getItem(MIGRATION_LOCK_KEY);
    if (lock) {
        const lockTime = parseInt(lock, 10);
        const now = Date.now();
        // 如果锁超过30秒，认为是死锁，清除
        if (now - lockTime < 30000) {
            console.log('[Storage] 🔄 其他标签页正在迁移，跳过');
            return 0;
        } else {
            console.warn('[Storage] ⚠️ 检测到迁移死锁，清除锁');
            localStorage.removeItem(MIGRATION_LOCK_KEY);
        }
    }

    // 检查是否有需要迁移的数据
    const saved = localStorage.getItem('mcpServers');
    if (!saved) {
        console.log('[Storage] 🔄 没有需要迁移的 MCP 服务器数据');
        localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');
        return 0;
    }

    // 设置迁移锁
    localStorage.setItem(MIGRATION_LOCK_KEY, Date.now().toString());

    try {
        const servers = JSON.parse(saved);

        if (!Array.isArray(servers) || servers.length === 0) {
            console.log('[Storage] 🔄 MCP 服务器数据为空，无需迁移');
            localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');
            localStorage.removeItem(MIGRATION_LOCK_KEY);
            return 0;
        }

        // 执行迁移
        await saveAllMCPServers(servers);

        // 迁移成功后删除 localStorage 数据
        localStorage.removeItem('mcpServers');
        localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');
        localStorage.removeItem(MIGRATION_LOCK_KEY);

        console.log(`[Storage] 成功迁移 ${servers.length} 个 MCP 服务器到 IndexedDB`);
        return servers.length;

    } catch (error) {
        // 迁移失败，保留原数据，移除锁
        localStorage.removeItem(MIGRATION_LOCK_KEY);
        console.error('[Storage] ❌ MCP 服务器迁移失败（原数据已保留）:', error);
        throw error;
    }
}

/**
 * 更新 MCP 服务器
 * @param {string} serverId - 服务器 ID
 * @param {Object} updates - 更新的字段
 * @returns {Promise<void>}
 */
export async function updateMCPServer(serverId, updates) {
    if (!db) {
        throw new Error('数据库未初始化');
    }

    // 先加载现有服务器
    const existingServer = await loadMCPServer(serverId);
    if (!existingServer) {
        throw new Error(`MCP 服务器不存在: ${serverId}`);
    }

    // 合并更新
    const updatedServer = {
        ...existingServer,
        ...updates,
        id: serverId,  // 确保 ID 不变
        updatedAt: Date.now()
    };

    // 保存更新后的服务器
    await saveMCPServer(updatedServer);
    console.log(`[Storage] 更新 MCP 服务器: ${serverId}`);
}
