/**
 * トーナメント表アプリケーション（座標ベース・div版）
 * 下から上へ勝ち上がる従来型トーナメント表
 */

const TournamentApp = (() => {
    "use strict";

    // ==================== プライベート変数 ====================
    let gamesData = null;
    let scheduleData = {};
    let tournamentData = null;
    let autoRefreshInterval = null;
    let isRefreshing = false;
    let isDevelopmentMode = window.location.search.includes('dev=true');
    let currentZoom = 0.6;

    const GAME_LABEL_TO_NUM = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7 };
    const CIRCLED_LABELS = { A: 'Ⓐ', B: 'Ⓑ', C: 'Ⓒ', D: 'Ⓓ', E: 'Ⓔ', F: 'Ⓕ', G: 'Ⓖ' };

    // ==================== ユーティリティ関数 ====================
    // getSafeValue, escapeHtml は common.js でグローバル定義済み

    function formatTime(timestamp) {
        if (!timestamp) return '';

        if (typeof timestamp === 'number') {
            const totalMinutes = Math.round(timestamp * 24 * 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        if (typeof timestamp === 'string') {
            if (timestamp.includes('T')) {
                try {
                    const date = new Date(timestamp);
                    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                } catch (e) {
                    return timestamp;
                }
            }
            if (/^\d{1,2}:\d{2}$/.test(timestamp)) {
                const [h, m] = timestamp.split(':');
                return `${String(h).padStart(2, '0')}:${m}`;
            }
            return timestamp;
        }

        return '';
    }

    // ==================== データ取得（並列化による高速化） ====================

    async function fetchTournamentData() {
        if (!CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
            showError('API URLが設定されていません');
            return;
        }

        try {
            const timestamp = new Date().getTime();

            console.log('📄 データ取得開始（並列処理）...');

            const [tournamentResponse, scoreResponse, scheduleResponse] = await Promise.all([
                fetch(`${CONFIG.STAFF_API_URL}?type=tournament&t=${timestamp}`, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache'
                }),
                fetch(`${CONFIG.STAFF_API_URL}?t=${timestamp}`, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache'
                }),
                fetch(`${CONFIG.STAFF_API_URL}?type=schedule&t=${timestamp}`, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache'
                })
            ]);

            if (tournamentResponse.ok) {
                tournamentData = await tournamentResponse.json();

                if (tournamentData.teams && tournamentData.teams.length > 0) {
                    CONFIG.updateTeamCoordinates(tournamentData.teams);
                    console.log('✅ トーナメント表データ取得成功:', tournamentData.teams.length + 'チーム');
                } else {
                    console.warn('⚠️ トーナメント表データが空です。デフォルト値を使用します。');
                }
            } else {
                console.error('⚠️ トーナメント表データ取得失敗。デフォルト値を使用します。');
            }

            if (!scoreResponse.ok) {
                throw new Error(`HTTP Error ${scoreResponse.status}`);
            }
            gamesData = await scoreResponse.json();
            if (gamesData && gamesData.error) {
                console.warn('⚠️ GAS スコアAPIエラー:', gamesData.error);
                gamesData = null;
            }

            if (scheduleResponse.ok) {
                const scheduleJson = await scheduleResponse.json();
                if (scheduleJson && scheduleJson.error) {
                    console.warn('⚠️ GAS スケジュールAPIエラー:', scheduleJson.error);
                } else if (scheduleJson.schedule && Array.isArray(scheduleJson.schedule)) {
                    scheduleData = scheduleJson.schedule.reduce((acc, game) => {
                        acc[game.gameNum] = game;
                        return acc;
                    }, {});
                }
            }

            console.log('✅ 全データ取得完了（並列処理）');
            try {
                renderTournament();
            } catch (renderError) {
                console.error('❌ renderTournament エラー:', renderError, renderError.stack);
                throw renderError;
            }

        } catch (error) {
            console.error('❌ データ取得エラー:', error);
            showError(`データの読み込みに失敗しました: ${error.message}`);
        }
    }

    // ==================== 試合データ取得 ====================

    /**
     * 試合データを取得（スコアボードとスケジュールの両方から）
     * スコアボードのチーム名を優先し、なければスケジュールから取得
     */
    function getMatchData(gameLabel) {
        const gameNum = GAME_LABEL_TO_NUM[gameLabel] !== undefined ? GAME_LABEL_TO_NUM[gameLabel] : gameLabel;

        let team1Name = null;
        let team2Name = null;
        let team1Score = null;
        let team2Score = null;
        let status = '待機';
        let court = '';
        let time = '';

        // 1. スコアボードからデータを取得（チーム名と得点）
        if (gamesData && gamesData.games) {
            const target = Number(gameNum);
            const games = gamesData.games.filter(g =>
                Number(getSafeValue(g, 'gameNum', 'gameNumber', 'game_num')) === target
            );

            if (games.length >= 2) {
                team1Name = getSafeValue(games[0], 'team', 'homeTeam', 'topTeam');
                team2Name = getSafeValue(games[1], 'team', 'awayTeam', 'bottomTeam');
                team1Score = getSafeValue(games[0], 'total', 'homeTotal', 'topTotal') || 0;
                team2Score = getSafeValue(games[1], 'total', 'awayTotal', 'bottomTotal') || 0;
                status = getSafeValue(games[0], 'status', 'Status', 'STATUS') || '待機';
                court = getSafeValue(games[0], 'court', 'Court', 'COURT') || '';
            }
        }

        // 2. スケジュールからコート・時間を取得
        if (scheduleData[gameNum]) {
            court = court || scheduleData[gameNum].court || '';
            time = formatTime(getSafeValue(scheduleData[gameNum], 'time', 'startTime'));

            if (!team1Name) team1Name = scheduleData[gameNum].team1;
            if (!team2Name) team2Name = scheduleData[gameNum].team2;
        }

        // 3. データが何もない場合はnullを返す
        if (!team1Name && !team2Name) {
            return null;
        }

        const displayTeam1 = team1Name || '未定';
        const displayTeam2 = team2Name || '未定';

        return {
            gameLabel: gameLabel,
            gameNum: gameNum,
            court: court,
            time: time,
            status: status,
            team1: { name: displayTeam1, score: team1Score },
            team2: { name: displayTeam2, score: team2Score }
        };
    }

    function getWinner(matchData) {
        if (!matchData || matchData.status !== '終了') return null;
        if (matchData.team1.score > matchData.team2.score) return 1;
        if (matchData.team2.score > matchData.team1.score) return 2;
        return null;
    }

    const ALIVE_LINE_COLOR     = '#c0392b';
    const ALIVE_LINE_THICKNESS = '3px';
    const DIM_LINE_COLOR       = '#cccccc';
    const DIM_LINE_THICKNESS   = '1px';

    function collectMatchResults() {
        const results = [];
        Object.keys(CONFIG.MATCH_COORDINATES).forEach(label => {
            const md = getMatchData(label);
            if (!md) return;
            const w = getWinner(md);
            results.push({
                label,
                team1: md.team1.name,
                team2: md.team2.name,
                winner: w === 1 ? md.team1.name : w === 2 ? md.team2.name : null
            });
        });
        return results;
    }

    function getTeamStatus(teamName, results) {
        if (!teamName || CONFIG.isPlaceholder(teamName)) return 'pending';
        const hasWon  = results.some(r => r.winner === teamName);
        const hasLost = results.some(r =>
            r.winner && r.winner !== teamName &&
            (r.team1 === teamName || r.team2 === teamName)
        );
        if (hasWon && !hasLost) return 'alive';
        if (hasLost) return 'eliminated';
        return 'pending';
    }

    function getMatchWinnerStatus(matchLabel, results) {
        const r = results.find(x => x.label === matchLabel);
        if (!r || !r.winner) return 'pending';
        return getTeamStatus(r.winner, results);
    }

    function lineStyle(status) {
        if (status === 'alive')      return { color: ALIVE_LINE_COLOR, thickness: ALIVE_LINE_THICKNESS };
        if (status === 'eliminated') return { color: DIM_LINE_COLOR,   thickness: DIM_LINE_THICKNESS };
        return { color: null, thickness: null };
    }

    // ==================== レンダリング ====================

    function renderTournament() {
        const container = document.getElementById('tournamentArea');

        if (!CONFIG.TEAM_COORDINATES || Object.keys(CONFIG.TEAM_COORDINATES).length === 0) {
            showError('トーナメント表データが見つかりません');
            return;
        }

        container.innerHTML = '';

        if (isDevelopmentMode) {
            container.appendChild(renderGrid());
            container.appendChild(renderMouseCoords());
            container.appendChild(renderStageGuides());
        }

        // 優勝カードを追加
        const championCard = renderChampionCard();
        if (championCard) {
            container.appendChild(championCard);
        }

        // 3位カードを追加
        const thirdPlaceCard = renderThirdPlaceCard();
        if (thirdPlaceCard) {
            container.appendChild(thirdPlaceCard);
        }

        const matchResults = collectMatchResults();

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameLabel, coords]) => {
            const matchData = getMatchData(gameLabel);
            if (matchData) {
                renderConnectorLines(container, gameLabel, coords, matchResults);
            }
        });

        Object.entries(CONFIG.TEAM_COORDINATES).forEach(([teamName, coords]) => {
            container.appendChild(renderTeamCard(teamName, coords, matchResults));
        });

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameLabel, coords]) => {
            const matchData = getMatchData(gameLabel);
            if (matchData) {
                container.appendChild(renderMatchBlock(matchData, coords, matchResults));
            }
        });

        updateChampion();
        updateThirdPlace();
        initZoomControl();
    }

    // ==================== チームカード描画 ====================

    function renderTeamCard(teamName, coords, results) {
        const card = document.createElement('div');
        card.className = 'team-card';
        if (coords.isSeed) {
            card.classList.add('seed');
        }
        if (results) {
            const status = getTeamStatus(teamName, results);
            if (status === 'alive') card.classList.add('team-alive');
            else if (status === 'eliminated') card.classList.add('team-eliminated');
        }

        // 50px右にオフセット
        card.style.left = (coords.x + 50) + 'px';
        card.style.top = coords.y + 'px';

        const icon = document.createElement('div');
        icon.className = 'team-icon';
        icon.textContent = CONFIG.getTeamIcon(teamName);

        const name = document.createElement('div');
        name.className = 'team-name';
        name.textContent = teamName;

        card.appendChild(icon);
        card.appendChild(name);

        if (coords.side) {
            const sideLabel = document.createElement('div');
            sideLabel.className = 'team-side';
            sideLabel.textContent = coords.side;
            card.appendChild(sideLabel);
        }

        if (coords.isSeed) {
            const seedMark = document.createElement('div');
            seedMark.className = 'seed-mark';
            seedMark.textContent = '⭐';
            card.appendChild(seedMark);
        }

        return card;
    }

    // ==================== 優勝カード描画 ====================

    function renderChampionCard() {
        const finalMatch = CONFIG.MATCH_COORDINATES['G'];
        if (!finalMatch) return null;

        const card = document.createElement('div');
        card.className = 'team-card champion-card';
        card.style.left = (finalMatch.x + 50) + 'px';
        card.style.top = (finalMatch.y - 200) + 'px'; // 決勝戦の200px上

        const icon = document.createElement('div');
        icon.className = 'team-icon';
        icon.textContent = '🏆';
        icon.style.fontSize = '32px';

        const name = document.createElement('div');
        name.className = 'team-name';
        name.textContent = '優勝';
        name.style.fontSize = '18px';
        name.style.fontWeight = 'bold';

        card.appendChild(icon);
        card.appendChild(name);

        return card;
    }

    // ==================== 3位カード描画（tournament-main.js に追加） ====================
    /**
     * 3位カードを描画
     * renderTournament()内で呼び出す
     */
    function renderThirdPlaceCard() {
        const thirdPlaceMatch = CONFIG.MATCH_COORDINATES['F'];
        if (!thirdPlaceMatch) return null;

        const card = document.createElement('div');
        card.className = 'team-card third-place-card';
        card.style.left = (thirdPlaceMatch.x + 50) + 'px';
        card.style.top = (thirdPlaceMatch.y - 200) + 'px'; // 第6試合の200px上

        const icon = document.createElement('div');
        icon.className = 'team-icon';
        icon.textContent = '🥉'; // 銅メダル
        icon.style.fontSize = '32px';

        const name = document.createElement('div');
        name.className = 'team-name';
        name.textContent = '3位';
        name.style.fontSize = '18px';
        name.style.fontWeight = 'bold';

        card.appendChild(icon);
        card.appendChild(name);

        return card;
    }

    // ==================== 3位表示の更新 ====================

    /**
     * 3位決定戦が終了したら3位チーム名を表示
     */
    function updateThirdPlace() {
        const thirdPlaceMatch = getMatchData('F');
        const thirdPlaceSection = document.getElementById('thirdPlaceSection');
        const thirdPlaceName = document.getElementById('thirdPlaceName');

        // HTML側にセクションがない場合は作成しない
        if (!thirdPlaceSection || !thirdPlaceName) return;

        if (thirdPlaceMatch && thirdPlaceMatch.status === '終了') {
            const winner = getWinner(thirdPlaceMatch);
            if (winner) {
                const thirdPlaceTeam = winner === 1 ? thirdPlaceMatch.team1.name : thirdPlaceMatch.team2.name;
                thirdPlaceName.textContent = thirdPlaceTeam;
                thirdPlaceSection.style.display = 'block';
            }
        } else {
            thirdPlaceSection.style.display = 'none';
        }
    }

    // ==================== 試合ブロック描画 ====================
    function renderMatchBlock(matchData, coords, results) {
        const block = document.createElement('div');
        block.className = 'match-block';

        const statusClass = matchData.status === '試合中' ? 'playing' :
            matchData.status === '終了' ? 'finished' : 'waiting';
        block.classList.add(statusClass);

        if (coords.special === 'final') {
            block.classList.add('final');
        } else if (coords.special === 'third') {
            block.classList.add('third-place');
        } else if (coords.special === 'semi') {
            block.classList.add('semi-final');
        }

        if (results && getMatchWinnerStatus(matchData.gameLabel, results) === 'alive') {
            block.classList.add('winner-alive');
        }

        // 50px右にオフセット
        block.style.left = (coords.x + 50) + 'px';
        block.style.top = coords.y + 'px';

        const label = document.createElement('div');
        label.className = 'match-label';
        label.textContent = CIRCLED_LABELS[coords.label] || coords.label;

        if (coords.time || coords.venue) {
            const venueInfo = document.createElement('div');
            venueInfo.className = 'match-venue-info';
            venueInfo.textContent = [coords.time, coords.venue].filter(Boolean).join(' ');
            block.appendChild(label);
            block.appendChild(venueInfo);
        } else {
            block.appendChild(label);
        }

        const scoreLine = document.createElement('div');
        scoreLine.className = 'match-score-line';

        const winner = getWinner(matchData);

        // チーム1
        const team1Name = document.createElement('span');
        team1Name.className = 'match-team-name';
        if (CONFIG.isPlaceholder(matchData.team1.name)) {
            team1Name.classList.add('placeholder');
        }
        if (winner === 1) {
            team1Name.classList.add('winner');
        }
        team1Name.textContent = matchData.team1.name;
        scoreLine.appendChild(team1Name);

        // スコア表示（得点がある場合のみ）
        if (matchData.team1.score !== null && matchData.team2.score !== null) {
            const score1 = document.createElement('span');
            score1.className = 'match-team-score';
            if (winner === 1) {
                score1.classList.add('winner');
            }
            score1.textContent = matchData.team1.score;
            scoreLine.appendChild(score1);

            const separator = document.createElement('span');
            separator.className = 'match-score-separator';
            separator.textContent = '-';
            scoreLine.appendChild(separator);

            const score2 = document.createElement('span');
            score2.className = 'match-team-score';
            if (winner === 2) {
                score2.classList.add('winner');
            }
            score2.textContent = matchData.team2.score;
            scoreLine.appendChild(score2);
        }

        // チーム2
        const team2Name = document.createElement('span');
        team2Name.className = 'match-team-name';
        if (CONFIG.isPlaceholder(matchData.team2.name)) {
            team2Name.classList.add('placeholder');
        }
        if (winner === 2) {
            team2Name.classList.add('winner');
        }
        team2Name.textContent = matchData.team2.name;
        scoreLine.appendChild(team2Name);

        block.appendChild(scoreLine);

        const statusInfo = document.createElement('div');
        statusInfo.className = 'match-time';

        if (matchData.status === '試合中') {
            statusInfo.textContent = '⚾ 試合中';
            statusInfo.classList.add('status-playing');
        } else if (matchData.status === '終了') {
            statusInfo.textContent = '✓ 試合終了';
            statusInfo.classList.add('status-finished');
        } else {
            statusInfo.textContent = matchData.court ? `${matchData.court}コート` : '待機中';
            statusInfo.classList.add('status-waiting');
        }

        block.appendChild(statusInfo);

        block.addEventListener('click', () => {
            openMatch(matchData.court, matchData.gameNum);
        });

        return block;
    }

    // ==================== 接続線描画 ====================

    function renderConnectorLines(container, gameLabel, matchCoords, results) {
        const CX     = matchCoords.x + 50;
        const CY     = matchCoords.y;
        const TOP    = matchCoords.y - 40;
        const BOTTOM = matchCoords.y + 40;
        const LEFT   = matchCoords.x - 40;   // CX - 90
        const RIGHT  = matchCoords.x + 140;  // CX + 90

        function vLine(x, y1, y2, color, width) {
            const el = document.createElement('div');
            el.className = 'connector-line vertical';
            el.style.left = x + 'px';
            el.style.top = Math.min(y1, y2) + 'px';
            el.style.height = Math.abs(y2 - y1) + 'px';
            if (color) el.style.backgroundColor = color;
            if (width) el.style.width = width;
            container.appendChild(el);
        }

        function hLine(x1, y, x2, color, height) {
            const el = document.createElement('div');
            el.className = 'connector-line horizontal';
            el.style.left = Math.min(x1, x2) + 'px';
            el.style.top = y + 'px';
            el.style.width = Math.abs(x2 - x1) + 'px';
            if (color) el.style.backgroundColor = color;
            if (height) el.style.height = height;
            container.appendChild(el);
        }

        // 1回戦（チームカード → A/B/C）
        if (matchCoords.round === 1) {
            const teams = Object.entries(CONFIG.TEAM_COORDINATES).filter(
                ([_, coords]) => coords.gameNum === gameLabel
            );

            teams.forEach(([teamName, tc]) => {
                const s = lineStyle(results ? getTeamStatus(teamName, results) : 'pending');
                const teamX = tc.x + 50;
                const teamTopY = tc.y - CONFIG.CARD_SIZE.height / 2;
                vLine(teamX, BOTTOM, teamTopY, s.color, s.thickness);
            });
        }

        // 試合D: 印旛（シード）→ D (L字), A勝者 → D (縦線)
        if (gameLabel === 'D') {
            const seedEntry = Object.entries(CONFIG.TEAM_COORDINATES).find(([, c]) => c.isSeed);
            if (seedEntry) {
                const [seedName, sc] = seedEntry;
                const seedX = sc.x + 50;
                const seedTopY = sc.y - CONFIG.CARD_SIZE.height / 2;
                const sS = lineStyle(results ? getTeamStatus(seedName, results) : 'pending');
                vLine(seedX, CY, seedTopY, sS.color, sS.thickness);
                hLine(seedX, CY, LEFT, sS.color, sS.thickness);
            }
            const matchA = CONFIG.MATCH_COORDINATES['A'];
            if (matchA) {
                const sA = lineStyle(results ? getMatchWinnerStatus('A', results) : 'pending');
                vLine(matchA.x + 50, BOTTOM, matchA.y - 40, sA.color, sA.thickness);
            }
        }

        // 試合E: B勝者（左）+ C勝者（右）→ E
        if (gameLabel === 'E') {
            const matchB = CONFIG.MATCH_COORDINATES['B'];
            if (matchB) {
                const bX = matchB.x + 50;
                const sB = lineStyle(results ? getMatchWinnerStatus('B', results) : 'pending');
                vLine(bX, CY, matchB.y - 40, sB.color, sB.thickness);
                hLine(bX, CY, LEFT, sB.color, sB.thickness);
            }
            const matchC = CONFIG.MATCH_COORDINATES['C'];
            if (matchC) {
                const cX = matchC.x + 50;
                const sC = lineStyle(results ? getMatchWinnerStatus('C', results) : 'pending');
                vLine(cX, CY, matchC.y - 40, sC.color, sC.thickness);
                hLine(RIGHT, CY, cX, sC.color, sC.thickness);
            }
        }

        // 試合G（決勝）: D勝者（左）+ E勝者（右）→ G, G → 優勝カード
        if (gameLabel === 'G') {
            const matchD = CONFIG.MATCH_COORDINATES['D'];
            if (matchD) {
                const dX = matchD.x + 50;
                const sD = lineStyle(results ? getMatchWinnerStatus('D', results) : 'pending');
                vLine(dX, CY, matchD.y - 40, sD.color, sD.thickness);
                hLine(dX, CY, LEFT, sD.color, sD.thickness);
            }
            const matchE = CONFIG.MATCH_COORDINATES['E'];
            if (matchE) {
                const eX = matchE.x + 50;
                const sE = lineStyle(results ? getMatchWinnerStatus('E', results) : 'pending');
                vLine(eX, CY, matchE.y - 40, sE.color, sE.thickness);
                hLine(RIGHT, CY, eX, sE.color, sE.thickness);
            }
            // G → 優勝カード
            const champBottomY = CY - 200 + 40;
            vLine(CX, champBottomY, TOP, '#ffa000', '3px');
        }

        // 試合F（3位決定戦）→ 3位カード
        if (gameLabel === 'F') {
            const thirdBottomY = CY - 200 + 40;
            vLine(CX, thirdBottomY, TOP, '#cd7f32', '3px');
        }
    }

    // ==================== 開発用グリッド ====================

    function renderGrid() {
        const gridOverlay = document.createElement('div');
        gridOverlay.className = 'grid-overlay';

        const width = 1600;
        const height = 1000;

        for (let x = 0; x <= width; x += 100) {
            const line = document.createElement('div');
            line.className = 'grid-line-major vertical';
            line.style.left = x + 'px';
            gridOverlay.appendChild(line);

            if (x > 0) {
                const label = document.createElement('div');
                label.className = 'grid-label x';
                label.textContent = x;
                label.style.left = (x - 10) + 'px';
                gridOverlay.appendChild(label);
            }
        }

        for (let y = 0; y <= height; y += 100) {
            const line = document.createElement('div');
            line.className = 'grid-line-major horizontal';
            line.style.top = y + 'px';
            gridOverlay.appendChild(line);

            if (y > 0) {
                const label = document.createElement('div');
                label.className = 'grid-label y';
                label.textContent = y;
                label.style.top = (y - 10) + 'px';
                gridOverlay.appendChild(label);
            }
        }

        for (let x = 50; x < width; x += 100) {
            const line = document.createElement('div');
            line.className = 'grid-line-minor vertical';
            line.style.left = x + 'px';
            gridOverlay.appendChild(line);
        }

        for (let y = 50; y < height; y += 100) {
            const line = document.createElement('div');
            line.className = 'grid-line-minor horizontal';
            line.style.top = y + 'px';
            gridOverlay.appendChild(line);
        }

        return gridOverlay;
    }

    function renderMouseCoords() {
        const coords = document.createElement('div');
        coords.className = 'mouse-coords';
        coords.id = 'mouseCoords';
        coords.innerHTML = `
            <div><strong>マウス座標</strong></div>
            <div>X: <span id="coordX">-</span>px</div>
            <div>Y: <span id="coordY">-</span>px</div>
            <div style="font-size: 11px; margin-top: 10px; opacity: 0.7;">クリックで座標コピー</div>
        `;

        const tournamentArea = document.getElementById('tournamentArea');

        tournamentArea.addEventListener('mousemove', (e) => {
            const rect = tournamentArea.getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);

            document.getElementById('coordX').textContent = x;
            document.getElementById('coordY').textContent = y;
        });

        tournamentArea.addEventListener('mouseleave', () => {
            document.getElementById('coordX').textContent = '-';
            document.getElementById('coordY').textContent = '-';
        });

        tournamentArea.addEventListener('click', (e) => {
            const rect = tournamentArea.getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);

            const coordText = `X: ${x}px, Y: ${y}px`;
            navigator.clipboard.writeText(coordText).then(() => {
                coords.style.background = '#4CAF50';
                setTimeout(() => {
                    coords.style.background = '#333';
                }, 200);
            });
        });

        return coords;
    }

    function renderStageGuides() {
        const wrapper = document.createElement('div');

        const stages = [
            { top: 10, text: '<div><strong>優勝</strong> Y: 0-50px</div>' },
            { top: 120, text: '<div><strong>決勝戦</strong> Y: 100-200px</div>' },
            { top: 280, text: '<div><strong>準決勝</strong> Y: 250-350px</div>' },
            { top: 480, text: '<div><strong>1回戦</strong> Y: 500-600px</div>' },
            { top: 880, text: '<div><strong>チーム</strong> Y: 900-950px</div>' }
        ];

        stages.forEach(stage => {
            const guide = document.createElement('div');
            guide.className = 'stage-guide';
            guide.style.top = stage.top + 'px';
            guide.innerHTML = stage.text;
            wrapper.appendChild(guide);
        });

        return wrapper;
    }

    // ==================== 優勝者表示 ====================

    function updateChampion() {
        const finalMatch = getMatchData('G');
        const championSection = document.getElementById('championSection');
        const championName = document.getElementById('championName');

        if (finalMatch && finalMatch.status === '終了') {
            const winner = getWinner(finalMatch);
            if (winner) {
                const championTeam = winner === 1 ? finalMatch.team1.name : finalMatch.team2.name;
                championName.textContent = championTeam;
                championSection.style.display = 'block';
            }
        } else {
            championSection.style.display = 'none';
        }
    }

    // ==================== ズーム機能 ====================

    function initZoomControl() {
        const zoomButtons = document.querySelectorAll('.zoom-btn');
        const tournamentWrapper = document.getElementById('tournamentWrapper');
        const tournamentArea = document.getElementById('tournamentArea');

        // ページ読み込み時に60%を適用
        const initialZoom = 0.6;
        tournamentArea.style.transform = `scale(${initialZoom})`;
        tournamentArea.style.transformOrigin = 'top left';
        const initialHeight = 1000 * initialZoom;
        tournamentWrapper.style.height = `${initialHeight}px`;

        // 60%ボタンをアクティブに
        const zoom60Btn = document.querySelector('[data-zoom="0.6"]');
        if (zoom60Btn) {
            zoom60Btn.classList.add('active');
        }

        zoomButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const zoom = parseFloat(btn.dataset.zoom);
                currentZoom = zoom;

                tournamentArea.style.transform = `scale(${zoom})`;
                tournamentArea.style.transformOrigin = 'top left';

                const newHeight = 1000 * zoom;
                tournamentWrapper.style.height = `${newHeight}px`;

                zoomButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                tournamentWrapper.scrollLeft = 0;
                window.scrollTo(0, tournamentWrapper.offsetTop - 100);
            });
        });
    }

    // ==================== エラー表示 ====================

    function showError(message) {
        const container = document.getElementById('tournamentArea');
        container.innerHTML = `<div class="loading" style="color: #d32f2f;">⚠️ ${escapeHtml(message)}</div>`;
    }

    // ==================== ナビゲーション ====================

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

    function openMatch(court, gameNum) {
        if (!court) return;
        window.location.href = `scoreboard.html#${court}-${gameNum}`;
    }

    // ==================== パブリックAPI ====================

    return {
        init() {
            const refreshBtn = document.getElementById('refreshBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.manualRefresh());
            }

            initNavScrollIndicator();
            fetchTournamentData();
            this.startAutoRefresh();
        },

        async manualRefresh() {
            if (isRefreshing) return;

            isRefreshing = true;
            const btn = document.getElementById('refreshBtn');
            if (btn) btn.disabled = true;

            await fetchTournamentData();

            const timeout = CONFIG?.REFRESH_TIMEOUT || 2000;
            setTimeout(() => {
                isRefreshing = false;
                if (btn) btn.disabled = false;
            }, timeout);
        },

        startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);

            const interval = CONFIG.AUTO_REFRESH_INTERVAL || 60000;
            autoRefreshInterval = setInterval(() => fetchTournamentData(), interval);
        },

        stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        },

        openMatch(court, gameNum) {
            openMatch(court, gameNum);
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    TournamentApp.init();
});

window.addEventListener('beforeunload', () => {
    TournamentApp.stopAutoRefresh();
});
