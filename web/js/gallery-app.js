/**
 * 写真ギャラリーアプリケーション
 * 観客用BOTから写真データを取得・表示
 */

const GalleryApp = (() => {
    // ==================== プライベート変数 ====================
    let photos = [];
    let currentPhotoIndex = 0;
    let autoRefreshInterval = null;
    let isRefreshing = false;

    // ==================== ユーティリティ関数 ====================

    /**
     * JSONキーの値を安全に取得
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
     * HTMLエスケープ
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * 日時フォーマット
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
        
        return timestamp;
    }

    // ==================== データ取得 ====================

    /**
     * ギャラリー写真を取得
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

            if (!Array.isArray(photoData) || photoData.length === 0) {
                showEmptyGallery('まだ写真が投稿されていません。');
                return;
            }

            photos = photoData;
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
     */
    function renderGallery(photoData) {
        const galleryGrid = document.getElementById('galleryGrid');
        if (!galleryGrid) return;

        let html = '';

        photoData.forEach((photo, index) => {
            const userName = getSafeValue(photo, 'userName', 'UserName') || '投稿者';
            const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
            const thumbnailUrl = getSafeValue(photo, 'thumbnail', 'Thumbnail') || 
                                getSafeValue(photo, 'fullImage', 'FullImage') || '';
            
            const formattedTime = formatTimestamp(timestamp);

            html += `
                <div class="photo-card" onclick="GalleryApp.openModal(${index})">
                    <div class="photo-image-wrapper">
                        <img 
                            src="${escapeHtml(thumbnailUrl)}" 
                            alt="大会写真" 
                            class="photo-image"
                            loading="lazy"
                            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                        >
                        <div class="photo-placeholder" style="display:none;">📷</div>
                    </div>
                    <div class="photo-info">
                        <div class="photo-user">${escapeHtml(userName)}</div>
                        <div class="photo-time">${escapeHtml(formattedTime)}</div>
                    </div>
                </div>
            `;
        });

        galleryGrid.innerHTML = html;
    }

    /**
     * 空のギャラリーを表示
     */
    function showEmptyGallery(message) {
        const galleryGrid = document.getElementById('galleryGrid');
        if (!galleryGrid) return;

        galleryGrid.innerHTML = `
            <div class="gallery-empty" style="grid-column: 1 / -1;">
                <div class="gallery-empty-icon">📷</div>
                <div class="gallery-empty-text">${message}</div>
                <div class="gallery-empty-subtext">写真が投稿されるとここに表示されます</div>
            </div>
        `;
        
        updatePhotoCount(0);
    }

    /**
     * 写真枚数を更新
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
     */
    function openModal(index) {
        if (!photos || photos.length === 0) return;
        
        currentPhotoIndex = index;
        const modal = document.getElementById('photoModal');
        
        if (!modal) return;
        
        updateModalContent();
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
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
     * モーダルコンテンツを更新
     */
    function updateModalContent() {
        const photo = photos[currentPhotoIndex];
        if (!photo) return;

        const modalImage = document.getElementById('modalImage');
        const modalUser = document.getElementById('modalUser');
        const modalTime = document.getElementById('modalTime');

        if (modalImage) {
            const fullImageUrl = getSafeValue(photo, 'fullImage', 'FullImage') || 
                                getSafeValue(photo, 'thumbnail', 'Thumbnail') || '';
            modalImage.src = fullImageUrl;
        }

        if (modalUser) {
            const userName = getSafeValue(photo, 'userName', 'UserName') || '投稿者';
            modalUser.textContent = userName;
        }

        if (modalTime) {
            const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
            modalTime.textContent = formatTimestamp(timestamp);
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
         * 初期化
         */
        init() {
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
            }

            // キーボードイベント
            document.addEventListener('keydown', (e) => {
                const modal = document.getElementById('photoModal');
                if (!modal || !modal.classList.contains('active')) return;

                if (e.key === 'Escape') {
                    closeModal();
                } else if (e.key === 'ArrowLeft') {
                    prevPhoto();
                } else if (e.key === 'ArrowRight') {
                    nextPhoto();
                }
            });

            // 初回データ取得
            fetchGalleryPhotos();

            // 自動更新開始
            this.startAutoRefresh();
        },

        /**
         * 手動更新
         */
        async manualRefresh() {
            if (isRefreshing) return;

            isRefreshing = true;
            const btn = document.getElementById('galleryRefreshBtn');
            if (btn) btn.disabled = true;

            await fetchGalleryPhotos();

            const timeout = CONFIG && CONFIG.REFRESH_TIMEOUT ? CONFIG.REFRESH_TIMEOUT : 2000;

            setTimeout(() => {
                isRefreshing = false;
                if (btn) btn.disabled = false;
            }, timeout);
        },

        /**
         * 自動更新を開始
         */
        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            
            const interval = (CONFIG && CONFIG.AUTO_REFRESH_INTERVAL) ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
            
            autoRefreshInterval = setInterval(() => fetchGalleryPhotos(), interval);
        },

        /**
         * 自動更新を停止
         */
        stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        },

        /**
         * モーダルを開く（外部から呼び出し可能）
         */
        openModal(index) {
            openModal(index);
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    GalleryApp.init();
});

// ページを離れるときに自動更新を停止
window.addEventListener('beforeunload', () => {
    GalleryApp.stopAutoRefresh();
});
