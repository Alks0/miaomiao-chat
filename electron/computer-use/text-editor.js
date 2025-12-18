/**
 * 文本编辑器模块
 * 使用 Node.js fs API 进行文件读写
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 读取文件内容
 * @param {string} filePath - 文件路径
 * @returns {Promise<{content: string, size: number}>}
 */
async function read(filePath) {
    try {
        const absolutePath = path.resolve(filePath);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const stats = await fs.stat(absolutePath);

        console.log(`[TextEditor] Read file: ${absolutePath} (${stats.size} bytes)`);

        return {
            content,
            size: stats.size,
            path: absolutePath
        };
    } catch (error) {
        console.error('[TextEditor] Read error:', error);
        throw error;
    }
}

/**
 * 写入文件内容
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 * @returns {Promise<{path: string, size: number}>}
 */
async function write(filePath, content) {
    try {
        const absolutePath = path.resolve(filePath);

        // 确保目录存在
        const directory = path.dirname(absolutePath);
        await fs.mkdir(directory, { recursive: true });

        // 写入文件
        await fs.writeFile(absolutePath, content, 'utf-8');

        const stats = await fs.stat(absolutePath);

        console.log(`[TextEditor] Wrote file: ${absolutePath} (${stats.size} bytes)`);

        return {
            path: absolutePath,
            size: stats.size
        };
    } catch (error) {
        console.error('[TextEditor] Write error:', error);
        throw error;
    }
}

/**
 * 在文件末尾追加内容
 * @param {string} filePath - 文件路径
 * @param {string} content - 要追加的内容
 */
async function append(filePath, content) {
    try {
        const absolutePath = path.resolve(filePath);
        await fs.appendFile(absolutePath, content, 'utf-8');

        const stats = await fs.stat(absolutePath);

        console.log(`[TextEditor] Appended to file: ${absolutePath} (${stats.size} bytes total)`);

        return {
            path: absolutePath,
            size: stats.size
        };
    } catch (error) {
        console.error('[TextEditor] Append error:', error);
        throw error;
    }
}

/**
 * 检查文件是否存在
 * @param {string} filePath - 文件路径
 */
async function exists(filePath) {
    try {
        const absolutePath = path.resolve(filePath);
        await fs.access(absolutePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 删除文件
 * @param {string} filePath - 文件路径
 */
async function remove(filePath) {
    try {
        const absolutePath = path.resolve(filePath);
        await fs.unlink(absolutePath);

        console.log(`[TextEditor] Deleted file: ${absolutePath}`);

        return {
            path: absolutePath,
            deleted: true
        };
    } catch (error) {
        console.error('[TextEditor] Delete error:', error);
        throw error;
    }
}

/**
 * 获取文件信息
 * @param {string} filePath - 文件路径
 */
async function getInfo(filePath) {
    try {
        const absolutePath = path.resolve(filePath);
        const stats = await fs.stat(absolutePath);

        return {
            path: absolutePath,
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime
        };
    } catch (error) {
        console.error('[TextEditor] Get info error:', error);
        throw error;
    }
}

module.exports = {
    read,
    write,
    append,
    exists,
    remove,
    getInfo
};
