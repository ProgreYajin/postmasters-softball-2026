/**
 * トップページアプリケーション
 * 試合速報サマリー、写真スライダー、大会情報を管理
 */

const IndexApp = (() => {
    // ==================== プライベート変数 ====================
    let currentSlide = 0;
    let sliderInterval = null;
    let galleryPhotos = [];
    let gamesData = null;
    let autoRefreshInterval = null;

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
     * ステータスのクラスを取得
     */
    function getStatusClass(status) {
        if (status === '試合中') return 'playing';
        if (status === '終了') return 'finished';
        return 'waiting';
    }

    /**
     * チーム情報を取得
     */
    function getTeamInfo(game, position) {
        if (!game) return { name: '未定', score: 0 };

        if (position === 'home' || position === 'top') {
            const name = getSafeValue(game, 'homeTeam', 'topTeam', 'team1', 'team');
            const score = getSafeValue(game, 'homeTotal', 'topTotal', 'total');
            return { name: name || '未定', score: score || 0 };
        }

        if (position === 'away' || position === 'bottom') {
            const name = getSafeValue(game, 'awayTeam', 'bottomTeam', 'team2', 'team');
            const score = getSafeValue(game, 'awayTotal', 'bottomTotal', 'total');
            return { name: name || '未定', score: score || 0 };
        }

        return { name: '未定', score: 0 };
    }

    // ==================== スライダー機能 ====================

    /**
     * スライダーのドットを初期化
     */
    function initSlider(photoCount = 1) {
        const dots = document.getElementById('sliderDots');
        dots.innerHTML = '';

        for (let i = 0; i < photoCount; i++) {
            const dot = document.createElement('div');
            dot.className = `dot ${i === 0 ? 'active' : ''}`;
            dot.onclick = () => goToSlide(i);
            dots.appendChild(dot);
        }

        // 自動スライド（5秒ごと）
        if (sliderInterval) clearInterval(sliderInterval);
        if (photoCount > 1) {
            sliderInterval = setInterval(nextSlide, 5000);
        }
    }

    /**
     * 次のスライドへ
     */
    function nextSlide() {
        const slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;

        const dots = document.querySelectorAll('.dot');
        currentSlide = (currentSlide + 1) % slides.length;
        document.getElementById('sliderTrack').style.transform = `translateX(-${currentSlide * 100}%)`;
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentSlide);
        });
    }

    /**
     * 指定したスライドへ
     */
    function goToSlide(index) {
        const slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;

        const dots = document.querySelectorAll('.dot');
        currentSlide = index;
        document.getElementById('sliderTrack').style.transform = `translateX(-${currentSlide * 100}%)`;
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentSlide);
        });
    }

    /**
     * ギャラリー写真でスライダーを更新
     */
    function updateGallerySlider(photos) {
        const sliderTrack = document.getElementById('sliderTrack');
        const photosToShow = photos.slice(0, 5); // 最新5枚

        sliderTrack.innerHTML = '';

        if (photosToShow.length === 0) {
            sliderTrack.innerHTML = `
                <div class="slide placeholder">
                    <div class="slide-content">📷</div>
                    <div class="slider-overlay">
                        <div class="slider-title">フォトギャラリー</div>
                        <div class="slider-subtitle">まだ写真が投稿されていません</div>
                    </div>
                </div>
            `;
            initSlider(1);
            return;
        }

        photosToShow.forEach(photo => {
            const slide = document.createElement('div');
            slide.className = 'slide';
            slide.style.cursor = 'pointer';
            slide.onclick = () => {
                // ギャラリーページへ遷移（両APIをパラメータに含める）
                const params = new URLSearchParams();
                if (CONFIG.STAFF_API_URL && CONFIG.isStaffApiConfigured()) {
                    params.set('api', CONFIG.STAFF_API_URL);
                }
                if (CONFIG.AUDIENCE_API_URL && CONFIG.isAudienceApiConfigured()) {
                    params.set('audience_api', CONFIG.AUDIENCE_API_URL);
                }
                window.location.href = `gallery.html?${params.toString()}`;
            };

            const img = document.createElement('img');
            img.src = getSafeValue(photo, 'thumbnail', 'Thumbnail') || getSafeValue(photo, 'fullImage', 'FullImage') || '';
            img.alt = '大会写真';
            img.loading = 'eager';
            img.onerror = function() {
                slide.innerHTML = '<div class="slide placeholder"><div class="slide-content">📷</div></div>';
            };
            slide.appendChild(img);

            const overlay = document.createElement('div');
            overlay.className = 'slider-overlay';
            const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
            overlay.innerHTML = `
                <div class="slider-title">大会写真ギャラリー</div>
                <div class="slider-subtitle">${escapeHtml(timestamp)} 投稿</div>
            `;
            slide.appendChild(overlay);

            sliderTrack.appendChild(slide);
        });

        initSlider(photosToShow.length);
    }

    // ==================== データ取得 ====================

    /**
     * スコアボードデータを取得
     */
    async function fetchScores() {
        if (!CONFIG.isApiConfigured()) {
            showEmptyContent('API URLが設定されていません。');
            return;
        }

        try {
            const timestamp = new Date().getTime();
            const url = `${CONFIG.API_URL}?t=${timestamp}`;

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const data = await response.json();
            gamesData = data;
            renderScoresSummary(data);

        } catch (error) {
            console.error('データ取得エラー:', error);
            showEmptyContent('試合データの読み込みに失敗しました。');
        }
    }

    /**
     * ギャラリー写真を取得（観客用API使用）
     */
    async function fetchGalleryPhotos() {
        // 観客用APIを優先使用、なければスタッフAPIを代替
        const apiUrl = CONFIG.AUDIENCE_API_URL || CONFIG.STAFF_API_URL;
        
        if (!apiUrl || !CONFIG.isAudienceApiConfigured()) {
            // 観客APIが設定されていない場合はスキップ
            return;
        }

        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`${apiUrl}?t=${timestamp}`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (!response.ok) return;

            const data = await response.json();
            const photos = getSafeValue(data, 'photos', 'Photos') || [];

            if (Array.isArray(photos) && photos.length > 0) {
                galleryPhotos = photos;
                updateGallerySlider(photos);
            }

        } catch (error) {
            console.error('ギャラリー写真取得エラー:', error);
            // エラーは無視（スライダーはプレースホルダーで表示）
        }
    }

    // ==================== レンダリング ====================

    /**
     * 試合速報サマリーを表示
     */
    function renderScoresSummary(data) {
        const games = getSafeValue(data, 'games') || [];

        if (!Array.isArray(games) || games.length === 0) {
            showEmptyContent('試合データがありません。');
            return;
        }

        // 試合番号でグループ化
        const gameGroups = {};
        games.forEach(game => {
            const gameNum = getSafeValue(game, 'gameNum', 'gameNumber', 'game_num');
            if (!gameNum) return;

            const key = String(gameNum);
            if (!gameGroups[key]) {
                gameGroups[key] = [];
            }
            gameGroups[key].push(game);
        });

        if (Object.keys(gameGroups).length === 0) {
            showEmptyContent('有効な試合データが見つかりません。');
            return;
        }

        // 最新3試合を表示
        const contentHtml = Object.entries(gameGroups)
            .sort(([a], [b]) => parseInt(b) - parseInt(a)) // 降順：最新から
            .slice(0, 3) // 最新3試合
            .reverse() // 昇順に戻す：古い→新しい
            .map(([gameNum, gameList]) => renderCompactGameCard(gameList, parseInt(gameNum)))
            .join('');

        document.getElementById('content').innerHTML = contentHtml || 
            `<div class="loading">試合データを処理中...</div>`;
    }

    /**
     * コンパクト試合カード（トップページ用）
     */
    function renderCompactGameCard(games, gameNum) {
        if (games.length < 2) return '';

        const game1 = games[0];
        const game2 = games[1];
        const status = getSafeValue(game1, 'status', 'Status', 'STATUS') || '待機';
        const statusClass = getStatusClass(status);

        const team1 = getTeamInfo(game1, 'home');
        const team2 = getTeamInfo(game2, 'away');
        const court = getSafeValue(game1, 'court', 'Court', 'COURT');

        // トップページではクリック時に詳細ページへ
        return `
            <div class="game-section" onclick="window.location.href='scoreboard.html';">
                <div class="game-section-header">
                    <div class="game-title">${court}コート 第${gameNum}試合</div>
                    <div class="status-badge ${statusClass}">${escapeHtml(status)}</div>
                </div>
                <div class="score-summary">
                    <div class="score-line">
                        <span class="team-name">${escapeHtml(team1.name)}</span>
                        <span class="team-score">${team1.score}</span>
                        <span class="score-separator">-</span>
                        <span class="team-score">${team2.score}</span>
                        <span class="team-name">${escapeHtml(team2.name)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 空コンテンツメッセージ
     */
    function showEmptyContent(message) {
        document.getElementById('content').innerHTML = `
            <div class="loading">
                ${message}
            </div>
        `;
    }

    // ==================== パブリックAPI ====================

    return {
        /**
         * 初期化
         */
        init() {
            // 初回データ取得
            fetchScores();
            fetchGalleryPhotos();

            // 自動更新開始
            this.startAutoRefresh();
        },

        /**
         * 自動更新を開始
         */
        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            autoRefreshInterval = setInterval(() => {
                fetchScores();
                fetchGalleryPhotos();
            }, CONFIG.AUTO_REFRESH_INTERVAL);
        },

        /**
         * 自動更新を停止
         */
        stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            if (sliderInterval) {
                clearInterval(sliderInterval);
                sliderInterval = null;
            }
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    IndexApp.init();
});

// ページを離れるときに自動更新を停止
window.addEventListener('beforeunload', () => {
    IndexApp.stopAutoRefresh();
});
