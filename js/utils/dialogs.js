/**
 * 通用对话框工具
 * 替代 Electron 中不支持的 prompt() 和 confirm()
 */

/**
 * 显示输入对话框（替代 prompt）
 * @param {string} message - 提示消息
 * @param {string} defaultValue - 默认值
 * @param {string} title - 对话框标题
 * @returns {Promise<string|null>} 用户输入的值，或 null（取消时）
 */
export function showInputDialog(message, defaultValue = '', title = '输入') {
    return new Promise((resolve) => {
        const modal = document.getElementById('input-dialog-modal');
        const titleEl = document.getElementById('input-dialog-title');
        const messageEl = document.getElementById('input-dialog-message');
        const input = document.getElementById('input-dialog-input');
        const confirmBtn = document.getElementById('input-dialog-confirm');
        const cancelBtn = document.getElementById('input-dialog-cancel');
        const closeBtn = document.getElementById('close-input-dialog');

        // 设置内容
        titleEl.textContent = title;
        messageEl.textContent = message;
        input.value = defaultValue;

        // 显示对话框
        modal.style.display = 'flex';

        // 聚焦输入框并选中文本
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);

        // 确定按钮
        const handleConfirm = () => {
            const value = input.value.trim();
            cleanup();
            resolve(value || null);
        };

        // 取消按钮
        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        // 清理函数
        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            closeBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keydown', handleKeydown);
        };

        // 键盘事件
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
            }
        };

        // 绑定事件
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        closeBtn.addEventListener('click', handleCancel);
        input.addEventListener('keydown', handleKeydown);
    });
}

/**
 * 显示确认对话框（替代 confirm）
 * @param {string} message - 确认消息
 * @param {string} title - 对话框标题
 * @returns {Promise<boolean>} true = 确定, false = 取消
 */
export function showConfirmDialog(message, title = '确认') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-dialog-modal');
        const titleEl = document.getElementById('confirm-dialog-title');
        const messageEl = document.getElementById('confirm-dialog-message');
        const confirmBtn = document.getElementById('confirm-dialog-confirm');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        const closeBtn = document.getElementById('close-confirm-dialog');

        // 设置内容
        titleEl.textContent = title;
        messageEl.textContent = message;

        // 显示对话框
        modal.style.display = 'flex';

        // 聚焦确定按钮
        setTimeout(() => {
            confirmBtn.focus();
        }, 100);

        // 确定按钮
        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        // 取消按钮
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        // 清理函数
        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            closeBtn.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleKeydown);
        };

        // 键盘事件
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
            }
        };

        // 绑定事件
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        closeBtn.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleKeydown);
    });
}
