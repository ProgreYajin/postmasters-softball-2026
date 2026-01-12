/**
 * トーナメント表アプリケーション（座標ベース・SVG版）
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

    // ==================== データ取得 ====================

    async function fetchTournamentData() {
        if (!CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
            showError('API URLが設定されていません');
            return;
        }

        try {
            const timestamp = new Date().getTime();
            
            // 【重要】1. トーナメント表データ取得
            console.log('🔄 トーナメント表データ取得開始...');
            const tournamentUrl = `${CONFIG.STAFF_API_URL}?type=tournament&t=${timestamp}`;
            const tournamentResponse = await fetch(tournamentUrl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (tournamentResponse.ok) {
                tournamentData = await tournamentResponse.json();
                
                // CONFIGを更新（これが重要！）
                if (tournamentData.teams && tournamentData.teams.length > 0) {
                    CONFIG.updateTeamCoordinates(tournamentData.teams);
                    console.log('✅ トーナメント表データ取得成功:', tournamentData.teams.length + 'チーム');
                } else {
                    console.warn('⚠️ トーナメント表データが空です。デフォルト値を使用します。');
                }
            } else {
                console.error('⚠️ トーナメント表データ取得失敗。デフォルト値を使用します。');
            }
            
            // 2. スコアボードデータ取得
            const scoreUrl = `${CONFIG.STAFF_API_URL}?t=${timestamp}`;
            const scoreResponse = await fetch(scoreUrl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (!scoreResponse.ok) {
                throw new Error(`HTTP Error ${scoreResponse.status}`);
            }

            gamesData = await scoreResponse.json();
            
            // 3. 試合予定データ取得
            const scheduleUrl = `${CONFIG.STAFF_API_URL}?type=schedule&t=${timestamp}`;
            const scheduleResponse = await fetch(scheduleUrl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            
            if (scheduleResponse.ok) {
                const scheduleJson = await scheduleResponse.json();
                if (scheduleJson.schedule && Array.isArray(scheduleJson.schedule)) {
                    scheduleData = scheduleJson.schedule.reduce((acc, game) => {
                        acc[game.gameNum] = game;
                        return acc;
                    }, {});
                }
            }
            
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
        const container = document.getElementById('tournamentContainer');
        
        if (!CONFIG.TEAM_COORDINATES || Object.keys(CONFIG.TEAM_COORDINATES).length === 0) {
            showError('トーナメント表データが見つかりません');
            return;
        }
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', CONFIG.TOURNAMENT_CANVAS.viewBox);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.classList.add('tournament-svg');

        if (isDevelopmentMode) {
            svg.appendChild(renderGrid());
        }

        Object.entries(CONFIG.TEAM_COORDINATES).forEach(([teamName, coords]) => {
            svg.appendChild(renderTeamCard(teamName, coords));
        });

        Object.entries(CONFIG.MATCH_COORDINATES).forEach(([gameNum, coords]) => {
            const matchData = getMatchData(parseInt(gameNum));
            if (matchData) {
                svg.appendChild(renderConnectorLines(parseInt(gameNum), coords));
                svg.appendChild(renderMatchBlock(matchData, coords));
            }
        });

        container.innerHTML = '';
        container.appendChild(svg);

        updateChampion();
    }

    // ==================== チームカード描画 ====================

    function renderTeamCard(teamName, coords) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('team-card');
        if (coords.isSeed) {
            group.classList.add('seed');
        }

        const x = coords.x - CONFIG.CARD_SIZE.width / 2;
        const y = coords.y - CONFIG.CARD_SIZE.height / 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', CONFIG.CARD_SIZE.width);
        rect.setAttribute('height', CONFIG.CARD_SIZE.height);
        rect.setAttribute('rx', 8);
        rect.classList.add('team-card-bg');
        group.appendChild(rect);

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        icon.setAttribute('x', coords.x);
        icon.setAttribute('y', coords.y - 10);
        icon.setAttribute('text-anchor', 'middle');
        icon.classList.add('team-icon');
        icon.textContent = CONFIG.getTeamIcon(teamName);
        group.appendChild(icon);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', coords.x);
        text.setAttribute('y', coords.y + 20);
        text.setAttribute('text-anchor', 'middle');
        text.classList.add('team-name');
        text.textContent = teamName;
        group.appendChild(text);

        if (coords.isSeed) {
            const seedMark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            seedMark.setAttribute('x', x + CONFIG.CARD_SIZE.width - 5);
            seedMark.setAttribute('y', y + 15);
            seedMark.setAttribute('text-anchor', 'end');
            seedMark.classList.add('seed-mark');
            seedMark.textContent = '⭐';
            group.appendChild(seedMark);
        }

        return group;
    }

    // ==================== 試合ブロック描画 ====================

    function renderMatchBlock(matchData, coords) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('match-block');
        
        const statusClass = matchData.status === '試合中' ? 'playing' : 
                           matchData.status === '終了' ? 'finished' : 'waiting';
        group.classList.add(statusClass);

        if (coords.special === 'final') {
            group.classList.add('final');
        } else if (coords.special === 'third') {
            group.classList.add('third-place');
        }

        const blockWidth = 160;
        const blockHeight = 100;
        const x = coords.x - blockWidth / 2;
        const y = coords.y - blockHeight / 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', blockWidth);
        rect.setAttribute('height', blockHeight);
        rect.setAttribute('rx', 8);
        rect.classList.add('match-block-bg');
        group.appendChild(rect);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', coords.x);
        label.setAttribute('y', y + 20);
        label.setAttribute('text-anchor', 'middle');
        label.classList.add('match-label');
        label.textContent = coords.label;
        group.appendChild(label);

        const team1Text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        team1Text.setAttribute('x', x + 10);
        team1Text.setAttribute('y', y + 45);
        team1Text.classList.add('match-team');
        if (CONFIG.isPlaceholder(matchData.team1.name)) {
            team1Text.classList.add('placeholder');
        }
        const winner = getWinner(matchData);
        if (winner === 1) team1Text.classList.add('winner');
        team1Text.textContent = matchData.team1.name;
        group.appendChild(team1Text);

        if (matchData.team1.score !== null) {
            const score1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            score1.setAttribute('x', x + blockWidth - 10);
            score1.setAttribute('y', y + 45);
            score1.setAttribute('text-anchor', 'end');
            score1.classList.add('match-score');
            if (winner === 1) score1.classList.add('winner');
            score1.textContent = matchData.team1.score;
            group.appendChild(score1);
        }

        const team2Text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        team2Text.setAttribute('x', x + 10);
        team2Text.setAttribute('y', y + 70);
        team2Text.classList.add('match-team');
        if (CONFIG.isPlaceholder(matchData.team2.name)) {
            team2Text.classList.add('placeholder');
        }
        if (winner === 2) team2Text.classList.add('winner');
        team2Text.textContent = matchData.team2.name;
        group.appendChild(team2Text);

        if (matchData.team2.score !== null) {
            const score2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            score2.setAttribute('x', x + blockWidth - 10);
            score2.setAttribute('y', y + 70);
            score2.setAttribute('text-anchor', 'end');
            score2.classList.add('match-score');
            if (winner === 2) score2.classList.add('winner');
            score2.textContent = matchData.team2.score;
            group.appendChild(score2);
        }

        if (matchData.time) {
            const time = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            time.setAttribute('x', coords.x);
            time.setAttribute('y', y + 90);
            time.setAttribute('text-anchor', 'middle');
            time.classList.add('match-time');
            time.textContent = `${matchData.time} ${matchData.court}コート`;
            group.appendChild(time);
        }

        group.style.cursor = 'pointer';
        group.addEventListener('click', () => {
            openMatch(matchData.court, matchData.gameNum);
        });

        return group;
    }

    // ==================== 接続線描画 ====================

    function renderConnectorLines(gameNum, matchCoords) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('connector-lines');

        if (matchCoords.round === 1) {
            const teams = Object.entries(CONFIG.TEAM_COORDINATES).filter(
                ([_, coords]) => coords.gameNum === gameNum
            );

            teams.forEach(([teamName, teamCoords]) => {
                const line = createLine(
                    teamCoords.x,
                    teamCoords.y - CONFIG.CARD_SIZE.height / 2,
                    teamCoords.x,
                    matchCoords.y + 50
                );
                group.appendChild(line);

                const hLine = createLine(
                    teamCoords.x,
                    matchCoords.y + 50,
                    matchCoords.x,
                    matchCoords.y + 50
                );
                group.appendChild(hLine);
            });
        }

        return group;
    }

    function createLine(x1, y1, x2, y2) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.classList.add('connector-line');
        return line;
    }

    // ==================== 開発用グリッド ====================

    function renderGrid() {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('grid');

        for (let x = 0; x <= 1000; x += 50) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x);
            line.setAttribute('y1', 0);
            line.setAttribute('x2', x);
            line.setAttribute('y2', 1000);
            line.setAttribute('stroke', '#e0e0e0');
            line.setAttribute('stroke-width', x % 100 === 0 ? 1 : 0.5);
            group.appendChild(line);
        }

        for (let y = 0; y <= 1000; y += 50) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('y1', y);
            line.setAttribute('x2', 1000);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', '#e0e0e0');
            line.setAttribute('stroke-width', y % 100 === 0 ? 1 : 0.5);
            group.appendChild(line);
        }

        return group;
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

    // ==================== エラー表示 ====================

    function showError(message) {
        const container = document.getElementById('tournamentContainer');
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
