/**
 * 全ページ共通JavaScript
 */

/**
 * ナビゲーションバーのスクロールインジケーター更新
 */
function updateNavScrollIndicators() {
    const navWrapper = document.querySelector('.nav-wrapper');
    const navLinks = document.querySelector('.nav-links');
    
    if (!navWrapper || !navLinks) return;

    const maxScroll = navLinks.scrollWidth - navLinks.clientWidth;
    const currentScroll = navLinks.scrollLeft;
    const threshold = 5;

    // スクロールが不要な場合
    if (maxScroll <= threshold) {
        navWrapper.classList.remove('scroll-start', 'scroll-middle', 'scroll-end');
        return;
    }

    // スクロール位置に応じてクラスを切り替え
    navWrapper.classList.remove('scroll-start', 'scroll-middle', 'scroll-end');
    
    if (currentScroll <= threshold) {
        navWrapper.classList.add('scroll-start');
    } else if (currentScroll >= maxScroll - threshold) {
        navWrapper.classList.add('scroll-end');
    } else {
        navWrapper.classList.add('scroll-middle');
    }
}

/**
 * アクティブなナビゲーションリンクを設定
 * @param {string} currentPage - 現在のページのファイル名（例: 'schedule.html'）
 */
function setActiveNavLink(currentPage) {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.style.fontWeight = 'bold';
            link.style.borderBottom = '2px solid white';
            link.style.paddingBottom = '6px';
        }
    });
}

/**
 * ナビゲーションバーの初期化
 * @param {string} currentPage - 現在のページのファイル名
 */
function initNavigation(currentPage) {
    const navLinks = document.querySelector('.nav-links');
    
    if (navLinks) {
        // スクロールイベントリスナーを追加
        navLinks.addEventListener('scroll', updateNavScrollIndicators);
        window.addEventListener('resize', updateNavScrollIndicators);
        
        // 初期状態を設定
        updateNavScrollIndicators();
    }
    
    // アクティブリンクを設定
    if (currentPage) {
        setActiveNavLink(currentPage);
    }
}

/**
 * ページ読み込み完了時の共通初期化処理
 */
document.addEventListener('DOMContentLoaded', function() {
    // 現在のページのファイル名を自動取得
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    // ナビゲーションを初期化
    initNavigation(currentPage);
});