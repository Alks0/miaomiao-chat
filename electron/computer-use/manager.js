/**
 * Computer Use 管理器
 * 统一管理所有 Computer Use 功能模块
 */

const screenshot = require('./screenshot');
const mouse = require('./mouse');
const keyboard = require('./keyboard');
const display = require('./display');
const bash = require('./bash');
const textEditor = require('./text-editor');
const logger = require('./logger');
const audit = require('./audit');

class ComputerUseManager {
    constructor() {
        this.permissions = {
            mouse: true,
            keyboard: true,
            screenshot: true,
            bash: true,
            textEditor: true
        };

        this.bashConfig = {
            workingDirectory: process.cwd(),
            timeout: 30,
            requireConfirmation: false
        };

        logger.info('Manager', 'Manager initialized');
    }

    /**
     * 更新权限配置
     */
    updatePermissions(newPermissions) {
        this.permissions = { ...this.permissions, ...newPermissions };
        logger.info('Manager', 'Permissions updated', this.permissions);
    }

    /**
     * 更新 Bash 配置
     */
    updateBashConfig(newConfig) {
        this.bashConfig = { ...this.bashConfig, ...newConfig };
        logger.info('Manager', 'Bash config updated', this.bashConfig);
    }

    /**
     * 检查权限
     */
    checkPermission(action) {
        const allowed = this.permissions[action] !== false;
        if (!allowed) {
            logger.warn('Manager', `Action denied: ${action}`);
        }
        return allowed;
    }

    /**
     * 截图
     */
    async captureScreen() {
        const startTime = Date.now();
        try {
            if (!this.checkPermission('screenshot')) {
                await audit.log('screenshot', {}, { success: false, error: 'Permission denied' });
                throw new Error('Screenshot permission denied');
            }
            const result = await screenshot.capture();
            await audit.log('screenshot', {}, { success: true, duration: Date.now() - startTime });
            return result;
        } catch (error) {
            await audit.log('screenshot', {}, { success: false, error: error.message, duration: Date.now() - startTime });
            throw error;
        }
    }

    /**
     * 区域放大截图（zoom）
     */
    async zoomRegion(x1, y1, x2, y2) {
        const startTime = Date.now();
        try {
            if (!this.checkPermission('screenshot')) {
                await audit.log('zoom', { x1, y1, x2, y2 }, { success: false, error: 'Permission denied' });
                throw new Error('Screenshot permission denied');
            }
            const result = await screenshot.captureRegion(x1, y1, x2, y2);
            await audit.log('zoom', { x1, y1, x2, y2 }, { success: true, duration: Date.now() - startTime });
            return result;
        } catch (error) {
            await audit.log('zoom', { x1, y1, x2, y2 }, { success: false, error: error.message, duration: Date.now() - startTime });
            throw error;
        }
    }

    /**
     * 鼠标移动
     */
    async moveMouse(x, y) {
        const startTime = Date.now();
        try {
            if (!this.checkPermission('mouse')) {
                await audit.log('mouse_move', { x, y }, { success: false, error: 'Permission denied' });
                throw new Error('Mouse permission denied');
            }
            const result = await mouse.move(x, y);
            await audit.log('mouse_move', { x, y }, { success: true, duration: Date.now() - startTime });
            return result;
        } catch (error) {
            await audit.log('mouse_move', { x, y }, { success: false, error: error.message, duration: Date.now() - startTime });
            throw error;
        }
    }

    /**
     * 鼠标点击
     */
    async clickMouse(button = 'left') {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.click(button);
    }

    /**
     * 鼠标双击
     */
    async doubleClickMouse(button = 'left') {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.doubleClick(button);
    }

    /**
     * 鼠标三击
     */
    async tripleClickMouse(button = 'left') {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.tripleClick(button);
    }

    /**
     * 鼠标拖拽
     */
    async dragMouse(fromX, fromY, toX, toY) {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.drag(fromX, fromY, toX, toY);
    }

    /**
     * 鼠标滚轮
     */
    async scrollMouse(amount) {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.scroll(amount);
    }

    /**
     * 按下鼠标按钮（不释放）
     */
    async pressMouseButton(button = 'left') {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.pressButton(button);
    }

    /**
     * 释放鼠标按钮
     */
    async releaseMouseButton(button = 'left') {
        if (!this.checkPermission('mouse')) {
            throw new Error('Mouse permission denied');
        }
        return await mouse.releaseButton(button);
    }

    /**
     * 键盘输入
     */
    async typeText(text) {
        if (!this.checkPermission('keyboard')) {
            throw new Error('Keyboard permission denied');
        }
        return await keyboard.type(text);
    }

    /**
     * 按键
     */
    async pressKey(key, modifiers = []) {
        if (!this.checkPermission('keyboard')) {
            throw new Error('Keyboard permission denied');
        }
        return await keyboard.press(key, modifiers);
    }

    /**
     * 按住按键
     */
    async holdKey(key) {
        if (!this.checkPermission('keyboard')) {
            throw new Error('Keyboard permission denied');
        }
        return await keyboard.pressDown(key);
    }

    /**
     * 释放按键
     */
    async releaseKey(key) {
        if (!this.checkPermission('keyboard')) {
            throw new Error('Keyboard permission denied');
        }
        return await keyboard.release(key);
    }

    /**
     * 获取显示器信息
     */
    async getDisplayInfo() {
        return await display.getInfo();
    }

    /**
     * 获取光标位置
     */
    async getCursorPosition() {
        return await mouse.getPosition();
    }

    /**
     * 执行 Bash 命令
     */
    async executeBash(command) {
        const startTime = Date.now();
        try {
            if (!this.checkPermission('bash')) {
                await audit.log('bash', { command }, { success: false, error: 'Permission denied' });
                throw new Error('Bash permission denied');
            }
            const result = await bash.execute(command, this.bashConfig);
            await audit.log('bash', { command }, { success: result.success, duration: Date.now() - startTime });
            return result;
        } catch (error) {
            await audit.log('bash', { command }, { success: false, error: error.message, duration: Date.now() - startTime });
            throw error;
        }
    }

    /**
     * 读取文件
     */
    async readFile(path) {
        if (!this.checkPermission('textEditor')) {
            throw new Error('Text editor permission denied');
        }
        return await textEditor.read(path);
    }

    /**
     * 写入文件
     */
    async writeFile(path, content) {
        if (!this.checkPermission('textEditor')) {
            throw new Error('Text editor permission denied');
        }
        return await textEditor.write(path, content);
    }
}

// 导出单例
module.exports = new ComputerUseManager();
