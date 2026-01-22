/**

- スケジュールページ専用JavaScript
  */

// ナビゲーションバーのスクロール制御
function updateNavScrollIndicators() {
const navWrapper = document.querySelector(’.nav-wrapper’);
const navLinks = document.querySelector(’.nav-links’);

```
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
```

}

// ページ初期化
document.addEventListener(‘DOMContentLoaded’, function() {
// ナビゲーションバーのスクロールイベント
const navLinks = document.querySelector(’.nav-links’);
if (navLinks) {
navLinks.addEventListener(‘scroll’, updateNavScrollIndicators);
window.addEventListener(‘resize’, updateNavScrollIndicators);

    // 初期状態を設定
    updateNavScrollIndicators();
}

// アクティブなナビゲーションリンクを設定
const currentPage = 'schedule.html';
const navLinksAll = document.querySelectorAll('.nav-link');
navLinksAll.forEach(link => {
    if (link.getAttribute('href') === currentPage) {
        link.style.fontWeight = 'bold';
        link.style.borderBottom = '2px solid white';
        link.style.paddingBottom = '6px';
    }
});

});