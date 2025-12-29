/**

- 写真ギャラリーアプリケーション
- 観客用BOTから写真データを取得・表示
- 
- @version 2.0.0
- @description プロフェッショナル版：XSS対策、スワイプ対応、差分更新
  */

const GalleryApp = (() => {
‘use strict’;

```
// ==================== プライベート変数 ====================
let photos = [];
let previousPhotosHash = null; // 前回取得したデータのハッシュ値
let currentPhotoIndex = 0;
let autoRefreshInterval = null;
let isRefreshing = false;

// スワイプ検出用
let touchStartX = 0;
let touchEndX = 0;
const SWIPE_THRESHOLD = 50; // スワイプと判定する最小距離（px）

// ==================== ユーティリティ関数 ====================

/**
 * JSONキーの値を安全に取得（大文字小文字対応）
 * @param {Object} obj - 対象オブジェクト
 * @param {...string} keyVariants - キーのバリエーション
 * @returns {*} 値またはundefined
 */
function getSafeValue(obj, ...keyVariants) {
    if (!obj || typeof obj !== 'object') return undefined;
    
    for (const key of keyVariants) {
        if (key in obj && obj[key] !== null && obj[key] !== undefined) {
            return obj[key];
        }
    }
    return undefined;
}

/**
 * HTMLエスケープ（XSS対策）
 * @param {string} str - エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
function escapeHtml(str) {
    if (!str) return '';
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 配列のハッシュ値を計算（簡易版）
 * データが変更されたかを高速に判定するため
 * @param {Array} data - ハッシュ化するデータ
 * @returns {string} ハッシュ値
 */
function calculateHash(data) {
    if (!Array.isArray(data)) return '';
    
    return data.map(item => {
        const url = getSafeValue(item, 'fullImage', 'FullImage', 'thumbnail', 'Thumbnail') || '';
        const timestamp = getSafeValue(item, 'timestamp', 'Timestamp') || '';
        return `${url}-${timestamp}`;
    }).join('|');
}

/**
 * 日時フォーマット
 * @param {string|Date} timestamp - タイムスタンプ
 * @returns {string} フォーマットされた日時
 */
function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    
    try {
        // yyyy-MM-dd HH:mm:ss 形式の場合
        if (typeof timestamp === 'string' && timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
            const [datePart, timePart] = timestamp.split(' ');
            const [year, month, day] = datePart.split('-');
            const [hour, minute] = timePart.split(':');
            return `${year}/${month}/${day} ${hour}:${minute}`;
        }
        
        // その他の形式
        const date = new Date(timestamp);
        if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}/${month}/${day} ${hours}:${minutes}`;
        }
    } catch (e) {
        console.error('日時フォーマットエラー:', e);
    }
    
    return escapeHtml(String(timestamp));
}

// ==================== データ取得 ====================

/**
 * ギャラリー写真を取得（差分更新対応）
 */
async function fetchGalleryPhotos() {
    if (!CONFIG || !CONFIG.isAudienceApiConfigured || !CONFIG.isAudienceApiConfigured()) {
        showEmptyGallery('観客用API URLが設定されていません。');
        return;
    }

    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`${CONFIG.AUDIENCE_API_URL}?t=${timestamp}`, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-cache'
        });

        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }

        const data = await response.json();
        const photoData = getSafeValue(data, 'photos', 'Photos') || [];

        if (!Array.isArray(photoData)) {
            console.error('写真データが配列ではありません:', photoData);
            showEmptyGallery('写真データの形式が正しくありません。');
            return;
        }

        if (photoData.length === 0) {
            showEmptyGallery('まだ写真が投稿されていません。');
            photos = [];
            previousPhotosHash = null;
            return;
        }

        // データの変更をチェック（差分更新）
        const newHash = calculateHash(photoData);
        if (newHash === previousPhotosHash) {
            console.log('写真データに変更なし。再レンダリングをスキップします。');
            return;
        }

        // データが変更された場合のみ更新
        photos = photoData;
        previousPhotosHash = newHash;
        renderGallery(photoData);
        updatePhotoCount(photoData.length);

    } catch (error) {
        console.error('写真取得エラー:', error);
        showEmptyGallery('写真データの読み込みに失敗しました。');
    }
}

// ==================== レンダリング ====================

/**
 * ギャラリーを表示
 * @param {Array} photoData - 写真データの配列
 */
