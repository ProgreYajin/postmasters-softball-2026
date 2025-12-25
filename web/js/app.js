/**
 * ソフトボール試合速報 - メインアプリケーション
 * スプレッドシート（Google Apps Script）からのデータ取得・表示を担当
 */

const App = (() => {
    // ==================== プライベート変数 ====================
    let currentCourt = null;
    let gamesData = null;
    let autoRefreshInterval = null;
    let isRefreshing = false;

    // ==================== ユーティリティ関数 ====================

    /**
     * JSONキーの値を安全に取得（大文字小文字両対応）
     * @param {object} obj - 対象オブジェクト
     * @param {string} keyVariants - キーのバリエーション（'court', 'Court', 'COURT'など）
     * @returns {*} キーが見つかった場合は値、見つからない場合はundefined
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
     * 日時をフォーマット（複数形式に対応）
     */
    function formatTimestamp(timestamp) {
        if (!timestamp) return '';

        if (typeof timestamp === 'number') {
            // Excelシリアル値（小数）の場合
            const totalMinutes = Math.round(timestamp * 24 * 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        if (typeof timestamp === 'string') {
            // ISO形式の場合
            if (timestamp.includes('T')) {
                try {
                    const date = new Date(timestamp);
                    const jstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
                    const hours = jstDate.getUTCHours();
                    const minutes = jstDate.getUTCMinutes();
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                } catch (e) {
                    console.error('時刻パースエラー:', e);
                }
            }

            // HH:MM形式の場合
            if (/^\d{1,2}:\d{2}$/.test(timestamp)) {
                const [h, m] = timestamp.split(':');
                return `${String(h).padStart(2, '0')}:${m}`;
            }

            return timestamp;
        }

        return '';
    }

    /**
     * HTMLエスケープ（XSS対策）
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * チーム情報を取得（キーのゆらぎに対応）
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

    // ==================== データ取得 ====================

    /**
     * APIからスコアボードデータを取得
     */
    async function fetchScores() {
        if (!CONFIG.isApiConfigured()) {
            showErrorMessage(
                '⚠️ API URLが設定されていません。' +
                '<br>URLパラメータに ?api=YOUR_API_URL を追加するか、' +
                'js/config.jsのAPI_URLを設定してください。'
            );
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
            renderGames(data);

        } catch (error) {
            console.error('データ取得エラー:', error);
            showErrorMessage(`データの読み込みに失敗しました: ${error.message}`);
        }
    }

    // ==================== レンダリング ====================

    /**
     * 試合データをUIに表示
     */
    function renderGames(data) {
        const games = getSafeValue(data, 'games') || [];

        if (!Array.isArray(games) || games.length === 0) {
            showEmptyMessage('試合データがありません。');
            return;
        }

        // コート情報を自動抽出してタブを生成
        const courts = extractCourts(games);
        if (courts.length === 0) {
            showEmptyMessage('有効なコート情報が見つかりません。');
            return;
        }

        // 前回選択されたコートを復元、なければ最初のコートを選択
        if (!currentCourt || !courts.includes(currentCourt)) {
            currentCourt = courts[0];
        }

        // タブを描画
        renderTabs(courts);

        // 選択されたコートのデータだけを表示
        renderGamesByCourtFiltered(games, currentCourt);
    }

    /**
     * コート名を自動抽出
     */
    function extractCourts(games) {
        const courts = new Set();
        games.forEach(game => {
            const court = getSafeValue(game, 'court', 'Court', 'COURT');
            if (court) courts.add(court);
        });
        return Array.from(courts).sort();
    }

    /**
     * タブを描画
     */
    function renderTabs(courts) {
        const tabsContainer = document.getElementById('tabs');
        tabsContainer.innerHTML = '';

        courts.forEach(court => {
            const button = document.createElement('button');
            button.className = `tab ${court === currentCourt ? 'active' : ''}`;
            button.textContent = `${court}コート`;
            button.onclick = () => switchCourt(court);
            tabsContainer.appendChild(button);
        });
    }

    /**
     * コートを切り替え
     */
    function switchCourt(court) {
        currentCourt = court;
        localStorage.setItem(CONFIG.STORAGE_KEY.CURRENT_COURT, court);

        // タブのアクティブ状態を更新
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.textContent.startsWith(court));
        });

        // 試合データを再描画
        if (gamesData) {
            const games = getSafeValue(gamesData, 'games') || [];
            renderGamesByCourtFiltered(games, court);
        }
    }

    /**
     * コートでフィルタリングして試合を描画
     */
    function renderGamesByCourtFiltered(games, court) {
        const filteredGames = games.filter(game => {
            const gameCourt = getSafeValue(game, 'court', 'Court', 'COURT');
            return gameCourt === court;
        });

        if (filteredGames.length === 0) {
            showEmptyMessage(`${court}コートに試合データがありません。`);
            return;
        }

        // 試合番号でグループ化
        const gameGroups = {};
        filteredGames.forEach(game => {
            const gameNum = getSafeValue(game, 'gameNum', 'gameNumber', 'game_num');
            if (!gameNum) return;

            const key = String(gameNum);
            if (!gameGroups[key]) {
                gameGroups[key] = [];
            }
            gameGroups[key].push(game);
        });

        // HTML生成
        const contentHtml = Object.entries(gameGroups)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([gameNum, gameList]) => renderGameCard(gameList, parseInt(gameNum)))
            .join('');

        document.getElementById('content').innerHTML = contentHtml || 
            `<div class="loading">試合データを処理中...</div>`;
    }

    /**
     * 試合カードを生成
     */
    function renderGameCard(games, gameNum) {
        if (games.length < 2) return '';

        const game1 = games[0];
        const game2 = games[1];
        const status = getSafeValue(game1, 'status', 'Status', 'STATUS') || '待機';
        const statusClass = getStatusClass(status);

        const team1 = getTeamInfo(game1, 'home');
        const team2 = getTeamInfo(game2, 'away');

        const court = getSafeValue(game1, 'court', 'Court', 'COURT');

        // プレースホルダー判定
        const team1IsPlaceholder = CONFIG.isPlaceholder(team1.name);
        const team2IsPlaceholder = CONFIG.isPlaceholder(team2.name);

        // イニングデータ取得
        const innings = getInnings(game1, game2);

        // HTML生成
        let html = `
            <div class="game-section" onclick="App.openScoreboard('${escapeHtml(court)}', ${gameNum})">
                <div class="game-section-header">
                    <div class="game-title">${court}コート 第${gameNum}試合</div>
                    <div class="status-badge ${statusClass}">${escapeHtml(status)}</div>
                </div>
        `;

        // 待機中で得点がない場合
        if (status === '待機' && (!innings || innings.length === 0 || innings.every(s => !s))) {
            html += `
                <div class="status-message">
                    <div class="status-message-icon">⏰</div>
                    <div class="status-message-text">まだ試合が始まっていません</div>
                    <div class="status-message-subtext ${team1IsPlaceholder || team2IsPlaceholder ? 'placeholder' : ''}">
                        ${escapeHtml(team1.name)} vs ${escapeHtml(team2.name)}
                    </div>
                </div>
            `;
        } else {
            // スコアボード表示
            html += renderScoreboard(team1, team2, innings);
        }

        html += '</div>';
        return html;
    }

    /**
     * スコアボード（テーブル）を生成
     */
    function renderScoreboard(team1, team2, innings) {
        const inningsCount = innings.length || CONFIG.MAX_INNINGS;

        let html = `
            <div class="scoreboard-wrapper">
                <div class="scoreboard">
                    <table>
                        <thead>
                            <tr>
                                <th class="team-header">チーム</th>
        `;

        // イニング列を追加
        for (let i = 1; i <= inningsCount; i++) {
            html += `<th>${i}</th>`;
        }

        html += `
                                <th>合計</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="team-name ${CONFIG.isPlaceholder(team1.name) ? 'placeholder' : ''}">
                                    ${escapeHtml(team1.name)}
                                </td>
        `;

        // team1の得点
        for (let i = 0; i < inningsCount; i++) {
            const score = innings[i]?.[0];
            html += getScoreCellHtml(score);
        }

        html += `
                                <td class="total">${team1.score}</td>
                            </tr>
                            <tr>
                                <td class="team-name ${CONFIG.isPlaceholder(team2.name) ? 'placeholder' : ''}">
                                    ${escapeHtml(team2.name)}
                                </td>
        `;

        // team2の得点
        for (let i = 0; i < inningsCount; i++) {
            const score = innings[i]?.[1];
            html += getScoreCellHtml(score);
        }

        html += `
                                <td class="total">${team2.score}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        return html;
    }

    /**
     * スコアセルのHTMLを取得
     */
    function getScoreCellHtml(score) {
        if (score === null || score === undefined || score === '') {
            return '<td class="score-empty">-</td>';
        }
        if (score === 0 || score === '0') {
            return '<td class="score-zero">0</td>';
        }
        return `<td class="score-positive">${score}</td>`;
    }

    /**
     * イニング別得点データを取得
     */
    function getInnings(game1, game2) {
        const inningsArray = [];

        const game1Innings = getSafeValue(game1, 'innings', 'Innings', 'INNINGS') || [];
        const game2Innings = getSafeValue(game2, 'innings', 'Innings', 'INNINGS') || [];

        const maxInnings = Math.max(
            Array.isArray(game1Innings) ? game1Innings.length : 0,
            Array.isArray(game2Innings) ? game2Innings.length : 0,
            CONFIG.MAX_INNINGS
        );

        for (let i = 0; i < maxInnings; i++) {
            inningsArray.push([
                Array.isArray(game1Innings) ? game1Innings[i] : undefined,
                Array.isArray(game2Innings) ? game2Innings[i] : undefined
            ]);
        }

        return inningsArray;
    }

    /**
     * ステータスのクラスを取得
     */
    function getStatusClass(status) {
        if (status === '試合中') return 'playing';
        if (status === '終了') return 'finished';
        return 'waiting';
    }

    // ==================== UI ヘルパー ====================

    /**
     * エラーメッセージを表示
     */
    function showErrorMessage(message) {
        document.getElementById('content').innerHTML = `
            <div class="loading" style="color: #d32f2f;">
                ${message}
            </div>
        `;
    }

    /**
     * 空データメッセージを表示
     */
    function showEmptyMessage(message) {
        document.getElementById('content').innerHTML = `
            <div class="loading">
                ${message}
            </div>
        `;
    }

    // ==================== パブリックAPI ====================

    return {
        /**
         * アプリケーションを初期化
         */
        init() {
            // 前回選択されたコートを復元
            const savedCourt = localStorage.getItem(CONFIG.STORAGE_KEY.CURRENT_COURT);
            if (savedCourt) currentCourt = savedCourt;

            // 更新ボタンのイベント設定
            const refreshBtn = document.getElementById('refreshBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.manualRefresh());
            }

            // 初回データ取得
            fetchScores();

            // 自動更新の開始
            this.startAutoRefresh();
        },

        /**
         * 手動更新
         */
        async manualRefresh() {
            if (isRefreshing) return;

            isRefreshing = true;
            const btn = document.getElementById('refreshBtn');
            if (btn) btn.disabled = true;

            await fetchScores();

            setTimeout(() => {
                isRefreshing = false;
                if (btn) btn.disabled = false;
            }, CONFIG.REFRESH_TIMEOUT);
        },

        /**
         * 自動更新を開始
         */
        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            autoRefreshInterval = setInterval(() => fetchScores(), CONFIG.AUTO_REFRESH_INTERVAL);
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
         * スコアボード詳細画面を開く（拡張用）
         */
        openScoreboard(court, gameNum) {
            // 今後の拡張用：詳細ページへのナビゲーションなど
            console.log(`スコアボード詳細: ${court}コート 第${gameNum}試合`);
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// ページを離れるときに自動更新を停止
window.addEventListener('beforeunload', () => {
    App.stopAutoRefresh();
});
