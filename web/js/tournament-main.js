/**
 * トーナメント表アプリケーション（SVG折れ線方式）
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

    // 「第N試合勝者/敗者」→ 実チーム名の解決マップを生成
    function buildPlaceholderResolver() {
        const resolver = {};
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(label => {
            const gameNum = GAME_LABEL_TO_NUM[label];
            const md = getMatchData(label);
            if (!md) return;
            const t1 = resolver[md.team1.name] || md.team1.name;
            const t2 = resolver[md.team2.name] || md.team2.name;
            const w = getWinner(md);
            if (w !== null) {
                const winner = w === 1 ? t1 : t2;
                const loser  = w === 1 ? t2 : t1;
                resolver[`第${gameNum}試合勝者`] = winner;
                resolver[`第${gameNum}試合敗者`] = loser;
            }
        });
        return resolver;
    }

    function collectMatchResults() {
        const resolver = buildPlaceholderResolver();
        const results = [];
        Object.keys(CONFIG.MATCH_COORDINATES).forEach(label => {
            const md = getMatchData(label);
            if (!md) return;
            const w = getWinner(md);
            const t1 = resolver[md.team1.name] || md.team1.name;
            const t2 = resolver[md.team2.name] || md.team2.name;
            results.push({
                label,
                team1: t1,
                team2: t2,
                winner: w === 1 ? t1 : w === 2 ? t2 : null
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
        if (hasWon) return 'alive';
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

    // ==================== SVGブラケット描画 ====================

    function buildSVGString() {
        return `<svg id="bracket" viewBox="0 0 1080 635" width="1060" height="635"
     xmlns="http://www.w3.org/2000/svg">

<defs>
  <linearGradient id="gChamp" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f6d365"/>
    <stop offset="100%" stop-color="#fda085"/>
  </linearGradient>
</defs>

<!-- LAYER 1: グレー線 -->
<line id="lt0" x1="80"  y1="565" x2="80"  y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt1" x1="192" y1="565" x2="192" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt2" x1="304" y1="565" x2="304" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bA"  x1="192" y1="440" x2="304" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wA"  x1="248" y1="440" x2="248" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt3" x1="416" y1="565" x2="416" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt4" x1="528" y1="565" x2="528" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bB"  x1="416" y1="440" x2="528" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wB"  x1="472" y1="440" x2="472" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt5" x1="640" y1="565" x2="640" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt6" x1="752" y1="565" x2="752" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bC"  x1="640" y1="440" x2="752" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wC"  x1="696" y1="440" x2="696" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="bD1" x1="80"  y1="280" x2="164" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="bD2" x1="164" y1="280" x2="248" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="wD"  x1="164" y1="280" x2="164" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bE1" x1="472" y1="280" x2="584" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="bE2" x1="584" y1="280" x2="696" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="wE"  x1="584" y1="280" x2="584" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bG1" x1="164" y1="120" x2="374" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bG2" x1="374" y1="120" x2="584" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="wG"  x1="374" y1="120" x2="374" y2="54"  stroke="#ccc" stroke-width="2"/>
<line id="lld" x1="820" y1="120" x2="820" y2="235" stroke="#ccc" stroke-width="2"/>
<line id="lle" x1="1020" y1="120" x2="1020" y2="235" stroke="#ccc" stroke-width="2"/>
<line id="bF1" x1="820" y1="120" x2="920" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bF2" x1="920" y1="120" x2="1020" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="wF"  x1="920" y1="120" x2="920" y2="54" stroke="#ccc" stroke-width="2"/>

<!-- LAYER 2: 静的要素 -->
<rect x="304" y="2" width="140" height="52" rx="9"
      fill="url(#gChamp)" stroke="#e67e22" stroke-width="2.5"/>
<text x="374" y="21" text-anchor="middle" font-size="15">&#x1F451;</text>
<text x="374" y="43" text-anchor="middle" font-size="17" font-weight="bold" fill="#5d2e00">&#x512A;&#x3000;&#x52DD;</text>

<rect x="845" y="2" width="150" height="52" rx="9"
      fill="#e8f5e9" stroke="#66bb6a" stroke-width="2.5"/>
<text x="920" y="21" text-anchor="middle" font-size="15">&#x1F949;</text>
<text x="920" y="43" text-anchor="middle" font-size="17" font-weight="bold" fill="#2e7d32">3&#x3000;&#x4F4D;</text>

<text x="248" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#2e7d32">&#xFF21;</text>
<text x="248" y="474" text-anchor="middle" font-size="11" fill="#555">10:00&#x3000;&#x9577;&#x5D4E;&#x8302;&#x96C4;&#x7403;&#x5834;</text>
<text id="vs-A" x="248" y="488" text-anchor="middle" font-size="10" fill="#888">&#x2460;&#x6771;&#x90E8; vs &#x2461;&#x6771;&#x5357;</text>

<text x="472" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#1565c0">&#xFF22;</text>
<text x="472" y="474" text-anchor="middle" font-size="11" fill="#555">10:00&#x3000;&#x7B2C;2&#x7403;&#x5834;</text>
<text id="vs-B" x="472" y="488" text-anchor="middle" font-size="10" fill="#888">&#x2462;&#x5317;&#x90E8; vs &#x2463;&#x897F;&#x90E8;</text>

<text x="696" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#2e7d32">&#xFF23;</text>
<text x="696" y="474" text-anchor="middle" font-size="11" fill="#555">11:20&#x3000;&#x9577;&#x5D4E;&#x8302;&#x96C4;&#x7403;&#x5834;</text>
<text id="vs-C" x="696" y="488" text-anchor="middle" font-size="10" fill="#888">&#x2464;&#x4E2D;&#x90E8; vs &#x2465;&#x5357;&#x90E8;</text>

<text x="164" y="298" text-anchor="middle" font-size="13" font-weight="bold" fill="#2e7d32">&#xFF24;&#x3000;&#x6E96;&#x6C7A;&#x52DD;</text>
<text x="164" y="313" text-anchor="middle" font-size="11" fill="#555">13:00&#x3000;&#x9577;&#x5D4E;&#x8302;&#x96C4;&#x7403;&#x5834;</text>
<text id="vs-D" x="164" y="328" text-anchor="middle" font-size="10" fill="#888">&#x5370;&#x65DB; vs &#xFF21;&#x52DD;&#x8005;</text>

<text x="584" y="298" text-anchor="middle" font-size="13" font-weight="bold" fill="#1565c0">&#xFF25;&#x3000;&#x6E96;&#x6C7A;&#x52DD;</text>
<text x="584" y="313" text-anchor="middle" font-size="11" fill="#555">13:00&#x3000;&#x7B2C;2&#x7403;&#x5834;</text>
<text id="vs-E" x="584" y="328" text-anchor="middle" font-size="10" fill="#888">&#xFF22;&#x52DD;&#x8005; vs &#xFF23;&#x52DD;&#x8005;</text>

<text x="374" y="138" text-anchor="middle" font-size="13" font-weight="bold" fill="#7d5a00">&#xFF26;&#x3000;&#x6C7A;&#x3000;&#x52DD;</text>
<text x="374" y="153" text-anchor="middle" font-size="11" fill="#555">14:30&#x3000;&#x9577;&#x5D4E;&#x8302;&#x96C4;&#x7403;&#x5834;</text>
<text id="vs-G" x="374" y="168" text-anchor="middle" font-size="10" fill="#888">&#xFF24;&#x52DD;&#x8005; vs &#xFF25;&#x52DD;&#x8005;</text>

<text x="920" y="138" text-anchor="middle" font-size="13" font-weight="bold" fill="#1565c0">&#xFF27;&#x3000;3&#x4F4D;&#x6C7A;&#x5B9A;&#x6226;</text>
<text x="920" y="153" text-anchor="middle" font-size="11" fill="#555">14:30&#x3000;&#x7B2C;2&#x7403;&#x5834;</text>
<text id="vs-F" x="920" y="168" text-anchor="middle" font-size="10" fill="#888">&#xFF24;&#x6557;&#x8005; vs &#xFF25;&#x6557;&#x8005;</text>

<text id="score-A" x="248" y="488" text-anchor="middle" font-size="12"></text>
<text id="score-B" x="472" y="488" text-anchor="middle" font-size="12"></text>
<text id="score-C" x="696" y="488" text-anchor="middle" font-size="12"></text>
<text id="score-D" x="164" y="328" text-anchor="middle" font-size="12"></text>
<text id="score-E" x="584" y="328" text-anchor="middle" font-size="12"></text>
<text id="score-G" x="374" y="168" text-anchor="middle" font-size="12"></text>
<text id="score-F" x="920" y="168" text-anchor="middle" font-size="12"></text>

<!-- LAYER 3: 赤線オーバーレイ (stroke="none" → JSが活性化) -->
<line id="r-lt0" x1="80"  y1="565" x2="80"  y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt1" x1="192" y1="565" x2="192" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt2" x1="304" y1="565" x2="304" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bA1" x1="192" y1="440" x2="248" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bA2" x1="248" y1="440" x2="304" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wA"  x1="248" y1="440" x2="248" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt3" x1="416" y1="565" x2="416" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt4" x1="528" y1="565" x2="528" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bB1" x1="416" y1="440" x2="472" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bB2" x1="472" y1="440" x2="528" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wB"  x1="472" y1="440" x2="472" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt5" x1="640" y1="565" x2="640" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lt6" x1="752" y1="565" x2="752" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bC1" x1="640" y1="440" x2="696" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bC2" x1="696" y1="440" x2="752" y2="440" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wC"  x1="696" y1="440" x2="696" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bD1" x1="80"  y1="280" x2="164" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bD2" x1="164" y1="280" x2="248" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wD"  x1="164" y1="280" x2="164" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bE1" x1="472" y1="280" x2="584" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bE2" x1="584" y1="280" x2="696" y2="280" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wE"  x1="584" y1="280" x2="584" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bG1" x1="164" y1="120" x2="374" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bG2" x1="374" y1="120" x2="584" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wG"  x1="374" y1="120" x2="374" y2="54"  stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lld" x1="820" y1="120" x2="820" y2="235" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-lle" x1="1020" y1="120" x2="1020" y2="235" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bF1" x1="820" y1="120" x2="920" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-bF2" x1="920" y1="120" x2="1020" y2="120" stroke="none" stroke-width="5" stroke-linecap="round"/>
<line id="r-wF"  x1="920" y1="120" x2="920" y2="54" stroke="none" stroke-width="5" stroke-linecap="round"/>

<!-- LAYER 4: ボックス（赤線前面） -->
<rect id="loser-D-rect" x="786" y="235" width="68" height="90" rx="5"
      fill="white" stroke="#bbb" stroke-width="1.5" stroke-dasharray="5,3"/>
<text id="loser-D-name" x="820" y="267" text-anchor="middle" font-size="13" font-weight="bold" fill="#999">D&#x6557;&#x8005;</text>
<text id="loser-D-sub" x="820" y="284" text-anchor="middle" font-size="10" fill="#bbb">&#x6E96;&#x6C7A;&#x52DD;D</text>
<text id="loser-D-hint" x="820" y="298" text-anchor="middle" font-size="10" fill="#bbb">&#x6557;&#x9000;&#x30C1;&#x30FC;&#x30E0;</text>

<rect id="loser-E-rect" x="986" y="235" width="68" height="90" rx="5"
      fill="white" stroke="#bbb" stroke-width="1.5" stroke-dasharray="5,3"/>
<text id="loser-E-name" x="1020" y="267" text-anchor="middle" font-size="13" font-weight="bold" fill="#999">E&#x6557;&#x8005;</text>
<text id="loser-E-sub" x="1020" y="284" text-anchor="middle" font-size="10" fill="#bbb">&#x6E96;&#x6C7A;&#x52DD;E</text>
<text id="loser-E-hint" x="1020" y="298" text-anchor="middle" font-size="10" fill="#bbb">&#x6557;&#x9000;&#x30C1;&#x30FC;&#x30E0;</text>

<rect x="46" y="520" width="68" height="90" rx="5"
      fill="white" stroke="#e53935" stroke-width="2.5"/>
<text id="tn-seed" x="80" y="556" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="80" y="574" text-anchor="middle" font-size="10" fill="#e53935">&#x30B7;&#x30FC;&#x30C9;</text>

<rect x="158" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="192" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2460;</text>
<text id="tn-t1a" x="192" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="192" y="582" text-anchor="middle" font-size="10" fill="#aaa">1&#x5854;&#x5074;</text>

<rect x="270" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="304" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2461;</text>
<text id="tn-t2a" x="304" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="304" y="582" text-anchor="middle" font-size="10" fill="#aaa">3&#x5854;&#x5074;</text>

<rect x="382" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="416" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2462;</text>
<text id="tn-t1b" x="416" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="416" y="582" text-anchor="middle" font-size="10" fill="#aaa">1&#x5854;&#x5074;</text>

<rect x="494" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="528" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2463;</text>
<text id="tn-t2b" x="528" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="528" y="582" text-anchor="middle" font-size="10" fill="#aaa">3&#x5854;&#x5074;</text>

<rect x="606" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="640" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2464;</text>
<text id="tn-t1c" x="640" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="640" y="582" text-anchor="middle" font-size="10" fill="#aaa">1&#x5854;&#x5074;</text>

<rect x="718" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="752" y="544" text-anchor="middle" font-size="11" fill="#aaa">&#x2465;</text>
<text id="tn-t2c" x="752" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="752" y="582" text-anchor="middle" font-size="10" fill="#aaa">3&#x5854;&#x5074;</text>

</svg>`;
    }
    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function populateTeamNames() {
        const matchA = getMatchData('A');
        const matchB = getMatchData('B');
        const matchC = getMatchData('C');
        const matchD = getMatchData('D');
        if (matchD) setText('tn-seed', matchD.team1.name || '印旛');
        if (matchA) {
            setText('tn-t1a', matchA.team1.name || '①');
            setText('tn-t2a', matchA.team2.name || '②');
        }
        if (matchB) {
            setText('tn-t1b', matchB.team1.name || '③');
            setText('tn-t2b', matchB.team2.name || '④');
        }
        if (matchC) {
            setText('tn-t1c', matchC.team1.name || '⑤');
            setText('tn-t2c', matchC.team2.name || '⑥');
        }
    }

    function activateRedLines() {
        const RED = '#e53935';
        document.querySelectorAll('[id^="r-"]').forEach(el => el.setAttribute('stroke', 'none'));
        function red(id) {
            const el = document.getElementById('r-' + id);
            if (el) el.setAttribute('stroke', RED);
        }

        const matchA = getMatchData('A');
        if (matchA) {
            const w = getWinner(matchA);
            if      (w === 1) { red('lt1'); red('bA1'); red('wA'); }
            else if (w === 2) { red('lt2'); red('bA2'); red('wA'); }
        }

        const matchB = getMatchData('B');
        if (matchB) {
            const w = getWinner(matchB);
            if      (w === 1) { red('lt3'); red('bB1'); red('wB'); }
            else if (w === 2) { red('lt4'); red('bB2'); red('wB'); }
        }

        const matchC = getMatchData('C');
        if (matchC) {
            const w = getWinner(matchC);
            if      (w === 1) { red('lt5'); red('bC1'); red('wC'); }
            else if (w === 2) { red('lt6'); red('bC2'); red('wC'); }
        }

        const matchD = getMatchData('D');
        if (matchD) {
            const w = getWinner(matchD);
            if      (w === 1) { red('lt0'); red('bD1'); red('wD'); }
            else if (w === 2) {             red('bD2'); red('wD'); }
        }

        const matchE = getMatchData('E');
        if (matchE) {
            const w = getWinner(matchE);
            if      (w === 1) { red('bE1'); red('wE'); }
            else if (w === 2) { red('bE2'); red('wE'); }
        }

        const matchG = getMatchData('G');
        if (matchG) {
            const w = getWinner(matchG);
            if      (w === 1) { red('bG1'); red('wG'); }
            else if (w === 2) { red('bG2'); red('wG'); }
        }

        const matchF = getMatchData('F');
        if (matchF) {
            const w = getWinner(matchF);
            if      (w === 1) { red('lld'); red('bF1'); red('wF'); }
            else if (w === 2) { red('lle'); red('bF2'); red('wF'); }
        }
    }

    function setScores() {
        const RED = '#e53935';
        const resolver = buildPlaceholderResolver();
        function resolve(name) { return resolver[name] || name; }
        function setScore(matchId, md) {
            const el = document.getElementById('score-' + matchId);
            if (!el || !md) return;
            if (md.status !== '\u7d42\u4e86' && md.status !== '\u8a66\u5408\u4e2d') return;
            const s1 = md.team1.score, s2 = md.team2.score;
            if (s1 === null || s1 === undefined || s2 === null || s2 === undefined) return;
            const t1 = resolve(md.team1.name);
            const t2 = resolve(md.team2.name);
            el.textContent = t1 + ' ' + s1 + ' - ' + s2 + ' ' + t2;
            el.setAttribute('fill', RED);
            el.setAttribute('font-weight', 'bold');
            el.setAttribute('font-size', '13');
            const vs = document.getElementById('vs-' + matchId);
            if (vs) vs.setAttribute('visibility', 'hidden');
        }
        ['A','B','C','D','E','G','F'].forEach(id => setScore(id, getMatchData(id)));
    }

    function updateLoserBoxes() {
        const resolver = buildPlaceholderResolver();
        function resolve(name) { return resolver[name] || name; }
        function update(matchId) {
            const md = getMatchData(matchId);
            if (!md) return;
            const w = getWinner(md);
            if (w === null) return;
            const loser = resolve(w === 1 ? md.team2.name : md.team1.name);
            const nameEl = document.getElementById('loser-' + matchId + '-name');
            const subEl  = document.getElementById('loser-' + matchId + '-sub');
            const rect   = document.getElementById('loser-' + matchId + '-rect');
            if (nameEl) { nameEl.textContent = loser; nameEl.setAttribute('fill', '#1a1a2e'); nameEl.setAttribute('font-size', '16'); }
            if (subEl)  subEl.textContent = '';
            const hintEl = document.getElementById('loser-' + matchId + '-hint');
            if (hintEl) hintEl.textContent = '';
            if (rect)   { rect.setAttribute('stroke-dasharray', 'none'); rect.setAttribute('stroke', '#777'); }
        }
        update('D');
        update('E');
    }
    function renderTournament() {
        const container = document.getElementById('tournamentArea');
        container.innerHTML = buildSVGString();
        populateTeamNames();
        setScores();
        updateLoserBoxes();
        activateRedLines();
        updateChampion();
        initZoomControl();
    }

    // ==================== 優勝者表示 ====================

    function updateChampion() {
        const finalMatch = getMatchData('G');
        const championSection = document.getElementById('championSection');
        const championName = document.getElementById('championName');

        if (finalMatch && finalMatch.status === '終了') {
            const winner = getWinner(finalMatch);
            if (winner) {
                const resolver = buildPlaceholderResolver();
                const raw = winner === 1 ? finalMatch.team1.name : finalMatch.team2.name;
                const championTeam = resolver[raw] || raw;
                championName.textContent = championTeam;
                championSection.style.display = 'block';
            }
        } else {
            championSection.style.display = 'none';
        }
    }

    // ==================== ズーム機能 ====================

    function initZoomControl() {
        const BASE_W = 1060, BASE_H = 635;
        const zoomButtons = document.querySelectorAll('.zoom-btn');
        const tournamentWrapper = document.getElementById('tournamentWrapper');
        const tournamentArea = document.getElementById('tournamentArea');

        function applyZoom(zoom) {
            currentZoom = zoom;
            const svgEl = tournamentArea.querySelector('svg');
            if (svgEl) {
                svgEl.setAttribute('width',  Math.round(BASE_W * zoom));
                svgEl.setAttribute('height', Math.round(BASE_H * zoom));
            }
            tournamentArea.style.transform = '';
            tournamentArea.style.width  = Math.round(BASE_W * zoom) + 'px';
            tournamentArea.style.height = Math.round(BASE_H * zoom) + 'px';
            tournamentWrapper.style.height = Math.round(BASE_H * zoom) + 'px';
            zoomButtons.forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector(`[data-zoom="${zoom}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }

        zoomButtons.forEach(btn => {
            btn.addEventListener('click', () => applyZoom(parseFloat(btn.dataset.zoom)));
        });

        applyZoom(0.6);
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
