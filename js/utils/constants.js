/**
 * 应用程序全局常量
 * 所有硬编码值应定义在此处，便于统一管理和修改
 */

// ========== 文件大小限制 ==========

/**
 * 最大文件大小限制（字节）
 * 用于图片、PDF 等附件上传
 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * API 提供商文件大小限制（字节）
 */
export const API_FILE_SIZE_LIMITS = {
    gemini: 20 * 1024 * 1024,   // 20 MB (总请求大小限制)
    openai: 20 * 1024 * 1024,   // 20 MB
    claude: 20 * 1024 * 1024    // 20 MB
};

// ========== 消息长度限制 ==========

/**
 * 最大消息长度（字符）
 * 约 25k tokens
 */
export const MAX_MESSAGE_LENGTH = 100000;

/**
 * 最大 Markdown 渲染长度（字符）
 * 防止超长文本导致渲染卡顿
 */
export const MAX_MARKDOWN_LENGTH = 100000;

// ========== 超时设置 ==========

/**
 * 通知持续时间（毫秒）
 */
export const NOTIFICATION_DURATION = 5000; // 5 秒

/**
 * 工具调用超时时间（毫秒）
 */
export const TOOL_CALL_TIMEOUT = 30000; // 30 秒

/**
 * MCP 服务器连接超时（毫秒）
 */
export const MCP_CONNECTION_TIMEOUT = 10000; // 10 秒

/**
 * MCP 请求超时（毫秒）
 */
export const MCP_REQUEST_TIMEOUT = 10000; // 10 秒

/**
 * MCP 重连最大延迟（毫秒）
 */
export const MCP_MAX_RECONNECT_DELAY = 10000; // 10 秒

/**
 * 图片压缩超时（毫秒）
 */
export const IMAGE_COMPRESSION_TIMEOUT = 10000; // 10 秒

// ========== 缓冲区大小 ==========

/**
 * XML 工具调用最大缓冲区大小（字符）
 */
export const XML_MAX_BUFFER_SIZE = 50000;

/**
 * XML 单个工具最大内容长度（字符）
 */
export const XML_MAX_TOOL_CONTENT_LENGTH = 10000;

// ========== 附件限制 ==========

/**
 * 单次上传最大附件数量
 */
export const MAX_ATTACHMENTS = 10;

/**
 * 自动转换为文档的 token 阈值
 */
export const AUTO_DOCUMENT_TOKEN_THRESHOLD = 5000;

/**
 * 单条消息最大图片数量
 */
export const MAX_IMAGES_PER_MESSAGE = 10;

// ========== 虚拟滚动配置 ==========

/**
 * 虚拟滚动启用阈值（消息数量）
 */
export const VIRTUAL_SCROLL_THRESHOLD = 100;

/**
 * 虚拟滚动预估消息高度（像素）
 */
export const VIRTUAL_SCROLL_ITEM_HEIGHT = 150;

/**
 * 虚拟滚动 overscan 数量
 */
export const VIRTUAL_SCROLL_OVERSCAN = 5;

// ========== UI 常量 ==========

/**
 * 文件名显示最大长度（字符）
 */
export const MAX_FILENAME_DISPLAY_LENGTH = 20;

/**
 * 引用消息预览最大长度（字符）
 */
export const MAX_QUOTE_PREVIEW_LENGTH = 100;

/**
 * 代码块最大显示行数（折叠）
 */
export const CODE_BLOCK_MAX_LINES = 30;

// ========== ID 生成 ==========

/**
 * 工具 ID 计数器循环阈值
 */
export const TOOL_ID_COUNTER_MAX = 10000;

/**
 * MCP 配置 ID 计数器循环阈值
 */
export const MCP_CONFIG_ID_COUNTER_MAX = 10000;

// ========== MCP 重试配置 ==========

/**
 * MCP 重试初始延迟（毫秒）
 */
export const MCP_RETRY_INITIAL_DELAY = 1000; // 1 秒

/**
 * MCP 重试最大次数
 */
export const MCP_MAX_RETRIES = 3;

/**
 * MCP 重试延迟倍数
 */
export const MCP_RETRY_MULTIPLIER = 2;

// ========== 图片处理 ==========

/**
 * 图片压缩质量（0-1）
 */
export const IMAGE_COMPRESSION_QUALITY = 0.8;

/**
 * 图片最大宽度（像素）
 */
export const IMAGE_MAX_WIDTH = 2048;

/**
 * 图片最大高度（像素）
 */
export const IMAGE_MAX_HEIGHT = 2048;

// ========== 状态管理 ==========

/**
 * 状态历史最大记录数
 */
export const STATE_HISTORY_MAX_SIZE = 20;

/**
 * 发送锁超时时间（毫秒）
 */
export const SEND_LOCK_TIMEOUT = 30000; // 30 秒

// ========== 缓存配置 ==========

/**
 * DOM 缓存刷新间隔（毫秒）
 */
export const DOM_CACHE_REFRESH_INTERVAL = 5000; // 5 秒

/**
 * 会话自动保存间隔（毫秒）
 */
export const SESSION_AUTO_SAVE_INTERVAL = 3000; // 3 秒

// ========== 动画时长 ==========

/**
 * 默认过渡动画时长（毫秒）
 */
export const DEFAULT_TRANSITION_DURATION = 300;

/**
 * 快速过渡动画时长（毫秒）
 */
export const FAST_TRANSITION_DURATION = 150;

/**
 * 慢速过渡动画时长（毫秒）
 */
export const SLOW_TRANSITION_DURATION = 500;

// ========== 防抖节流 ==========

/**
 * 默认防抖延迟（毫秒）
 */
export const DEFAULT_DEBOUNCE_DELAY = 300;

/**
 * 默认节流延迟（毫秒）
 */
export const DEFAULT_THROTTLE_DELAY = 500;

// ========== 会话管理 ==========

/**
 * 最大会话数量
 */
export const MAX_SESSIONS = 1000;

/**
 * 会话切换防抖延迟（毫秒）
 */
export const SESSION_SWITCH_DEBOUNCE = 100;
