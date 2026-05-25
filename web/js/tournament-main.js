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
        return `<svg id="bracket" viewBox="0 0 1060 635" width="1060" height="635"
     xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="gChamp" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#f6d365"/>
    <stop offset="100%" stop-color="#fda085"/>
  </linearGradient>
</defs>

<line id="lt0" x1="80"  y1="565" x2="80"  y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt1" x1="215" y1="565" x2="215" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt2" x1="305" y1="565" x2="305" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bA"  x1="215" y1="440" x2="305" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wA"  x1="260" y1="440" x2="260" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt3" x1="440" y1="565" x2="440" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt4" x1="530" y1="565" x2="530" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bB"  x1="440" y1="440" x2="530" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wB"  x1="485" y1="440" x2="485" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lt5" x1="665" y1="565" x2="665" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="lt6" x1="755" y1="565" x2="755" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="bC"  x1="665" y1="440" x2="755" y2="440" stroke="#ccc" stroke-width="2"/>
<line id="wC"  x1="710" y1="440" x2="710" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="bD"  x1="80"  y1="280" x2="260" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="wD"  x1="170" y1="280" x2="170" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bE"  x1="485" y1="280" x2="710" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="wE"  x1="597" y1="280" x2="597" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="bG"  x1="170" y1="120" x2="597" y2="120" stroke="#ccc" stroke-width="2"/>
<line id="wG"  x1="383" y1="120" x2="383" y2="54"  stroke="#ccc" stroke-width="2"/>
<line id="lld" x1="865" y1="565" x2="865" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="lle" x1="975" y1="565" x2="975" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="bF"  x1="865" y1="280" x2="975" y2="280" stroke="#ccc" stroke-width="2"/>
<line id="wF"  x1="920" y1="280" x2="920" y2="228" stroke="#ccc" stroke-width="2"/>

<rect x="313" y="2" width="140" height="52" rx="9"
      fill="url(#gChamp)" stroke="#e67e22" stroke-width="2.5"/>
<text x="383" y="21" text-anchor="middle" font-size="15">👑</text>
<text x="383" y="43" text-anchor="middle" font-size="17" font-weight="bold" fill="#5d2e00">優　勝</text>

<rect x="822" y="8" width="216" height="36" rx="7"
      fill="#fff9c4" stroke="#f9a825" stroke-width="2"/>
<text x="930" y="32" text-anchor="middle" font-size="13" font-weight="bold" fill="#5d4037">🥉 3位決定戦</text>

<rect x="845" y="178" width="150" height="50" rx="7"
      fill="#e8f5e9" stroke="#66bb6a" stroke-width="2"/>
<text x="920" y="209" text-anchor="middle" font-size="15" font-weight="bold" fill="#2e7d32">🥉　3　位</text>

<rect x="831" y="520" width="68" height="90" rx="5"
      fill="#fafafa" stroke="#bbb" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="865" y="552" text-anchor="middle" font-size="13" font-weight="bold" fill="#999">D敗者</text>
<text x="865" y="569" text-anchor="middle" font-size="10" fill="#bbb">準決勝D</text>
<text x="865" y="583" text-anchor="middle" font-size="10" fill="#bbb">敗退チーム</text>

<rect x="941" y="520" width="68" height="90" rx="5"
      fill="#fafafa" stroke="#bbb" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="975" y="552" text-anchor="middle" font-size="13" font-weight="bold" fill="#999">E敗者</text>
<text x="975" y="569" text-anchor="middle" font-size="10" fill="#bbb">準決勝E</text>
<text x="975" y="583" text-anchor="middle" font-size="10" fill="#bbb">敗退チーム</text>

<rect x="46" y="520" width="68" height="90" rx="5"
      fill="white" stroke="#e53935" stroke-width="2.5"/>
<text id="tn-seed" x="80" y="556" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e">印旛</text>
<text x="80" y="574" text-anchor="middle" font-size="10" fill="#e53935">シード</text>

<rect x="181" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="215" y="544" text-anchor="middle" font-size="11" fill="#aaa">①</text>
<text id="tn-t1a" x="215" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="215" y="582" text-anchor="middle" font-size="10" fill="#aaa">1塁側</text>

<rect x="271" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="305" y="544" text-anchor="middle" font-size="11" fill="#aaa">②</text>
<text id="tn-t2a" x="305" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="305" y="582" text-anchor="middle" font-size="10" fill="#aaa">3塁側</text>

<rect x="406" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="440" y="544" text-anchor="middle" font-size="11" fill="#aaa">③</text>
<text id="tn-t1b" x="440" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="440" y="582" text-anchor="middle" font-size="10" fill="#aaa">1塁側</text>

<rect x="496" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="530" y="544" text-anchor="middle" font-size="11" fill="#aaa">④</text>
<text id="tn-t2b" x="530" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="530" y="582" text-anchor="middle" font-size="10" fill="#aaa">3塁側</text>

<rect x="631" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="665" y="544" text-anchor="middle" font-size="11" fill="#aaa">⑤</text>
<text id="tn-t1c" x="665" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="665" y="582" text-anchor="middle" font-size="10" fill="#aaa">1塁側</text>

<rect x="721" y="520" width="68" height="90" rx="5" fill="white" stroke="#777" stroke-width="1.5"/>
<text x="755" y="544" text-anchor="middle" font-size="11" fill="#aaa">⑥</text>
<text id="tn-t2c" x="755" y="565" text-anchor="middle" font-size="18" font-weight="bold" fill="#1a1a2e"></text>
<text x="755" y="582" text-anchor="middle" font-size="10" fill="#aaa">3塁側</text>

<text x="260" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#2e7d32">Ａ</text>
<text x="260" y="474" text-anchor="middle" font-size="11" fill="#555">10:00　長嶋茂雄球場</text>
<text x="260" y="488" text-anchor="middle" font-size="10" fill="#888">①東部 vs ②東南</text>

<text x="485" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#1565c0">Ｂ</text>
<text x="485" y="474" text-anchor="middle" font-size="11" fill="#555">10:00　第2球場</text>
<text x="485" y="488" text-anchor="middle" font-size="10" fill="#888">③北部 vs ④西部</text>

<text x="710" y="458" text-anchor="middle" font-size="14" font-weight="bold" fill="#2e7d32">Ｃ</text>
<text x="710" y="474" text-anchor="middle" font-size="11" fill="#555">11:20　長嶋茂雄球場</text>
<text x="710" y="488" text-anchor="middle" font-size="10" fill="#888">⑤中部 vs ⑥南部</text>

<text x="170" y="298" text-anchor="middle" font-size="13" font-weight="bold" fill="#2e7d32">Ｄ　準決勝</text>
<text x="170" y="313" text-anchor="middle" font-size="11" fill="#555">13:00　長嶋茂雄球場</text>
<text x="170" y="328" text-anchor="middle" font-size="10" fill="#888">印旛 vs Ａ勝者</text>

<text x="597" y="298" text-anchor="middle" font-size="13" font-weight="bold" fill="#1565c0">Ｅ　準決勝</text>
<text x="597" y="313" text-anchor="middle" font-size="11" fill="#555">13:00　第2球場</text>
<text x="597" y="328" text-anchor="middle" font-size="10" fill="#888">Ｂ勝者 vs Ｃ勝者</text>

<text x="383" y="138" text-anchor="middle" font-size="13" font-weight="bold" fill="#7d5a00">Ｇ　決　勝</text>
<text x="383" y="153" text-anchor="middle" font-size="11" fill="#555">14:30　長嶋茂雄球場</text>
<text x="383" y="168" text-anchor="middle" font-size="10" fill="#888">Ｄ勝者 vs Ｅ勝者</text>

<text x="920" y="298" text-anchor="middle" font-size="13" font-weight="bold" fill="#1565c0">Ｆ　3位決定戦</text>
<text x="920" y="313" text-anchor="middle" font-size="11" fill="#555">14:30　第2球場</text>
<text x="920" y="328" text-anchor="middle" font-size="10" fill="#888">Ｄ敗者 vs Ｅ敗者</text>

<line id="r-lt0" x1="80"  y1="565" x2="80"  y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt1" x1="215" y1="565" x2="215" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt2" x1="305" y1="565" x2="305" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bA"  x1="215" y1="440" x2="305" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wA"  x1="260" y1="440" x2="260" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt3" x1="440" y1="565" x2="440" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt4" x1="530" y1="565" x2="530" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bB"  x1="440" y1="440" x2="530" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wB"  x1="485" y1="440" x2="485" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt5" x1="665" y1="565" x2="665" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lt6" x1="755" y1="565" x2="755" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bC"  x1="665" y1="440" x2="755" y2="440" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wC"  x1="710" y1="440" x2="710" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bD"  x1="80"  y1="280" x2="260" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wD"  x1="170" y1="280" x2="170" y2="120" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bE"  x1="485" y1="280" x2="710" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wE"  x1="597" y1="280" x2="597" y2="120" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bG"  x1="170" y1="120" x2="597" y2="120" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wG"  x1="383" y1="120" x2="383" y2="54"  stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lld" x1="865" y1="565" x2="865" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-lle" x1="975" y1="565" x2="975" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-bF"  x1="865" y1="280" x2="975" y2="280" stroke="none" stroke-width="4" stroke-linecap="round"/>
<line id="r-wF"  x1="920" y1="280" x2="920" y2="228" stroke="none" stroke-width="4" stroke-linecap="round"/>
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
        function red(id) {
            const el = document.getElementById('r-' + id);
            if (el) el.setAttribute('stroke', '#FF0000');
        }
        // Match A
        const matchA = getMatchData('A');
        if (matchA && getWinner(matchA)) {
            red(getWinner(matchA) === 1 ? 'lt1' : 'lt2');
            red('bA'); red('wA');
        }
        // Match B
        const matchB = getMatchData('B');
        if (matchB && getWinner(matchB)) {
            red(getWinner(matchB) === 1 ? 'lt3' : 'lt4');
            red('bB'); red('wB');
        }
        // Match C
        const matchC = getMatchData('C');
        if (matchC && getWinner(matchC)) {
            red(getWinner(matchC) === 1 ? 'lt5' : 'lt6');
            red('bC'); red('wC');
        }
        // Match D: team1=印旛(シード), team2=A勝者
        const matchD = getMatchData('D');
        if (matchD && getWinner(matchD)) {
            const seedWins = getWinner(matchD) === 1 && !CONFIG.isPlaceholder(matchD.team1.name);
            red(seedWins ? 'lt0' : 'wA');
            red('bD'); red('wD');
        }
        // Match E (B勝者 vs C勝者)
        const matchE = getMatchData('E');
        if (matchE && getWinner(matchE)) { red('bE'); red('wE'); }
        // Match G (決勝)
        const matchG = getMatchData('G');
        if (matchG && getWinner(matchG)) { red('bG'); red('wG'); }
        // Match F (3位決定戦: team1=D敗者, team2=E敗者)
        const matchF = getMatchData('F');
        if (matchF && getWinner(matchF)) {
            red(getWinner(matchF) === 1 ? 'lld' : 'lle');
            red('bF'); red('wF');
        }
    }

    function renderTournament() {
        const container = document.getElementById('tournamentArea');
        container.innerHTML = buildSVGString();
        populateTeamNames();
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
        const initialHeight = 635 * initialZoom;
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

                const newHeight = 635 * zoom;
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
