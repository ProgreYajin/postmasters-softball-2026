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
    let currentZoom = 1.0;

    // ==================== ユーティリティ関数 ====================

    function getSafeValue(obj, ...keyVariants) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const key of keyVariants) {
            if (key in obj && obj[key] !== null && obj[key] !== undefined) {
                return obj[key];
            }
        }
        return undefined;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

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

    function getMatchData(gameNum) {
        if (!gamesData || !gamesData.games) {
            if (scheduleData[gameNum]) {
                return {
                    gameNum: gameNum,
                    court: scheduleData[gameNum].court || '',
                    time: formatTime(getSafeValue(scheduleData[gameNum], 'time', 'startTime')),
                    status: '待機',
                    team1: {
                        name: scheduleData[gameNum].team1 || '未定',
                        score: null
                    },
                    team2: {
                        name: scheduleData[gameNum].team2 || '未定',
                        score: null
                    }
                };
            }
            return null;
        }

        const games = gamesData.games.filter(g =>
            getSafeValue(g, 'gameNum', 'gameNumber', 'game_num') === gameNum
        );

        if (games.length < 2) {
            if (scheduleData[gameNum]) {
                return {
                    gameNum: gameNum,
                    court: scheduleData[gameNum].court || '',
                    time: formatTime(getSafeValue(scheduleData[gameNum], 'time', 'startTime')),
                    status: '待機',
                    team1: {
                        name: scheduleData[gameNum].team1 || '未定',
                        score: null
                    },
                    team2: {
                        name: scheduleData[gameNum].team2 || '未定',
                        score: null
                    }
                };
            }
            return null;
        }

        return {
            gameNum: gameNum,
            court: getSafeValue(games[0], 'court', 'Court', 'COURT') || '',
            time: formatTime(getSafeValue(scheduleData[gameNum], 'time', 'startTime')),
            status: getSafeValue(games[0], 'status', 'Status', 'STATUS') || '待機',
            team1: {
                name: getSafeValue(games[0], 'team', 'homeTeam', 'topTeam') || '未定',
                score: getSafeValue(games[0], 'total', 'homeTotal', 'topTotal') || 0
            },
            team2: {
                name: getSafeValue(games[1], 'team', 'awayTeam', 'bottomTeam') || '未定',
                score: getSafeValue(games[1], 'total', 'awayTotal', 'bottomTotal') || 0
            }
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

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameNum, coords]) => {
            const matchData = getMatchData(parseInt(gameNum));
            if (matchData) {
                renderConnectorLines(container, parseInt(gameNum), coords);
            }
        });

        Object.entries(CONFIG.TEAM_COORDINATES).forEach(([teamName, coords]) => {
            container.appendChild(renderTeamCard(teamName, coords));
        });

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameNum, coords]) => {
            const matchData = getMatchData(parseInt(gameNum));
            if (matchData) {
                container.appendChild(renderMatchBlock(matchData, coords));
            }
        });

        updateChampion();
        initZoomControl();
    }

    // ==================== チームカード描画 ====================

    function renderTeamCard(teamName, coords) {
        const card = document.createElement('div');
        card.className = 'team-card';
        if (coords.isSeed) {
            card.classList.add('seed');
        }

        card.style.left = coords.x + 'px';
        card.style.top = coords.y + 'px';

        const icon = document.createElement('div');
        icon.className = 'team-icon';
        icon.textContent = CONFIG.getTeamIcon(teamName);

        const name = document.createElement('div');
        name.className = 'team-name';
        name.textContent = teamName;

        card.appendChild(icon);
        card.appendChild(name);

        if (coords.isSeed) {
            const seedMark = document.createElement('div');
            seedMark.className = 'seed-mark';
            seedMark.textContent = '⭐';
            card.appendChild(seedMark);
        }

        return card;
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

        block.style.left = coords.x + 'px';
        block.style.top = coords.y + 'px';

        const label = document.createElement('div');
        label.className = 'match-label';
        label.textContent = coords.label;

        const teams = document.createElement('div');
        teams.className = 'match-teams';

        const winner = getWinner(matchData);

        const team1Row = createTeamRow(matchData.team1, winner === 1);
        const team2Row = createTeamRow(matchData.team2, winner === 2);

        teams.appendChild(team1Row);
        teams.appendChild(team2Row);

        block.appendChild(label);
        block.appendChild(teams);

        if (matchData.time) {
            const time = document.createElement('div');
            time.className = 'match-time';
            time.textContent = `${matchData.time} ${matchData.court}コート`;
            block.appendChild(time);
        }

        block.addEventListener('click', () => {
            openMatch(matchData.court, matchData.gameNum);
        });

        return block;
    }

    function createTeamRow(team, isWinner) {
        const row = document.createElement('div');
        row.className = 'match-team-row';

        const teamName = document.createElement('div');
        teamName.className = 'match-team';
        if (CONFIG.isPlaceholder(team.name)) {
            teamName.classList.add('placeholder');
        }
        if (isWinner) {
            teamName.classList.add('winner');
        }
        teamName.textContent = team.name;

        row.appendChild(teamName);

        if (team.score !== null) {
            const score = document.createElement('div');
            score.className = 'match-score';
            if (isWinner) {
                score.classList.add('winner');
            }
            score.textContent = team.score;
            row.appendChild(score);
        }

        return row;
    }

    // ==================== 接続線描画 ====================

    function renderConnectorLines(container, gameNum, matchCoords) {
        if (matchCoords.round === 1) {
            const teams = Object.entries(CONFIG.TEAM_COORDINATES).filter(
                ([_, coords]) => coords.gameNum === gameNum
            );

            teams.forEach(([teamName, teamCoords]) => {
                const vLine = document.createElement('div');
                vLine.className = 'connector-line vertical';
                vLine.style.left = teamCoords.x + 'px';
                vLine.style.top = (teamCoords.y - CONFIG.CARD_SIZE.height / 2) + 'px';
                vLine.style.height = (matchCoords.y + 50 - (teamCoords.y - CONFIG.CARD_SIZE.height / 2)) + 'px';
                container.appendChild(vLine);

                const hLine = document.createElement('div');
                hLine.className = 'connector-line horizontal';
                const startX = Math.min(teamCoords.x, matchCoords.x);
                const endX = Math.max(teamCoords.x, matchCoords.x);
                hLine.style.left = startX + 'px';
                hLine.style.top = (matchCoords.y + 50) + 'px';
                hLine.style.width = (endX - startX) + 'px';
                container.appendChild(hLine);
            });
        }
    }

    // ==================== 開発用グリッド ====================

    function renderGrid() {
        const gridOverlay = document.createElement('div');
        gridOverlay.className = 'grid-overlay';

        const width = 1600;
        const height = 800;

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
            { top: 680, text: '<div><strong>チーム名</strong> Y: 700-750px</div>' }
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

        zoomButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const zoom = parseFloat(btn.dataset.zoom);
                currentZoom = zoom;

                tournamentArea.style.transform = `scale(${zoom})`;
                tournamentArea.style.transformOrigin = 'top left';

                const newHeight = 800 * zoom;
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

            const interval = CONFIG?.AUTO_REFRESH_INTERVAL || 60000;
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