function renderGallery(photoData) {
    const galleryGrid = document.getElementById('galleryGrid');
    if (!galleryGrid) return;

    const fragment = document.createDocumentFragment();

    photoData.forEach((photo, index) => {
        const userName = escapeHtml(getSafeValue(photo, 'userName', 'UserName') || '投稿者');
        const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
        const thumbnailUrl = getSafeValue(photo, 'thumbnail', 'Thumbnail') || 
                            getSafeValue(photo, 'fullImage', 'FullImage') || '';
        
        const formattedTime = formatTimestamp(timestamp);

        // カード要素を作成
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `${userName}の写真を拡大表示`);
        card.onclick = () => openModal(index);
        card.onkeypress = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openModal(index);
            }
        };

        // 画像ラッパー
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'photo-image-wrapper';

        // 画像要素
        const img = document.createElement('img');
        img.className = 'photo-image loading';
        img.src = escapeHtml(thumbnailUrl);
        img.alt = `${userName}の投稿写真`;
        img.loading = 'lazy';
        
        // 画像読み込み完了時
        img.onload = () => {
            img.classList.remove('loading');
        };
        
        // 画像読み込みエラー時
        img.onerror = () => {
            img.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'photo-placeholder';
            placeholder.textContent = '📷';
            imageWrapper.appendChild(placeholder);
        };

        imageWrapper.appendChild(img);
        card.appendChild(imageWrapper);

        // 写真情報
        const info = document.createElement('div');
        info.className = 'photo-info';

        const userDiv = document.createElement('div');
        userDiv.className = 'photo-user';
        userDiv.textContent = userName;

        const timeDiv = document.createElement('div');
        timeDiv.className = 'photo-time';
        timeDiv.textContent = formattedTime;

        info.appendChild(userDiv);
        info.appendChild(timeDiv);
        card.appendChild(info);

        fragment.appendChild(card);
    });

    galleryGrid.innerHTML = '';
    galleryGrid.appendChild(fragment);
}

/**
 * 空のギャラリーを表示
 * @param {string} message - 表示するメッセージ
 */
function showEmptyGallery(message) {
    const galleryGrid = document.getElementById('galleryGrid');
    if (!galleryGrid) return;

    const safeMessage = escapeHtml(message);
    
    galleryGrid.innerHTML = `
        <div class="gallery-empty">
            <div class="gallery-empty-icon">📷</div>
            <div class="gallery-empty-text">${safeMessage}</div>
            <div class="gallery-empty-subtext">写真が投稿されるとここに表示されます</div>
        </div>
    `;
    
    updatePhotoCount(0);
}

/**
 * 写真枚数を更新
 * @param {number} count - 写真の枚数
 */
function updatePhotoCount(count) {
    const photoCount = document.getElementById('photoCount');
    if (photoCount) {
        photoCount.textContent = count;
    }
}

// ==================== モーダル機能 ====================

/**
 * モーダルを開く
 * @param {number} index - 表示する写真のインデックス
 */
function openModal(index) {
    if (!photos || photos.length === 0) return;
    
    currentPhotoIndex = index;
    const modal = document.getElementById('photoModal');
    
    if (!modal) return;
    
    updateModalContent();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // フォーカスをモーダルに移動（アクセシビリティ）
    modal.focus();
}

/**
 * モーダルを閉じる
 */
function closeModal() {
    const modal = document.getElementById('photoModal');
    if (!modal) return;
    
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

/**
 * 次の写真へ
 */
function nextPhoto() {
    if (!photos || photos.length === 0) return;
    
    currentPhotoIndex = (currentPhotoIndex + 1) % photos.length;
    updateModalContent();
}

/**
 * 前の写真へ
 */
function prevPhoto() {
    if (!photos || photos.length === 0) return;
    
    currentPhotoIndex = (currentPhotoIndex - 1 + photos.length) % photos.length;
    updateModalContent();
}

/**
 * モーダルコンテンツを更新（フェードイン対応）
 */
function updateModalContent() {
    const photo = photos[currentPhotoIndex];
    if (!photo) return;

    const modalImage = document.getElementById('modalImage');
    const modalUser = document.getElementById('modalUser');
    const modalTime = document.getElementById('modalTime');
    const modalPrev = document.getElementById('modalPrev');
    const modalNext = document.getElementById('modalNext');

    // 画像読み込み中の状態を表示
    if (modalImage) {
        modalImage.classList.add('loading');
        
        const fullImageUrl = getSafeValue(photo, 'fullImage', 'FullImage') || 
                            getSafeValue(photo, 'thumbnail', 'Thumbnail') || '';
        
        // 新しい画像を読み込み
        const newImage = new Image();
        newImage.onload = () => {
            modalImage.src = escapeHtml(fullImageUrl);
            modalImage.classList.remove('loading');
        };
        newImage.onerror = () => {
            modalImage.src = escapeHtml(fullImageUrl);
            modalImage.classList.remove('loading');
        };
        newImage.src = fullImageUrl;
    }

    // ユーザー名と時刻を更新
    if (modalUser) {
        const userName = escapeHtml(getSafeValue(photo, 'userName', 'UserName') || '投稿者');
        modalUser.textContent = userName;
    }

    if (modalTime) {
        const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
        modalTime.textContent = formatTimestamp(timestamp);
    }

    // ナビゲーションボタンの状態を更新
    if (modalPrev) {
        modalPrev.disabled = photos.length <= 1;
    }
    
    if (modalNext) {
        modalNext.disabled = photos.length <= 1;
    }
}

// ==================== スワイプ検出 ====================

/**
 * タッチ開始イベント
 * @param {TouchEvent} e - タッチイベント
 */
function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
}

