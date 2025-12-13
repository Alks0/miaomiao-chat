/**
 * Capacitor 构建准备脚本
 * 将 web 资源复制到 www 目录
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const wwwDir = path.join(rootDir, 'www');

// 需要复制的文件和目录
const itemsToCopy = [
    'index.html',
    'style.css',
    'js',
    'styles',
    'assets',
    'libs',
    'sounds'
];

// 递归复制目录
function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// 清空 www 目录
if (fs.existsSync(wwwDir)) {
    fs.rmSync(wwwDir, { recursive: true, force: true });
}

fs.mkdirSync(wwwDir);

console.log('📦 准备 Capacitor 构建...');

// 复制所有资源
for (const item of itemsToCopy) {
    const srcPath = path.join(rootDir, item);
    const destPath = path.join(wwwDir, item);

    if (!fs.existsSync(srcPath)) {
        console.log(`⚠️  跳过不存在的: ${item}`);
        continue;
    }

    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
        console.log(`📁 复制目录: ${item}`);
        copyRecursive(srcPath, destPath);
    } else {
        console.log(`📄 复制文件: ${item}`);
        fs.copyFileSync(srcPath, destPath);
    }
}

console.log('✅ Capacitor 资源准备完成！');
