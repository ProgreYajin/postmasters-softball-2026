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
        if (!dots) return;
        
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
        
        const track = document.getElementById('sliderTrack');
        if (track) {
            track.style.transform = `translateX(-${currentSlide * 100}%)`;
        }
        
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
        
        const track = document.getElementById('sliderTrack');
        if (track) {
            track.style.transform = `translateX(-${currentSlide * 100}%)`;
        }
        
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentSlide);
        });
    }

    /**
     * ギャラリー写真でスライダーを更新
     */
    function updateGallerySlider(photos) {
        const sliderTrack = document.getElementById('sliderTrack');
        if (!sliderTrack) return;
        
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
                window.location.href = 'gallery.html';
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
            
            // タイムスタンプをyyyy/mm/dd形式に変換
            const timestamp = getSafeValue(photo, 'timestamp', 'Timestamp') || '';
            let formattedTime = '';
            if (timestamp) {
                try {
                    const date = new Date(timestamp);
                    if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        formattedTime = `${year}/${month}/${day}`;
                    } else {
                        formattedTime = timestamp;
                    }
                } catch (e) {
                    formattedTime = timestamp;
                }
            }
            
            overlay.innerHTML = `
                <div class="slider-title">大会写真ギャラリー</div>
                <div class="slider-subtitle">${formattedTime ? escapeHtml(formattedTime) + ' 投稿' : ''}</div>
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
        if (!CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
            showEmptyContent('API URLが設定されていません。');
            return;
        }

        try {
            const timestamp = new Date().getTime();
            
            // スコアボードデータを取得
            const scoreUrl = `${CONFIG.STAFF_API_URL}?t=${timestamp}`;
            const scoreResponse = await fetch(scoreUrl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (!scoreResponse.ok) {
                throw new Error(`HTTP Error ${scoreResponse.status}`);
            }

            const scoreData = await scoreResponse.json();
            
            // 試合予定データを取得
            const scheduleUrl = `${CONFIG.STAFF_API_URL}?type=schedule&t=${timestamp}`;
            const scheduleResponse = await fetch(scheduleUrl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            
            let scheduleData = {};
            if (scheduleResponse.ok) {
                const scheduleJson = await scheduleResponse.json();
                // 試合番号をキーにした辞書に変換
                if (scheduleJson.schedule && Array.isArray(scheduleJson.schedule)) {
                    scheduleData = scheduleJson.schedule.reduce((acc, game) => {
                        acc[game.gameNum] = game;
                        return acc;
                    }, {});
                }
            }
            
            gamesData = scoreData;
            renderScoresSummary(scoreData, scheduleData);

        } catch (error) {
            console.error('データ取得エラー:', error);
            showEmptyContent('試合データの読み込みに失敗しました。');
        }
    }

    /**
     * ギャラリー写真を取得（観客用API使用）
     */
    async function fetchGalleryPhotos() {
        if (!CONFIG || !CONFIG.isAudienceApiConfigured || !CONFIG.isAudienceApiConfigured()) {
            // 観客APIが設定されていない場合はスキップ
            return;
        }

        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`${CONFIG.AUDIENCE_API_URL}?t=${timestamp}`, {
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
     * 試合速報サマリーを表示（試合中のみ）
     */
    function renderScoresSummary(data, scheduleData = {}) {
        const games = getSafeValue(data, 'games') || [];

        if (!Array.isArray(games) || games.length === 0) {
            showNextGameInfo(null, scheduleData);
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
            showNextGameInfo(null, scheduleData);
            return;
        }

        // 試合中の試合のみ抽出
        const liveGames = Object.entries(gameGroups)
            .filter(([gameNum, gameList]) => {
                if (gameList.length === 0) return false;
                const status = getSafeValue(gameList[0], 'status', 'Status', 'STATUS') || '待機';
                return status === '試合中';
            })
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        let contentHtml = '';

        if (liveGames.length === 0) {
            // 試合中がない場合は次の試合のみ表示
            showNextGameInfo(gameGroups, scheduleData);
            return;
        }

        // 試合中のカードを表示
        contentHtml = liveGames
            .map(([gameNum, gameList]) => renderLiveGameCard(gameList, parseInt(gameNum)))
            .join('');

        // 次の試合カードを追加
        const nextGameHtml = renderNextGameCard(gameGroups, scheduleData);
        if (nextGameHtml) {
            contentHtml += nextGameHtml;
        }

        document.getElementById('content').innerHTML = contentHtml || 
            `<div class="loading">試合データを処理中...</div>`;
    }

    /**
     * 試合中カード（コート名強調版）
     */
    function renderLiveGameCard(games, gameNum) {
        if (games.length < 2) return '';

        const game1 = games[0];
        const game2 = games[1];
        const status = getSafeValue(game1, 'status', 'Status', 'STATUS') || '待機';
        const statusClass = getStatusClass(status);

        const team1 = getTeamInfo(game1, 'home');
        const team2 = getTeamInfo(game2, 'away');
        const court = getSafeValue(game1, 'court', 'Court', 'COURT');

        // 現在のイニング数と表裏を取得
        const innings1 = getSafeValue(game1, 'innings') || [];
        const innings2 = getSafeValue(game2, 'innings') || [];
        let currentInning = '';
        
        // 最後に得点が入ったイニングを探す
        for (let i = innings1.length - 1; i >= 0; i--) {
            const score1 = innings1[i];
            const score2 = innings2[i];
            if ((score1 !== null && score1 !== undefined && score1 !== '') || 
                (score2 !== null && score2 !== undefined && score2 !== '')) {
                // 表裏を判定：先攻チーム(game1)に得点があれば表、後攻チーム(game2)に得点があれば裏
                // 両方に得点がある場合は裏とする（イニングが進んでいるため）
                const topBottom = (score2 !== null && score2 !== undefined && score2 !== '') ? '裏' : '表';
                currentInning = `${i + 1}回${topBottom}`;
                break;
            }
        }
        
        // イニング情報が取得できない場合、lastUpdateやcurrentInningキーから取得を試みる
        if (!currentInning) {
            const inningInfo = getSafeValue(game1, 'currentInning', 'current_inning', 'inning');
            const topBottomInfo = getSafeValue(game1, 'topBottom', 'top_bottom', 'half');
            if (inningInfo) {
                const topBottomText = topBottomInfo === '表' || topBottomInfo === 'top' ? '表' : 
                                     topBottomInfo === '裏' || topBottomInfo === 'bottom' ? '裏' : '';
                currentInning = `${inningInfo}回${topBottomText}`;
            }
        }

        return `
            <div class="game-section" onclick="window.location.href='scoreboard.html';">
                <div class="game-section-header">
                    <div class="game-title">${court}コート 第${gameNum}試合</div>
                    <div class="status-badge ${statusClass}">${escapeHtml(status)}</div>
                </div>
                <div class="score-summary">
                    <div class="score-display">
                        <div class="team-side">${escapeHtml(team1.name)}</div>
                        <div class="score-section">
                            <div class="score-numbers">
                                <span class="team-score-compact">${team1.score}</span>
                                <span class="score-separator-compact">-</span>
                                <span class="team-score-compact">${team2.score}</span>
                            </div>
                            ${currentInning ? `<div class="current-inning">${currentInning}</div>` : ''}
                        </div>
                        <div class="team-side">${escapeHtml(team2.name)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 次の試合カードをレンダリング（インライン表示用）
     */
    function renderNextGameCard(gameGroups, scheduleData = {}) {
        // 待機中の試合を探す
        const waitingGames = Object.entries(gameGroups)
            .filter(([gameNum, gameList]) => {
                if (gameList.length === 0) return false;
                const status = getSafeValue(gameList[0], 'status', 'Status', 'STATUS') || '待機';
                return status === '待機';
            })
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        if (waitingGames.length === 0) {
            // 待機中の試合がない = 全試合終了
            return `
                <div class="next-game-card">
                    <div class="next-game-icon">🏁</div>
                    <div class="next-game-title">全試合終了</div>
                    <div class="next-game-info">ご声援ありがとうございました</div>
                </div>
            `;
        }

        // 次の試合（最初の待機中の試合）
        const [nextGameNum, nextGameList] = waitingGames[0];
        if (nextGameList.length >= 2) {
            const team1 = getTeamInfo(nextGameList[0], 'home');
            const team2 = getTeamInfo(nextGameList[1], 'away');
            const court = getSafeValue(nextGameList[0], 'court', 'Court', 'COURT');
            
            // 試合予定データから開始時刻を取得
            let timeText = '';
            const scheduleGame = scheduleData[nextGameNum];
            if (scheduleGame) {
                const startTime = getSafeValue(scheduleGame, 'time', 'startTime', 'StartTime', 'start_time');
                
                if (startTime) {
                    // 文字列の場合
                    if (typeof startTime === 'string') {
                        // すでに HH:MM 形式の場合
                        if (/^\d{1,2}:\d{2}$/.test(startTime)) {
                            timeText = `${startTime}開始予定`;
                        }
                        // ISO形式の日付文字列の場合
                        else if (startTime.includes('T') || startTime.includes('-')) {
                            try {
                                const date = new Date(startTime);
                                if (!isNaN(date.getTime())) {
                                    const hours = String(date.getHours()).padStart(2, '0');
                                    const minutes = String(date.getMinutes()).padStart(2, '0');
                                    timeText = `${hours}:${minutes}開始予定`;
                                }
                            } catch (e) {
                                // パース失敗時は何もしない
                            }
                        }
                    }
                    // 数値（Unix timestamp、Excel serial）の場合
                    else if (typeof startTime === 'number') {
                        try {
                            // Excelシリアル値の判定（1900年1月1日からの日数）
                            let date;
                            if (startTime > 40000 && startTime < 50000) {
                                // Excelシリアル値 (例: 44000 = 2020年代)
                                date = new Date((startTime - 25569) * 86400 * 1000);
                            } else {
                                // Unix timestamp
                                date = new Date(startTime);
                            }
                            
                            if (!isNaN(date.getTime())) {
                                const hours = String(date.getHours()).padStart(2, '0');
                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                timeText = `${hours}:${minutes}開始予定`;
                            }
                        } catch (e) {
                            // パース失敗時は何もしない
                        }
                    }
                }
            }

            return `
                <div class="next-game-card">
                    <div class="next-game-icon">⏰</div>
                    <div class="next-game-title">次の試合</div>
                    <div class="next-game-teams">${escapeHtml(team1.name)} vs ${escapeHtml(team2.name)}</div>
                    <div class="next-game-info">${court}コート 第${nextGameNum}試合</div>
                    <div class="next-game-time">${timeText || '開始時刻未定'}</div>
                </div>
            `;
        }

        return '';
    }

    /**
     * 次の試合情報を表示（試合中がない場合のみ）
     */
    function showNextGameInfo(gameGroups = null, scheduleData = {}) {
        if (!gameGroups) {
            document.getElementById('content').innerHTML = `
                <div class="next-game-card">
                    <div class="next-game-icon">⏰</div>
                    <div class="next-game-title">現在試合中の試合はありません</div>
                    <div class="next-game-info">次の試合をお待ちください</div>
                </div>
            `;
            return;
        }

        // 次の試合カードを表示
        const nextGameHtml = renderNextGameCard(gameGroups, scheduleData);
        document.getElementById('content').innerHTML = nextGameHtml || `
            <div class="next-game-card">
                <div class="next-game-icon">⏰</div>
                <div class="next-game-title">現在試合中の試合はありません</div>
                <div class="next-game-info">次の試合をお待ちください</div>
            </div>
        `;
    }

    /**
     * 空コンテンツメッセージ
     */
    function showEmptyContent(message) {
        const contentDiv = document.getElementById('content');
        if (!contentDiv) return;
        
        contentDiv.innerHTML = `
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
            
            const interval = (CONFIG && CONFIG.AUTO_REFRESH_INTERVAL) ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
            
            autoRefreshInterval = setInterval(() => {
                fetchScores();
                fetchGalleryPhotos();
            }, interval);
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
