/**
 * 模型能力徽章渲染工具
 * 提供两种渲染模式：HTML徽章（用于模型卡片）和纯文本（用于下拉列表和消息）
 */

/**
 * 生成能力标签 HTML（用于模型卡片）
 * @param {Object} capabilities - {imageInput: boolean, imageOutput: boolean}
 * @returns {string} HTML 字符串
 */
export function renderCapabilityBadges(capabilities) {
    if (!capabilities) return '';

    const badges = [];
    if (capabilities.imageInput) {
        badges.push('<span class="capability-badge vision" title="支持图片理解">V</span>');
    }
    if (capabilities.imageOutput) {
        badges.push('<span class="capability-badge image" title="支持图片生成">I</span>');
    }

    return badges.length > 0 ? ' ' + badges.join(' ') : '';
}

/**
 * 生成能力标签纯文本（用于下拉列表和消息）
 * @param {Object} capabilities - {imageInput: boolean, imageOutput: boolean}
 * @returns {string} 纯文本
 */
export function renderCapabilityBadgesText(capabilities) {
    if (!capabilities) return '';

    const badges = [];
    if (capabilities.imageInput) badges.push('[V]');
    if (capabilities.imageOutput) badges.push('[I]');

    return badges.length > 0 ? ' ' + badges.join(' ') : '';
}
