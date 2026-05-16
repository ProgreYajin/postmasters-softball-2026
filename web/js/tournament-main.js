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

            if (scheduleResponse.ok) {
                const scheduleJson = await scheduleResponse.json();
                if (scheduleJson.schedule && Array.isArray(scheduleJson.schedule)) {
                    scheduleData = scheduleJson.schedule.reduce((acc, game) => {
                        acc[game.gameNum] = game;
                        return acc;
                    }, {});
                }
            }

            console.log('✅ 全データ取得完了（並列処理）');
            renderTournament();

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
            const games = gamesData.games.filter(g =>
                getSafeValue(g, 'gameNum', 'gameNumber', 'game_num') === gameNum
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

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameLabel, coords]) => {
            const matchData = getMatchData(gameLabel);
            if (matchData) {
                renderConnectorLines(container, gameLabel, coords);
            }
        });

        Object.entries(CONFIG.TEAM_COORDINATES).forEach(([teamName, coords]) => {
            container.appendChild(renderTeamCard(teamName, coords));
        });

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameLabel, coords]) => {
            const matchData = getMatchData(gameLabel);
            if (matchData) {
                container.appendChild(renderMatchBlock(matchData, coords));
            }
        });

        updateChampion();
        updateThirdPlace();
        initZoomControl();
    }

    // ==================== チームカード描画 ====================

    function renderTeamCard(teamName, coords) {
        const card = document.createElement('div');
        card.className = 'team-card';
        if (coords.isSeed) {
            card.classList.add('seed');
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
        const thirdPlaceMatch = CONFIG.MATCH_COORDINATES[6];
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
        const thirdPlaceMatch = getMatchData(6);
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
    function renderMatchBlock(matchData, coords) {
        const block = document.createElement('div');
        block.className = 'match-block';

        const statusClass = matchData.status === '試合中' ? 'playing' :
            matchData.status === '終了' ? 'finished' : 'waiting';
        block.classList.add(statusClass);

        if (coords.special === 'final') {
            block.classList.add('final');
        } else if (coords.special === 'third') {
            block.classList.add('third-place');
        }

        // 50px右にオフセット
        block.style.left = (coords.x + 50) + 'px';
        block.style.top = coords.y + 'px';

        const label = document.createElement('div');
        label.className = 'match-label';
        label.textContent = coords.label;

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

        block.appendChild(label);
        block.appendChild(scoreLine);

        // 【修正】状態に応じた表示
        const statusInfo = document.createElement('div');
        statusInfo.className = 'match-time';

        if (matchData.status === '試合中') {
            statusInfo.textContent = '⚾ 試合中';
            statusInfo.classList.add('status-playing');
        } else if (matchData.status === '終了') {
            statusInfo.textContent = '✓ 試合終了';
            statusInfo.classList.add('status-finished');
        } else {
            // 待機中は時間とコートを表示
            if (matchData.time || matchData.court) {
                statusInfo.textContent = `${matchData.time} ${matchData.court}コート`;
            } else {
                statusInfo.textContent = '待機中';
            }
            statusInfo.classList.add('status-waiting');
        }

        block.appendChild(statusInfo);

        block.addEventListener('click', () => {
            openMatch(matchData.court, matchData.gameNum);
        });

        return block;
    }

    // ==================== 接続線描画 ====================

    function renderConnectorLines(container, gameNum, matchCoords) {
        // 1回戦（チームカード → 第1～3試合）
        if (matchCoords.round === 1) {
            const teams = Object.entries(CONFIG.TEAM_COORDINATES).filter(
                ([_, coords]) => coords.gameNum === gameNum
            );

            console.log(`接続線描画: 試合${gameNum}`, { matchCoords, teams });

            teams.forEach(([teamName, teamCoords]) => {
                // 50px右にオフセット
                const teamX = teamCoords.x + 50;

                // チームカードの上端から試合カードの下端まで縦線を引く（上向き）
                const teamTopY = teamCoords.y - CONFIG.CARD_SIZE.height / 2;
                const matchBottomY = matchCoords.y + 40; // 試合カードの下部（高さ80pxの半分=40px）
                const lineHeight = teamTopY - matchBottomY;

                console.log(`${teamName}の接続線:`, {
                    teamX,
                    teamY: teamCoords.y,
                    teamTopY,
                    matchBottomY,
                    lineHeight,
                    cardHeight: CONFIG.CARD_SIZE.height
                });

                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = teamX + 'px';
                vLine.style.top = matchBottomY + 'px'; // 試合カードの下端から開始
                vLine.style.height = lineHeight + 'px'; // 上向きに伸びる
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);
            });
        }

        // シードチーム（南部）→ 第4試合
        if (gameNum === 4) {
            const seedTeam = Object.entries(CONFIG.TEAM_COORDINATES).find(
                ([name, coords]) => coords.isSeed
            );

            if (seedTeam) {
                const [teamName, teamCoords] = seedTeam;
                const teamX = teamCoords.x + 50;
                const teamTopY = teamCoords.y - CONFIG.CARD_SIZE.height / 2;
                const matchLeftX = matchCoords.x + 50 - 90; // 試合カードの左端（幅180pxの半分=90px）
                const matchY = matchCoords.y + 50 - 50; // 50px上に変更

                console.log('シードチーム接続線:', { teamX, teamTopY, matchLeftX, matchY, lineHeight: teamTopY - matchY });

                // 縦線：シードチームの上端 → 第4試合の高さまで
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = teamX + 'px';
                vLine.style.top = matchY + 'px';
                vLine.style.height = (teamTopY - matchY) + 'px';
                container.appendChild(vLine);

                // 横線：シードチームのX座標 → 第4試合の左端
                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                hLine.style.left = teamX + 'px';
                hLine.style.top = matchY + 'px';
                hLine.style.width = (matchLeftX - teamX) + 'px';
                container.appendChild(hLine);
            }
        }

        // 第1試合 → 第4試合
        if (gameNum === 4) {
            const match1Coords = CONFIG.MATCH_COORDINATES[1];
            if (match1Coords) {
                const match1X = match1Coords.x + 50;
                const match1TopY = match1Coords.y - 40; // 第1試合の上端（中心-40px）
                const match4BottomY = matchCoords.y + 40; // 第4試合の下端（中心+40px）

                // 上下を正しく計算（小さい方が上）
                const startY = Math.min(match1TopY, match4BottomY);
                const endY = Math.max(match1TopY, match4BottomY);
                const lineHeight = endY - startY;

                console.log('第1試合→第4試合接続線:', {
                    match1X,
                    match1TopY,
                    match4BottomY,
                    startY,
                    endY,
                    lineHeight,
                    match1Y: match1Coords.y,
                    match4Y: matchCoords.y
                });

                // 縦線：第4試合の下端から第1試合の上端まで
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = match1X + 'px';
                vLine.style.top = startY + 'px'; // 小さい方（上）から開始
                vLine.style.height = lineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);

                console.log('第1試合→第4試合 縦線作成完了');
            } else {
                console.error('第1試合の座標が見つかりません');
            }
        }

        // 【修正】第2試合 → 第5試合（L字型・右折れ）
        if (gameNum === 5) {
            const match2Coords = CONFIG.MATCH_COORDINATES[2];
            if (match2Coords) {
                const match2X = match2Coords.x + 50; // 第2試合の中央X座標
                const match2TopY = match2Coords.y - 40; // 第2試合の上端
                const match5X = matchCoords.x + 50; // 第5試合の中央X座標
                const match5Y = matchCoords.y; // 第5試合の中央Y座標
                const match5RightX = matchCoords.x + 50 + 90; // 第5試合の右端（幅180pxの半分=90px）

                // 縦線：第2試合の上端 → 第5試合の中央の高さまで
                const vLineHeight = match2TopY - match5Y;
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = match2X + 'px';
                vLine.style.top = match5Y + 'px';
                vLine.style.height = vLineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);

                // 横線：第2試合のX座標 → 第5試合の右端（右に折れる）
                const hLineWidth = match5RightX - match2X;
                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                hLine.style.left = match2X + 'px';
                hLine.style.top = match5Y + 'px';
                hLine.style.width = hLineWidth + 'px';
                hLine.style.backgroundColor = '#003366';
                container.appendChild(hLine);

                console.log('第2試合→第5試合 L字型接続線作成（右折れ）:', {
                    match2X,
                    match2TopY,
                    match5X,
                    match5Y,
                    match5RightX,
                    vLineHeight,
                    hLineWidth
                });
            }
        }

        // 【修正】第3試合 → 第5試合（L字型・左折れ）
        if (gameNum === 5) {
            const match3Coords = CONFIG.MATCH_COORDINATES[3];
            if (match3Coords) {
                const match3X = match3Coords.x + 50; // 第3試合の中央X座標
                const match3TopY = match3Coords.y - 40; // 第3試合の上端
                const match5X = matchCoords.x + 50; // 第5試合の中央X座標
                const match5Y = matchCoords.y; // 第5試合の中央Y座標
                const match5LeftX = matchCoords.x + 50 - 90; // 第5試合の左端（幅180pxの半分=90px）

                // 縦線：第3試合の上端 → 第5試合の中央の高さまで
                const vLineHeight = match3TopY - match5Y;
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = match3X + 'px';
                vLine.style.top = match5Y + 'px';
                vLine.style.height = vLineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);

                // 横線：第5試合の左端 → 第3試合のX座標（左に折れる）
                const hLineWidth = match3X - match5LeftX;
                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                hLine.style.left = match5LeftX + 'px';
                hLine.style.top = match5Y + 'px';
                hLine.style.width = hLineWidth + 'px';
                hLine.style.backgroundColor = '#003366';
                container.appendChild(hLine);

                console.log('第3試合→第5試合 L字型接続線作成（左折れ）:', {
                    match3X,
                    match3TopY,
                    match5X,
                    match5Y,
                    match5LeftX,
                    vLineHeight,
                    hLineWidth
                });
            }
        }

        // 【修正】第4試合 → 第7試合（決勝）- L字型
        if (gameNum === 7) {
            const match4Coords = CONFIG.MATCH_COORDINATES[4];
            if (match4Coords) {
                const match4X = match4Coords.x + 50;
                const match4TopY = match4Coords.y - 40; // 第4試合の上端
                const match7X = matchCoords.x + 50; // 第7試合の中央
                const match7Y = matchCoords.y; // 第7試合の中央Y座標
                const match7LeftX = matchCoords.x + 50 - 90; // 第7試合の左端（幅180pxの半分=90px）

                // 縦線：第4試合の上端 → 第7試合の中央の高さまで
                const vLineHeight = match4TopY - match7Y;
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = match4X + 'px';
                vLine.style.top = match7Y + 'px';
                vLine.style.height = vLineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);

                // 横線：第4試合のX座標 → 第7試合の左端
                const hLineWidth = match7LeftX - match4X;
                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                hLine.style.left = match4X + 'px';
                hLine.style.top = match7Y + 'px';
                hLine.style.width = hLineWidth + 'px';
                hLine.style.backgroundColor = '#003366';
                container.appendChild(hLine);

                console.log('第4試合→第7試合 L字型接続線作成:', {
                    match4X,
                    match4TopY,
                    match7X,
                    match7Y,
                    match7LeftX,
                    vLineHeight,
                    hLineWidth
                });
            }
        }

        // 【新規追加】第5試合 → 第7試合（決勝）- L字型・左折れ
        if (gameNum === 7) {
            const match5Coords = CONFIG.MATCH_COORDINATES[5];
            if (match5Coords) {
                const match5X = match5Coords.x + 50; // 第5試合の中央X座標
                const match5TopY = match5Coords.y - 40; // 第5試合の上端
                const match7X = matchCoords.x + 50; // 第7試合の中央X座標
                const match7Y = matchCoords.y; // 第7試合の中央Y座標
                const match7RightX = matchCoords.x + 50 + 90; // 第7試合の右端（幅180pxの半分=90px）

                // 縦線：第5試合の上端 → 第7試合の中央の高さまで
                const vLineHeight = match5TopY - match7Y;
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = match5X + 'px';
                vLine.style.top = match7Y + 'px';
                vLine.style.height = vLineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);

                // 横線：第7試合の右端 → 第5試合のX座標（左に折れる）
                const hLineWidth = match5X - match7RightX;
                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                hLine.style.left = match7RightX + 'px';
                hLine.style.top = match7Y + 'px';
                hLine.style.width = hLineWidth + 'px';
                hLine.style.backgroundColor = '#003366';
                container.appendChild(hLine);

                console.log('第5試合→第7試合 L字型接続線作成（左折れ）:', {
                    match5X,
                    match5TopY,
                    match7X,
                    match7Y,
                    match7RightX,
                    vLineHeight,
                    hLineWidth
                });
            }
        }

        // 【新規追加】第7試合 → 優勝カード
        if (gameNum === 7) {
            const match7X = matchCoords.x + 50;
            const match7TopY = matchCoords.y - 40; // 第7試合の上端
            const championBottomY = matchCoords.y - 200 + 40; // 優勝カードの下端（第7試合の200px上 + カード半分の高さ）

            const lineHeight = match7TopY - championBottomY;

            const vLine = document.createElement('div');
            vLine.className = 'connector-line vertical champion-line';
            vLine.style.left = match7X + 'px';
            vLine.style.top = championBottomY + 'px';
            vLine.style.height = lineHeight + 'px';
            vLine.style.backgroundColor = '#ffa000'; // 優勝への線は金色
            vLine.style.width = '3px'; // 太めに
            container.appendChild(vLine);

            console.log('第7試合→優勝カード 接続線作成:', { match7X, match7TopY, championBottomY, lineHeight });
        }

        // 1. 3位決定戦のチームカード → 第6試合
        if (gameNum === 6) {
            const teams = Object.entries(CONFIG.TEAM_COORDINATES).filter(
                ([_, coords]) => coords.gameNum === 6
            );

            teams.forEach(([teamName, teamCoords]) => {
                const teamX = teamCoords.x + 50;
                const teamTopY = teamCoords.y - CONFIG.CARD_SIZE.height / 2;
                const matchBottomY = matchCoords.y + 40;
                const lineHeight = teamTopY - matchBottomY;

                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = teamX + 'px';
                vLine.style.top = matchBottomY + 'px';
                vLine.style.height = lineHeight + 'px';
                vLine.style.backgroundColor = '#003366';
                container.appendChild(vLine);
            });
        }

        // 2. 第6試合 → 3位カード
        if (gameNum === 6) {
            const match6X = matchCoords.x + 50;
            const match6TopY = matchCoords.y - 40;
            const thirdPlaceBottomY = matchCoords.y - 200 + 40;
            const lineHeight = match6TopY - thirdPlaceBottomY;

            const vLine = document.createElement('div');
            vLine.className = 'connector-line vertical third-place-line';
            vLine.style.left = match6X + 'px';
            vLine.style.top = thirdPlaceBottomY + 'px';
            vLine.style.height = lineHeight + 'px';
            vLine.style.backgroundColor = '#cd7f32'; // 銅色
            vLine.style.width = '3px';
            container.appendChild(vLine);
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
        const finalMatch = getMatchData(7);
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