/**
 * タッチ終了イベント（スワイプ判定）
 * @param {TouchEvent} e - タッチイベント
 */
function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}

/**
 * スワイプ方向を判定して写真を切り替え
 */
function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    
    // 左スワイプ（次へ）
    if (swipeDistance < -SWIPE_THRESHOLD) {
        nextPhoto();
    }
    // 右スワイプ（前へ）
    else if (swipeDistance > SWIPE_THRESHOLD) {
        prevPhoto();
    }
}

// ==================== ナビゲーションスクロールインジケーター ====================

/**
 * ナビゲーションのスクロールインジケーターを初期化
 */
function initNavScrollIndicator() {
    const navLinks = document.getElementById('navLinks');
    const navWrapper = document.getElementById('navWrapper');

    if (!navLinks || !navWrapper) return;

    function updateScrollIndicator() {
        const scrollLeft = navLinks.scrollLeft;
        const scrollWidth = navLinks.scrollWidth;
        const clientWidth = navLinks.clientWidth;
        const maxScroll = scrollWidth - clientWidth;

        if (scrollLeft <= 5) {
            navWrapper.classList.add('scroll-start');
            navWrapper.classList.remove('scroll-middle', 'scroll-end');
        } else if (scrollLeft >= maxScroll - 5) {
            navWrapper.classList.add('scroll-end');
            navWrapper.classList.remove('scroll-start', 'scroll-middle');
        } else {
            navWrapper.classList.add('scroll-middle');
            navWrapper.classList.remove('scroll-start', 'scroll-end');
        }
    }

    updateScrollIndicator();
    navLinks.addEventListener('scroll', updateScrollIndicator);
    window.addEventListener('resize', updateScrollIndicator);
}

// ==================== パブリックAPI ====================

return {
    /**
     * アプリケーションを初期化
     */
    init() {
        console.log('GalleryApp: 初期化開始');
        
        // ナビゲーションスクロールインジケーターを初期化
        initNavScrollIndicator();

        // 手動更新ボタン
        const refreshBtn = document.getElementById('galleryRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.manualRefresh());
        }

        // モーダルイベント
        const modalClose = document.getElementById('modalClose');
        if (modalClose) {
            modalClose.addEventListener('click', () => closeModal());
        }

        const modalPrev = document.getElementById('modalPrev');
        if (modalPrev) {
            modalPrev.addEventListener('click', () => prevPhoto());
        }

        const modalNext = document.getElementById('modalNext');
        if (modalNext) {
            modalNext.addEventListener('click', () => nextPhoto());
        }

        // モーダル背景クリックで閉じる
        const modal = document.getElementById('photoModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
            
            // スワイプイベントをモーダルに設定
            modal.addEventListener('touchstart', handleTouchStart, { passive: true });
            modal.addEventListener('touchend', handleTouchEnd, { passive: true });
        }

        // キーボードイベント
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('photoModal');
            if (!modal || !modal.classList.contains('active')) return;

            switch(e.key) {
                case 'Escape':
                    closeModal();
                    break;
                case 'ArrowLeft':
                    prevPhoto();
                    break;
                case 'ArrowRight':
                    nextPhoto();
                    break;
            }
        });

        // 初回データ取得
        fetchGalleryPhotos();

        // 自動更新開始
        this.startAutoRefresh();
        
        console.log('GalleryApp: 初期化完了');
    },

    /**
     * 手動更新
     */
    async manualRefresh() {
        if (isRefreshing) {
            console.log('GalleryApp: 更新中のため、リクエストをスキップ');
            return;
        }

        isRefreshing = true;
        const btn = document.getElementById('galleryRefreshBtn');
        if (btn) btn.disabled = true;

        console.log('GalleryApp: 手動更新開始');
        await fetchGalleryPhotos();

        const timeout = CONFIG && CONFIG.REFRESH_TIMEOUT ? CONFIG.REFRESH_TIMEOUT : 2000;

        setTimeout(() => {
            isRefreshing = false;
            if (btn) btn.disabled = false;
            console.log('GalleryApp: 手動更新完了');
        }, timeout);
    },

    /**
     * 自動更新を開始
     */
    startAutoRefresh() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        
        const interval = (CONFIG && CONFIG.AUTO_REFRESH_INTERVAL) ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
        
        autoRefreshInterval = setInterval(() => {
            console.log('GalleryApp: 自動更新実行');
            fetchGalleryPhotos();
        }, interval);
        
        console.log(`GalleryApp: 自動更新開始 (${interval}ms間隔)`);
    },

    /**
     * 自動更新を停止
     */
    stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
            console.log('GalleryApp: 自動更新停止');
        }
    },

    /**
     * モーダルを開く（外部から呼び出し可能）
     * @param {number} index - 写真のインデックス
     */
    openModal(index) {
        openModal(index);
    }
};
```

})();

// ==================== 初期化 ====================
document.addEventListener(‘DOMContentLoaded’, () => {
GalleryApp.init();
});

// ページを離れるときに自動更新を停止
window.addEventListener(‘beforeunload’, () => {
GalleryApp.stopAutoRefresh();
});