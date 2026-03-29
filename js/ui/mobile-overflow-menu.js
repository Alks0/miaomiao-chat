/**
 * 移动端溢出菜单
 * 将 Header 中的 5 个按钮收纳到一个下拉菜单中
 */

/**
 * 初始化溢出菜单
 */
export function initMobileOverflowMenu() {
    const btn = document.getElementById('mobile-overflow-btn');
    const menu = document.getElementById('mobile-overflow-menu');
    if (!btn || !menu) return;

    // 切换菜单开关
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });

    // 菜单项点击 → 触发对应原始按钮
    menu.querySelectorAll('.mobile-overflow-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.dataset.target;
            if (targetId) {
                document.getElementById(targetId)?.click();
            }
            menu.classList.remove('open');
        });
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
            menu.classList.remove('open');
        }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('open')) {
            menu.classList.remove('open');
        }
    });
}

/**
 * 更新移动端标题栏的模型名
 * @param {string} modelName - 模型名
 */
export function updateMobileHeaderTitle(modelName) {
    const el = document.getElementById('mobile-header-title');
    if (el) {
        el.textContent = modelName || '';
    }
}
