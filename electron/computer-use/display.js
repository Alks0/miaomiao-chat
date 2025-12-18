/**
 * 显示器信息模块
 * 使用 Electron 的 screen API
 */

const { screen } = require('electron');

/**
 * 获取所有显示器信息
 * @returns {Promise<Array>}
 */
async function getInfo() {
    try {
        const displays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();

        const displayInfo = displays.map((display, index) => ({
            id: display.id,
            index,
            isPrimary: display.id === primaryDisplay.id,
            bounds: display.bounds,
            workArea: display.workArea,
            size: display.size,
            scaleFactor: display.scaleFactor,
            rotation: display.rotation,
            touchSupport: display.touchSupport
        }));

        console.log('[Display] Info retrieved:', displayInfo.length, 'displays');
        return displayInfo;
    } catch (error) {
        console.error('[Display] Get info error:', error);
        throw error;
    }
}

/**
 * 获取主显示器信息
 */
async function getPrimaryDisplay() {
    try {
        const primary = screen.getPrimaryDisplay();
        return {
            id: primary.id,
            isPrimary: true,
            bounds: primary.bounds,
            workArea: primary.workArea,
            size: primary.size,
            scaleFactor: primary.scaleFactor,
            rotation: primary.rotation
        };
    } catch (error) {
        console.error('[Display] Get primary display error:', error);
        throw error;
    }
}

/**
 * 获取鼠标所在显示器
 */
async function getDisplayAtPoint(x, y) {
    try {
        const display = screen.getDisplayNearestPoint({ x, y });
        return {
            id: display.id,
            bounds: display.bounds,
            workArea: display.workArea,
            size: display.size
        };
    } catch (error) {
        console.error('[Display] Get display at point error:', error);
        throw error;
    }
}

module.exports = {
    getInfo,
    getPrimaryDisplay,
    getDisplayAtPoint
};
