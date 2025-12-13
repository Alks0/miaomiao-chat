/**
 * IndexedDB 存储管理
 * 处理会话数据的持久化
 */

import { eventBus } from '../core/events.js';

// IndexedDB 配置
const DB_NAME = 'GeminiChatDB';
const DB_VERSION = 2;  // ✅ 升级到版本 2
const STORE_NAME = 'sessions';

// ✅ 新增：对象存储名称常量
const STORES = {
    SESSIONS: 'sessions',
    CONFIG: 'config',
    PREFERENCES: 'preferences',
    QUICK_MESSAGES: 'quickMessages'
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

        // ✅ 实际测试访问（处理 Safari/Firefox 跟踪保护）
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
                console.log('✅ 已获取持久化存储权限（数据不会被自动清理）');
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
        // ✅ 增强降级处理：检测 IndexedDB 可用性
        if (!isIndexedDBAvailable()) {
            console.warn('IndexedDB 不可用，将使用 localStorage 降级模式');
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB 打开失败:', request.error);
            // ✅ 降级处理：不抛出错误，返回 null
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
                    console.log('✅ 创建对象存储: sessions');
                }
            }

            // ✅ 版本 2: 创建配置、偏好设置、快捷消息存储
            if (oldVersion < 2) {
                // 创建配置存储
                if (!database.objectStoreNames.contains(STORES.CONFIG)) {
                    database.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
                    console.log('✅ 创建对象存储: config');
                }

                // 创建偏好设置存储
                if (!database.objectStoreNames.contains(STORES.PREFERENCES)) {
                    database.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' });
                    console.log('✅ 创建对象存储: preferences');
                }

                // 创建快捷消息存储
                if (!database.objectStoreNames.contains(STORES.QUICK_MESSAGES)) {
                    const qmStore = database.createObjectStore(STORES.QUICK_MESSAGES, { keyPath: 'id' });
                    qmStore.createIndex('category', 'category', { unique: false });
                    qmStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    console.log('✅ 创建对象存储: quickMessages');
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

// ========== ✅ 通用存储 API ==========

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

                // ✅ 配额检测
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

// ========== ✅ 配置存储 API ==========

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

// ========== ✅ 偏好设置存储 API ==========

/**
 * 保存偏好设置
 * @param {string} key - 偏好设置键
 * @param {any} value - 偏好设置值
 * @returns {Promise<void>}
 */
export async function savePreference(key, value) {
    return saveToStore(STORES.PREFERENCES, key, value);
}

/**
 * 加载偏好设置
 * @param {string} key - 偏好设置键
 * @returns {Promise<any|null>} 偏好设置值
 */
export async function loadPreference(key) {
    return loadFromStore(STORES.PREFERENCES, key);
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

// ========== ✅ 快捷消息存储 API ==========

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
