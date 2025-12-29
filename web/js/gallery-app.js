/**
 * 写真ギャラリーアプリケーション
 * 観客用BOTから写真データを取得・表示
 * 
 * @version 2.0.0
 * @description プロフェッショナル版：XSS対策、スワイプ対応、差分更新
 */

const GalleryApp = (() => {
    "use strict";

    // ==================== プライベート変数 ====================
    let photos = [];
    let previousPhotosHash = null;
    let currentPhotoIndex = 0;
    let autoRefreshInterval = null;
    let isRefreshing = false;
    
    let touchStartX = 0;
    let touchEndX = 0;
    const SWIPE_THRESHOLD = 50;

    // ==================== ユーティリティ関数 ====================

    function getSafeValue(obj, ...keyVariants) {
        if (!obj || typeof obj !== "object") return undefined;
        
        for (const key of keyVariants) {
            if (key in obj && obj[key] !== null && obj[key] !== undefined) {
                return obj[key];
            }
        }
        return undefined;
    }

    function escapeHtml(str) {
        if (!str) return "";
        
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function calculateHash(data) {
        if (!Array.isArray(data)) return "";
        
        return data.map(item => {
            const url = getSafeValue(item, "fullImage", "FullImage", "thumbnail", "Thumbnail") || "";
            const timestamp = getSafeValue(item, "timestamp", "Timestamp") || "";
            return url + "-" + timestamp;
        }).join("|");
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return "";
        
        try {
            if (typeof timestamp === "string" && timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                const parts = timestamp.split(" ");
                const datePart = parts[0];
                const timePart = parts[1];
                const dateComponents = datePart.split("-");
                const timeComponents = timePart.split(":");
                const year = dateComponents[0];
                const month = dateComponents[1];
                const day = dateComponents[2];
                const hour = timeComponents[0];
                const minute = timeComponents[1];
                return year + "/" + month + "/" + day + " " + hour + ":" + minute;
            }
            
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                const day = String(date.getDate()).padStart(2, "0");
                const hours = String(date.getHours()).padStart(2, "0");
                const minutes = String(date.getMinutes()).padStart(2, "0");
                return year + "/" + month + "/" + day + " " + hours + ":" + minutes;
            }
        } catch (e) {
            console.error("日時フォーマットエラー:", e);
        }
        
        return escapeHtml(String(timestamp));
    }

    // ==================== データ取得 ====================

    async function fetchGalleryPhotos() {
        console.log("=== 写真取得開始 ===");
        console.log("CONFIG:", CONFIG);
        
        if (!CONFIG) {
            console.error("エラー: CONFIGが定義されていません");
            showEmptyGallery("設定ファイルが読み込まれていません。");
            return;
        }
        
        if (!CONFIG.isAudienceApiConfigured || !CONFIG.isAudienceApiConfigured()) {
            console.error("エラー: 観客用API URLが設定されていません");
            console.log("AUDIENCE_API_URL:", CONFIG.AUDIENCE_API_URL);
            showEmptyGallery("観客用API URLが設定されていません。<br>config.jsを確認してください。");
            return;
        }

        console.log("API URL:", CONFIG.AUDIENCE_API_URL);

        try {
            const timestamp = new Date().getTime();
            const apiUrl = CONFIG.AUDIENCE_API_URL + "?t=" + timestamp;
            console.log("API リクエスト:", apiUrl);
            
            const response = await fetch(apiUrl, {
                method: "GET",
                mode: "cors",
                cache: "no-cache"
            });

            console.log("レスポンス状態:", response.status, response.statusText);

            if (!response.ok) {
                throw new Error("HTTP Error " + response.status + ": " + response.statusText);
            }

            const data = await response.json();
            console.log("取得データ:", data);
            
            const photoData = getSafeValue(data, "photos", "Photos") || [];
            console.log("写真データ配列:", photoData);
            console.log("写真枚数:", photoData.length);

            if (!Array.isArray(photoData)) {
                console.error("エラー: 写真データが配列ではありません:", typeof photoData, photoData);
                showEmptyGallery("写真データの形式が正しくありません。");
                return;
            }

            if (photoData.length === 0) {
                console.log("情報: 写真データが0件です");
                showEmptyGallery("まだ写真が投稿されていません。");
                photos = [];
                previousPhotosHash = null;
                return;
            }

            const newHash = calculateHash(photoData);
            console.log("新しいハッシュ:", newHash);
            console.log("前回のハッシュ:", previousPhotosHash);
            
            if (newHash === previousPhotosHash) {
                console.log("写真データに変更なし。再レンダリングをスキップします。");
                return;
            }

            console.log("写真データが変更されました。レンダリング開始...");
            photos = photoData;
            previousPhotosHash = newHash;
            renderGallery(photoData);
            updatePhotoCount(photoData.length);
            console.log("レンダリング完了");

        } catch (error) {
            console.error("写真取得エラー:", error);
            console.error("エラー詳細:", {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            showEmptyGallery("写真データの読み込みに失敗しました。<br><small>" + escapeHtml(error.message) + "</small>");
        }
    }

    // ==================== レンダリング ====================

    function renderGallery(photoData) {
        const galleryGrid = document.getElementById("galleryGrid");
        if (!galleryGrid) return;

        const fragment = document.createDocumentFragment();

        photoData.forEach((photo, index) => {
            const userName = escapeHtml(getSafeValue(photo, "userName", "UserName") || "投稿者");
            const timestamp = getSafeValue(photo, "timestamp", "Timestamp") || "";
            const thumbnailUrl = getSafeValue(photo, "thumbnail", "Thumbnail") || getSafeValue(photo, "fullImage", "FullImage") || "";
            
            const formattedTime = formatTimestamp(timestamp);

            const card = document.createElement("div");
            card.className = "photo-card";
            card.setAttribute("role", "button");
            card.setAttribute("tabindex", "0");
            card.setAttribute("aria-label", userName + "の写真を拡大表示");
            card.onclick = () => openModal(index);
            card.onkeypress = (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openModal(index);
                }
            };

            const imageWrapper = document.createElement("div");
            imageWrapper.className = "photo-image-wrapper";

            const img = document.createElement("img");
            img.className = "photo-image loading";
            img.src = escapeHtml(thumbnailUrl);
            img.alt = userName + "の投稿写真";
            img.loading = "lazy";
            
            img.onload = () => {
                img.classList.remove("loading");
            };
            
            img.onerror = () => {
                img.style.display = "none";
                const placeholder = document.createElement("div");
                placeholder.className = "photo-placeholder";
                placeholder.textContent = "📷";
                imageWrapper.appendChild(placeholder);
            };

            imageWrapper.appendChild(img);
            card.appendChild(imageWrapper);

            const info = document.createElement("div");
            info.className = "photo-info";

            const userDiv = document.createElement("div");
            userDiv.className = "photo-user";
            userDiv.textContent = userName;

            const timeDiv = document.createElement("div");
            timeDiv.className = "photo-time";
            timeDiv.textContent = formattedTime;

            info.appendChild(userDiv);
            info.appendChild(timeDiv);
            card.appendChild(info);

            fragment.appendChild(card);
        });

        galleryGrid.innerHTML = "";
        galleryGrid.appendChild(fragment);
    }

    function showEmptyGallery(message) {
        const galleryGrid = document.getElementById("galleryGrid");
        if (!galleryGrid) return;

        const safeMessage = escapeHtml(message);
        
        galleryGrid.innerHTML = '<div class="gallery-empty"><div class="gallery-empty-icon">📷</div><div class="gallery-empty-text">' + safeMessage + '</div><div class="gallery-empty-subtext">写真が投稿されるとここに表示されます</div></div>';
        
        updatePhotoCount(0);
    }

    function updatePhotoCount(count) {
        const photoCount = document.getElementById("photoCount");
        if (photoCount) {
            photoCount.textContent = count;
        }
    }

    // ==================== モーダル機能 ====================

    function openModal(index) {
        if (!photos || photos.length === 0) return;
        
        currentPhotoIndex = index;
        const modal = document.getElementById("photoModal");
        
        if (!modal) return;
        
        updateModalContent();
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
        
        modal.focus();
    }

    function closeModal() {
        const modal = document.getElementById("photoModal");
        if (!modal) return;
        
        modal.classList.remove("active");
        document.body.style.overflow = "";
    }

    function nextPhoto() {
        if (!photos || photos.length === 0) return;
        
        currentPhotoIndex = (currentPhotoIndex + 1) % photos.length;
        updateModalContent();
    }

    function prevPhoto() {
        if (!photos || photos.length === 0) return;
        
        currentPhotoIndex = (currentPhotoIndex - 1 + photos.length) % photos.length;
        updateModalContent();
    }

    function updateModalContent() {
        const photo = photos[currentPhotoIndex];
        if (!photo) return;

        const modalImage = document.getElementById("modalImage");
        const modalUser = document.getElementById("modalUser");
        const modalTime = document.getElementById("modalTime");
        const modalPrev = document.getElementById("modalPrev");
        const modalNext = document.getElementById("modalNext");

        if (modalImage) {
            modalImage.classList.add("loading");
            
            const fullImageUrl = getSafeValue(photo, "fullImage", "FullImage") || getSafeValue(photo, "thumbnail", "Thumbnail") || "";
            
            const newImage = new Image();
            newImage.onload = () => {
                modalImage.src = escapeHtml(fullImageUrl);
                modalImage.classList.remove("loading");
            };
            newImage.onerror = () => {
                modalImage.src = escapeHtml(fullImageUrl);
                modalImage.classList.remove("loading");
            };
            newImage.src = fullImageUrl;
        }

        if (modalUser) {
            const userName = escapeHtml(getSafeValue(photo, "userName", "UserName") || "投稿者");
            modalUser.textContent = userName;
        }

        if (modalTime) {
            const timestamp = getSafeValue(photo, "timestamp", "Timestamp") || "";
            modalTime.textContent = formatTimestamp(timestamp);
        }

        if (modalPrev) {
            modalPrev.disabled = photos.length <= 1;
        }
        
        if (modalNext) {
            modalNext.disabled = photos.length <= 1;
        }
    }

    // ==================== スワイプ検出 ====================

    function handleTouchStart(e) {
        touchStartX = e.changedTouches[0].screenX;
    }

    function handleTouchEnd(e) {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }

    function handleSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        
        if (swipeDistance < -SWIPE_THRESHOLD) {
            nextPhoto();
        } else if (swipeDistance > SWIPE_THRESHOLD) {
            prevPhoto();
        }
    }

    // ==================== ナビゲーションスクロールインジケーター ====================

    function initNavScrollIndicator() {
        const navLinks = document.getElementById("navLinks");
        const navWrapper = document.getElementById("navWrapper");

        if (!navLinks || !navWrapper) return;

        function updateScrollIndicator() {
            const scrollLeft = navLinks.scrollLeft;
            const scrollWidth = navLinks.scrollWidth;
            const clientWidth = navLinks.clientWidth;
            const maxScroll = scrollWidth - clientWidth;

            if (scrollLeft <= 5) {
                navWrapper.classList.add("scroll-start");
                navWrapper.classList.remove("scroll-middle", "scroll-end");
            } else if (scrollLeft >= maxScroll - 5) {
                navWrapper.classList.add("scroll-end");
                navWrapper.classList.remove("scroll-start", "scroll-middle");
            } else {
                navWrapper.classList.add("scroll-middle");
                navWrapper.classList.remove("scroll-start", "scroll-end");
            }
        }

        updateScrollIndicator();
        navLinks.addEventListener("scroll", updateScrollIndicator);
        window.addEventListener("resize", updateScrollIndicator);
    }

    // ==================== パブリックAPI ====================

    return {
        init() {
            console.log("GalleryApp: 初期化開始");
            
            initNavScrollIndicator();

            const refreshBtn = document.getElementById("galleryRefreshBtn");
            if (refreshBtn) {
                refreshBtn.addEventListener("click", () => this.manualRefresh());
            }

            const modalClose = document.getElementById("modalClose");
            if (modalClose) {
                modalClose.addEventListener("click", () => closeModal());
            }

            const modalPrev = document.getElementById("modalPrev");
            if (modalPrev) {
                modalPrev.addEventListener("click", () => prevPhoto());
            }

            const modalNext = document.getElementById("modalNext");
            if (modalNext) {
                modalNext.addEventListener("click", () => nextPhoto());
            }

            const modal = document.getElementById("photoModal");
            if (modal) {
                modal.addEventListener("click", (e) => {
                    if (e.target === modal) {
                        closeModal();
                    }
                });
                
                modal.addEventListener("touchstart", handleTouchStart, { passive: true });
                modal.addEventListener("touchend", handleTouchEnd, { passive: true });
            }

            document.addEventListener("keydown", (e) => {
                const modal = document.getElementById("photoModal");
                if (!modal || !modal.classList.contains("active")) return;

                switch(e.key) {
                    case "Escape":
                        closeModal();
                        break;
                    case "ArrowLeft":
                        prevPhoto();
                        break;
                    case "ArrowRight":
                        nextPhoto();
                        break;
                }
            });

            fetchGalleryPhotos();
            this.startAutoRefresh();
            
            console.log("GalleryApp: 初期化完了");
        },

        async manualRefresh() {
            if (isRefreshing) {
                console.log("GalleryApp: 更新中のため、リクエストをスキップ");
                return;
            }

            isRefreshing = true;
            const btn = document.getElementById("galleryRefreshBtn");
            if (btn) btn.disabled = true;

            console.log("GalleryApp: 手動更新開始");
            await fetchGalleryPhotos();

            const timeout = CONFIG && CONFIG.REFRESH_TIMEOUT ? CONFIG.REFRESH_TIMEOUT : 2000;

            setTimeout(() => {
                isRefreshing = false;
                if (btn) btn.disabled = false;
                console.log("GalleryApp: 手動更新完了");
            }, timeout);
        },

        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            
            const interval = (CONFIG && CONFIG.AUTO_REFRESH_INTERVAL) ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
            
            autoRefreshInterval = setInterval(() => {
                console.log("GalleryApp: 自動更新実行");
                fetchGalleryPhotos();
            }, interval);
            
            console.log("GalleryApp: 自動更新開始 (" + interval + "ms間隔)");
        },

        stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
                console.log("GalleryApp: 自動更新停止");
            }
        },

        openModal(index) {
            openModal(index);
        }
    };
})();

document.addEventListener("DOMContentLoaded", () => {
    GalleryApp.init();
});

window.addEventListener("beforeunload", () => {
    GalleryApp.stopAutoRefresh();
});
