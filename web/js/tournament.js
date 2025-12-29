/**

- トーナメント表アプリケーション（スマホ最適化版）
  */

const TournamentApp = (() => {
// ==================== プライベート変数 ====================
let gamesData = null;
let scheduleData = {};
let autoRefreshInterval = null;
let isRefreshing = false;

```
// トーナメント構成（7チーム、3位決定戦あり）
const TOURNAMENT_STRUCTURE = {
    round1: [1, 2, 3],      // 1回戦: 試合1, 2, 3
    semiFinals: [4, 5],     // 準決勝: 試合4, 5
    final: 7,               // 決勝: 試合7
    thirdPlace: 6           // 3位決定戦: 試合6
};

// チームアイコン
const TEAM_ICONS = {
    '印旛': '⚾',
    '東南': '🥎',
    '中部': '⭐',
    '南部': '🏆',
    '東部': '🎯',
    '北部': '🔥',
    '西部': '⚡'
};

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

function getTeamIcon(teamName) {
    if (!teamName) return '📍';
    for (const [region, icon] of Object.entries(TEAM_ICONS)) {
        if (teamName.includes(region)) return icon;
    }
    return '📍';
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
                const hours = date.getHours();
                const minutes = date.getMinutes();
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
        
        // スコアデータ取得
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
        gamesData = scoreData;

        // 試合予定データ取得
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
        console.error('データ取得エラー:', error);
        showError(`データの読み込みに失敗しました: ${error.message}`);
    }
}

// ==================== 試合データ処理 ====================

function getMatchData(gameNum) {
    if (!gamesData || !gamesData.games) return null;

    const games = gamesData.games.filter(g => 
        getSafeValue(g, 'gameNum', 'gameNumber', 'game_num') === gameNum
    );

    if (games.length < 2) {
        // スケジュールデータから取得
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

function getSeedTeam() {
    // 試合5の後攻チーム（シード）
    const match5 = getMatchData(5);
    return match5?.team2.name || null;
}

// ==================== レンダリング ====================

function renderTournament() {
    const container = document.getElementById('tournamentContainer');
    
    // 1回戦
    const round1Html = renderRound('1回戦', '⚾', TOURNAMENT_STRUCTURE.round1, 'round1');
    
    // 準決勝
    const semiFinalHtml = renderRound('準決勝', '🔥', TOURNAMENT_STRUCTURE.semiFinals, 'semifinal');
    
    // 決勝・3位決定戦
    const finalHtml = renderFinalRound();

    container.innerHTML = `
        ${round1Html}
        <div class="flow-arrow">↓</div>
        ${semiFinalHtml}
        <div class="flow-arrow">↓</div>
        ${finalHtml}
    `;

    // 優勝チーム表示
    updateChampion();
}

function renderRound(title, icon, gameNums, roundClass) {
    const matches = gameNums.map(num => getMatchData(num)).filter(m => m);
    const seedTeam = getSeedTeam();

    let matchesHtml = matches.map(match => renderMatchCard(match)).join('');

    // 準決勝でシード表示
    if (roundClass === 'semifinal' && seedTeam) {
        matchesHtml += `
            <div class="match-card seed">
                <div class="seed-card">
                    <div class="seed-icon">⭐</div>
                    <div class="seed-label">シード</div>
                    <div class="seed-team">${escapeHtml(seedTeam)}</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="round-block ${roundClass}-block">
            <div class="round-header">
                <div>
                    <div class="round-title">${title}</div>
                    <div class="round-subtitle">${matches.length}試合</div>
                </div>
                <div class="round-icon">${icon}</div>
            </div>
            <div class="match-list">
                ${matchesHtml}
            </div>
        </div>
    `;
}

function renderFinalRound() {
    const finalMatch = getMatchData(TOURNAMENT_STRUCTURE.final);
    const thirdPlaceMatch = getMatchData(TOURNAMENT_STRUCTURE.thirdPlace);

    return `
        <div class="round-block final-block">
            <div class="round-header">
                <div>
                    <div class="round-title">🏆 決勝戦</div>
                    <div class="round-subtitle">優勝をかけた戦い</div>
                </div>
                <div class="round-icon">🏆</div>
            </div>
            <div class="match-list">
                ${finalMatch ? renderMatchCard(finalMatch, true) : '<div class="loading">試合データなし</div>'}
            </div>
        </div>
        
        <div class="round-block third-place-block">
            <div class="round-header">
                <div>
                    <div class="round-title">🥉 3位決定戦</div>
                    <div class="round-subtitle">3位の座を争う</div>
                </div>
                <div class="round-icon">🥉</div>
            </div>
            <div class="match-list">
                ${thirdPlaceMatch ? renderMatchCard(thirdPlaceMatch) : '<div class="loading">試合データなし</div>'}
            </div>
        </div>
    `;
}

function renderMatchCard(match, isFinal = false) {
    const statusClass = match.status === '試合中' ? 'playing' : 
                      match.status === '終了' ? 'finished' : 'waiting';
    const winner = getWinner(match);
    
    const team1Class = winner === 1 ? 'winner' : winner === 2 ? 'loser' : '';
    const team2Class = winner === 2 ? 'winner' : winner === 1 ? 'loser' : '';

    const isTBD = match.team1.name === '未定' || match.team2.name === '未定';

    return `
        <div class="match-card ${statusClass}" onclick="TournamentApp.openMatch('${match.court}', ${match.gameNum})">
            <div class="match-header">
                <div class="match-info">
                    <div class="match-number">第${match.gameNum}試合</div>
                    <div class="match-court">${match.court}コート</div>
                    ${match.time ? `<div class="match-time">${match.time}開始予定</div>` : ''}
                </div>
                <div class="match-status ${statusClass}">
                    ${match.status}
                </div>
            </div>
            <div class="match-content">
                <div class="team-row ${team1Class}">
                    <div class="team-info">
                        <div class="team-icon">${getTeamIcon(match.team1.name)}</div>
                        <div class="team-name ${isTBD ? 'tbd' : ''}">${escapeHtml(match.team1.name)}</div>
                    </div>
                    <div class="team-score ${match.team1.score === null ? 'empty' : ''}">
                        ${match.team1.score !== null ? match.team1.score : '-'}
                    </div>
                </div>
                <div class="vs-divider">VS</div>
                <div class="team-row ${team2Class}">
                    <div class="team-info">
                        <div class="team-icon">${getTeamIcon(match.team2.name)}</div>
                        <div class="team-name ${isTBD ? 'tbd' : ''}">${escapeHtml(match.team2.name)}</div>
                    </div>
                    <div class="team-score ${match.team2.score === null ? 'empty' : ''}">
                        ${match.team2.score !== null ? match.team2.score : '-'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateChampion() {
    const finalMatch = getMatchData(TOURNAMENT_STRUCTURE.final);
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

function showError(message) {
    const container = document.getElementById('tournamentContainer');
    container.innerHTML = `
        <div class="loading" style="color: #d32f2f;">
            ⚠️ ${message}
        </div>
    `;
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

        const timeout = CONFIG && CONFIG.REFRESH_TIMEOUT ? CONFIG.REFRESH_TIMEOUT : 2000;
        setTimeout(() => {
            isRefreshing = false;
            if (btn) btn.disabled = false;
        }, timeout);
    },

    startAutoRefresh() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        
        const interval = CONFIG && CONFIG.AUTO_REFRESH_INTERVAL ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
        autoRefreshInterval = setInterval(() => fetchTournamentData(), interval);
    },

    stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    },

    openMatch(court, gameNum) {
        if (!court) return;
        window.location.href = `scoreboard.html#${court}-${gameNum}`;
    }
};
```

})();

// ==================== 初期化 ====================
document.addEventListener(‘DOMContentLoaded’, () => {
TournamentApp.init();
});

window.addEventListener(‘beforeunload’, () => {
TournamentApp.stopAutoRefresh();
});