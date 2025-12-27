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

    function initSlider(photoCount = 1) {
        const dots = document.getElementById('sliderDots');
        if (!dots) return;
        
        dots.innerHTML = '';

        for (let i = 0; i < photoCount; i++) {
            const dot = document.createElement('div');
            dot.className = `dot ${i === 0 ? 'active' : ''}`;
            dot.onclick = () => goToSlide(i);
            dots.appendChild(dot);
        }

        if (sliderInterval) clearInterval(sliderInterval);
        if (photoCount > 1) {
            sliderInterval = setInterval(nextSlide, 5000);
        }
    }

    function nextSlide() {
        const slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;

        const dots = document.querySelectorAll('.dot');
        currentSlide = (currentSlide + 1) % slides.length;
        
        const track = document.getElementById('sliderTrack');
        if (track) {
            track.style.transform = `translateX(-${currentSlide * 100}%)`;
        }
        
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentSlide);
        });
    }

    function goToSlide(index) {
        const slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;

        const dots = document.querySelectorAll('.dot');
        currentSlide = index;
        
        const track = document.getElementById('sliderTrack');
        if (track) {
            track.style.transform = `translateX(-${currentSlide * 100}%)`;
        }
        
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentSlide);
        });
    }

    function updateGallerySlider(photos) {
        const sliderTrack = document.getElementById('sliderTrack');
        if (!sliderTrack) return;
        
        const photosToShow = photos.slice(0, 5);
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
            slide.onclick = () => { window.location.href = 'gallery.html'; };

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

    async function fetchScores() {
        if (!window.CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
            showEmptyContent('API URLが設定されていません。');
            return;
        }

        try {
            const timestamp = new Date().getTime();
            const url = `${CONFIG.STAFF_API_URL}?t=${timestamp}`;
            const response = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-cache' });

            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

            const data = await response.json();
            gamesData = data;
            renderScoresSummary(data);
        } catch (error) {
            console.error('データ取得エラー:', error);
            showEmptyContent('試合データの読み込みに失敗しました。');
        }
    }

    async function fetchGalleryPhotos() {
        if (!window.CONFIG || !CONFIG.isAudienceApiConfigured || !CONFIG.isAudienceApiConfigured()) return;

        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`${CONFIG.AUDIENCE_API_URL}?t=${timestamp}`, {
                method: 'GET', mode: 'cors', cache: 'no-cache'
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
        }
    }

    // ==================== レンダリング ====================

    function renderScoresSummary(data) {
        const games = getSafeValue(data, 'games') || [];
        if (!Array.isArray(games) || games.length === 0) {
            showNextGameInfo();
            return;
        }

        const gameGroups = {};
        games.forEach(game => {
            const gameNum = getSafeValue(game, 'gameNum', 'gameNumber', 'game_num');
            if (!gameNum) return;
            const key = String(gameNum);
            if (!gameGroups[key]) gameGroups[key] = [];
            gameGroups[key].push(game);
        });

        const liveGames = Object.entries(gameGroups)
            .filter(([num, list]) => {
                const status = getSafeValue(list[0], 'status', 'Status', 'STATUS') || '待機';
                return status === '試合中';
            })
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        if (liveGames.length === 0) {
            showNextGameInfo(gameGroups);
            return;
        }

        let contentHtml = liveGames.map(([num, list]) => renderLiveGameCard(list, parseInt(num))).join('');
        const nextGameHtml = renderNextGameCard(gameGroups);
        if (nextGameHtml) contentHtml += nextGameHtml;

        document.getElementById('content').innerHTML = contentHtml;
    }

    function renderLiveGameCard(games, gameNum) {
        if (games.length < 2) return '';
        const game1 = games[0];
        const game2 = games[1];
        const status = getSafeValue(game1, 'status', 'Status', 'STATUS') || '待機';
        const team1 = getTeamInfo(game1, 'home');
        const team2 = getTeamInfo(game2, 'away');
        const court = getSafeValue(game1, 'court', 'Court', 'COURT');

        const innings1 = getSafeValue(game1, 'innings') || [];
        const innings2 = getSafeValue(game2, 'innings') || [];
        let currentInning = '';
        for (let i = innings1.length - 1; i >= 0; i--) {
            if (innings1[i] !== null || innings2[i] !== null) {
                currentInning = `${i + 1}回`;
                break;
            }
        }

        return `
            <div class="game-section" onclick="window.location.href='scoreboard.html';">
                <div class="game-section-header">
                    <div class="game-title">${court}コート 第${gameNum}試合</div>
                    <div class="status-badge ${getStatusClass(status)}">${escapeHtml(status)}</div>
                </div>
                <div class="score-summary">
                    <div class="score-display">
                        <div class="team-side"><div class="team-name-compact">${escapeHtml(team1.name)}</div></div>
                        <div class="score-section">
                            <div class="score-numbers">
                                <span class="team-score-compact">${team1.score}</span>
                                <span class="score-separator-compact">-</span>
                                <span class="team-score-compact">${team2.score}</span>
                            </div>
                            ${currentInning ? `<div class="current-inning">${currentInning}</div>` : ''}
                        </div>
                        <div class="team-side"><div class="team-name-compact">${escapeHtml(team2.name)}</div></div>
                    </div>
                </div>
            </div>`;
    }

    function renderNextGameCard(gameGroups) {
        const waitingGames = Object.entries(gameGroups)
            .filter(([num, list]) => (getSafeValue(list[0], 'status') || '待機') === '待機')
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        if (waitingGames.length === 0) {
            return `<div class="next-game-card"><div class="next-game-title">全試合終了</div></div>`;
        }

        const [nextNum, nextList] = waitingGames[0];
        const team1 = getTeamInfo(nextList[0], 'home');
        const team2 = getTeamInfo(nextList[1], 'away');
        return `
            <div class="next-game-card">
                <div class="next-game-title">次の試合</div>
                <div class="next-game-teams">${escapeHtml(team1.name)} vs ${escapeHtml(team2.name)}</div>
                <div class="next-game-info">${getSafeValue(nextList[0], 'court')}コート 第${nextNum}試合</div>
            </div>`;
    }

    function showNextGameInfo(gameGroups = null) {
        const content = document.getElementById('content');
        if (!gameGroups) {
            content.innerHTML = `<div class="next-game-card">現在試合はありません</div>`;
            return;
        }
        content.innerHTML = renderNextGameCard(gameGroups);
    }

    function showEmptyContent(message) {
        const content = document.getElementById('content');
        if (content) content.innerHTML = `<div class="loading">${message}</div>`;
    }

    // ==================== パブリックAPI ====================
    return {
        init() {
            fetchScores();
            fetchGalleryPhotos();
            this.startAutoRefresh();
        },
        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            const interval = (window.CONFIG && CONFIG.AUTO_REFRESH_INTERVAL) ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
            autoRefreshInterval = setInterval(() => {
                fetchScores();
                fetchGalleryPhotos();
            }, interval);
        },
        stopAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            if (sliderInterval) clearInterval(sliderInterval);
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    IndexApp.init();
});

window.addEventListener('beforeunload', () => {
    IndexApp.stopAutoRefresh();
});
