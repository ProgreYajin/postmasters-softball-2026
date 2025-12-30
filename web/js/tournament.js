/**
  - トーナメント表アプリケーション（横スクロール型 - 洗練版）
  */

var TournamentApp = (function() {
var gamesData = null;
var scheduleData = {};
var autoRefreshInterval = null;
var isRefreshing = false;

var TOURNAMENT_STRUCTURE = {
    round1: [1, 2, 3],
    semiFinals: [4, 5],
    final: 7,
    thirdPlace: 6
};

var TEAM_ICONS = {
    '印旛': '⚾',
    '東南': '🥎',
    '中部': '⭐',
    '南部': '🏆',
    '東部': '🎯',
    '北部': '🔥',
    '西部': '⚡'
};

function getSafeValue(obj) {
    if (!obj || typeof obj !== 'object') return undefined;
    var keyVariants = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < keyVariants.length; i++) {
        var key = keyVariants[i];
        if (key in obj && obj[key] !== null && obj[key] !== undefined) {
            return obj[key];
        }
    }
    return undefined;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getTeamIcon(teamName) {
    if (!teamName) return '📍';
    for (var region in TEAM_ICONS) {
        if (TEAM_ICONS.hasOwnProperty(region) && teamName.indexOf(region) !== -1) {
            return TEAM_ICONS[region];
        }
    }
    return '📍';
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    
    if (typeof timestamp === 'number') {
        var totalMinutes = Math.round(timestamp * 24 * 60);
        var hours = Math.floor(totalMinutes / 60);
        var minutes = totalMinutes % 60;
        return padZero(hours) + ':' + padZero(minutes);
    }
    
    if (typeof timestamp === 'string') {
        if (timestamp.indexOf('T') !== -1) {
            try {
                var date = new Date(timestamp);
                var hours = date.getHours();
                var minutes = date.getMinutes();
                return padZero(hours) + ':' + padZero(minutes);
            } catch (e) {
                return timestamp;
            }
        }
        if (/^\d{1,2}:\d{2}$/.test(timestamp)) {
            var parts = timestamp.split(':');
            return padZero(parts[0]) + ':' + parts[1];
        }
        return timestamp;
    }
    
    return '';
}

function padZero(num) {
    return String(num).length === 1 ? '0' + num : String(num);
}

function fetchTournamentData() {
    if (!CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
        showError('API URLが設定されていません');
        return;
    }

    var timestamp = new Date().getTime();
    var scoreUrl = CONFIG.STAFF_API_URL + '?t=' + timestamp;

    fetch(scoreUrl, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache'
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('HTTP Error ' + response.status);
        }
        return response.json();
    })
    .then(function(scoreData) {
        gamesData = scoreData;
        
        var scheduleUrl = CONFIG.STAFF_API_URL + '?type=schedule&t=' + timestamp;
        return fetch(scheduleUrl, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-cache'
        });
    })
    .then(function(scheduleResponse) {
        if (scheduleResponse.ok) {
            return scheduleResponse.json();
        }
        return null;
    })
    .then(function(scheduleJson) {
        if (scheduleJson && scheduleJson.schedule && Array.isArray(scheduleJson.schedule)) {
            scheduleData = {};
            for (var i = 0; i < scheduleJson.schedule.length; i++) {
                var game = scheduleJson.schedule[i];
                scheduleData[game.gameNum] = game;
            }
        }
        renderTournament();
    })
    .catch(function(error) {
        console.error('データ取得エラー:', error);
        showError('データの読み込みに失敗しました: ' + error.message);
    });
}

function getMatchData(gameNum) {
    if (!gamesData || !gamesData.games) return null;

    var games = [];
    for (var i = 0; i < gamesData.games.length; i++) {
        var g = gamesData.games[i];
        if (getSafeValue(g, 'gameNum', 'gameNumber', 'game_num') === gameNum) {
            games.push(g);
        }
    }

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

function hasResult(matchData) {
    return matchData && (matchData.status === '試合中' || matchData.status === '終了');
}

function getSeedTeam() {
    var match5 = getMatchData(5);
    return match5 && match5.team2 ? match5.team2.name : null;
}

function renderTournament() {
    var container = document.getElementById('tournamentContainer');
    
    var scrollHint = '<div class="scroll-hint">' +
        '<span class="scroll-hint-icon">👉</span>' +
        '左右にスクロールできます' +
        '</div>';

    var tournamentHtml = '<div class="tournament-wrapper">' +
        '<div class="tournament-container">' +
        renderRound1() +
        renderSemiFinals() +
        renderFinals() +
        '</div>' +
        '</div>';

    container.innerHTML = scrollHint + tournamentHtml;
    updateChampion();
}

function renderRound1() {
    var allMatches = [];
    for (var i = 0; i < TOURNAMENT_STRUCTURE.round1.length; i++) {
        var match = getMatchData(TOURNAMENT_STRUCTURE.round1[i]);
        if (match) allMatches.push(match);
    }

    var aMatches = [];
    var bMatches = [];
    for (var j = 0; j < allMatches.length; j++) {
        if (allMatches[j].court === 'A') {
            aMatches.push(allMatches[j]);
        } else {
            bMatches.push(allMatches[j]);
        }
    }

    var html = '<div class="round-column">' +
        '<div class="round-header">' +
        '<div class="round-title">1回戦</div>' +
        '<div class="round-subtitle">3試合</div>' +
        '</div>' +
        '<div class="matches-container">';

    for (var k = 0; k < aMatches.length; k++) {
        var hasRes = hasResult(aMatches[k]);
        html += '<div class="match-wrapper ' + (hasRes ? 'has-result' : '') + '">' +
            renderMatchCard(aMatches[k]) +
            '<div class="connector">' +
            '<div class="connector-line connector-horizontal"></div>' +
            '</div>' +
            '</div>';
    }

    for (var m = 0; m < bMatches.length; m++) {
        var hasResB = hasResult(bMatches[m]);
        html += '<div class="match-wrapper ' + (hasResB ? 'has-result' : '') + '">' +
            renderMatchCard(bMatches[m]) +
            '<div class="connector">' +
            '<div class="connector-line connector-horizontal"></div>' +
            '</div>' +
            '</div>';
    }

    html += '</div></div>';
    return html;
}

function renderSemiFinals() {
    var match4 = getMatchData(4);
    var match5 = getMatchData(5);
    var seedTeam = getSeedTeam();

    var html = '<div class="round-column">' +
        '<div class="round-header">' +
        '<div class="round-title">準決勝</div>' +
        '<div class="round-subtitle">2試合</div>' +
        '</div>' +
        '<div class="matches-container">';

    if (match4) {
        var hasRes4 = hasResult(match4);
        html += '<div class="match-wrapper ' + (hasRes4 ? 'has-result' : '') + '">' +
            renderMatchCard(match4) +
            '<div class="connector">' +
            '<div class="connector-line connector-horizontal"></div>' +
            '</div>' +
            '</div>';
    }

    if (match5) {
        var hasRes5 = hasResult(match5);
        html += '<div class="match-wrapper ' + (hasRes5 ? 'has-result' : '') + '">' +
            renderMatchCard(match5) +
            '<div class="connector">' +
            '<div class="connector-line connector-horizontal"></div>' +
            '</div>' +
            '</div>';
    }

    if (seedTeam) {
        html += '<div class="match-wrapper has-result">' +
            '<div class="match-card seed">' +
            '<div class="seed-card">' +
            '<div class="seed-icon">⭐</div>' +
            '<div class="seed-label">シード (1回戦Bコート)</div>' +
            '<div class="seed-team">' + escapeHtml(seedTeam) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="connector">' +
            '<div class="connector-line connector-horizontal"></div>' +
            '</div>' +
            '</div>';
    }

    html += '</div></div>';
    return html;
}

function renderFinals() {
    var finalMatch = getMatchData(TOURNAMENT_STRUCTURE.final);
    var thirdPlaceMatch = getMatchData(TOURNAMENT_STRUCTURE.thirdPlace);

    var html = '<div class="round-column">' +
        '<div class="round-header">' +
        '<div class="round-title">決勝 / 3位決定戦</div>' +
        '<div class="round-subtitle">2試合</div>' +
        '</div>' +
        '<div class="matches-container">' +
        '<div class="final-section">';

    if (finalMatch) {
        html += '<div class="final-wrapper">' +
            '<div class="final-label">🏆 決勝戦</div>' +
            renderMatchCard(finalMatch, 'final-match') +
            '</div>';
    }

    if (thirdPlaceMatch) {
        html += '<div class="final-wrapper">' +
            '<div class="third-place-label">🥉 3位決定戦</div>' +
            renderMatchCard(thirdPlaceMatch, 'third-place-match') +
            '</div>';
    }

    html += '</div></div></div>';
    return html;
}

function renderMatchCard(match, extraClass) {
    var statusClass = match.status === '試合中' ? 'playing' : 
                      match.status === '終了' ? 'finished' : 'waiting';
    var winner = getWinner(match);
    
    var team1Class = winner === 1 ? 'winner' : winner === 2 ? 'loser' : '';
    var team2Class = winner === 2 ? 'winner' : winner === 1 ? 'loser' : '';

    var isTBD = match.team1.name === '未定' || match.team2.name === '未定';
    var timeHtml = match.time ? '<div class="match-time">' + match.time + '</div>' : '';
    var extraClassStr = extraClass ? ' ' + extraClass : '';

    var onclickAttr = 'onclick="TournamentApp.openMatch(\'' + match.court + '\', ' + match.gameNum + ')"';

    return '<div class="match-card ' + statusClass + extraClassStr + '" ' + onclickAttr + '>' +
        '<div class="match-header">' +
        '<div class="match-info">' +
        '<div class="match-number">第' + match.gameNum + '試合</div>' +
        '<div class="match-court">' + match.court + 'コート</div>' +
        timeHtml +
        '</div>' +
        '<div class="match-status ' + statusClass + '">' + match.status + '</div>' +
        '</div>' +
        '<div class="match-content">' +
        '<div class="team-row ' + team1Class + '">' +
        '<div class="team-info">' +
        '<div class="team-icon">' + getTeamIcon(match.team1.name) + '</div>' +
        '<div class="team-name ' + (isTBD ? 'tbd' : '') + '">' + escapeHtml(match.team1.name) + '</div>' +
        '</div>' +
        '<div class="team-score ' + (match.team1.score === null ? 'empty' : '') + '">' +
        (match.team1.score !== null ? match.team1.score : '-') +
        '</div>' +
        '</div>' +
        '<div class="team-row ' + team2Class + '">' +
        '<div class="team-info">' +
        '<div class="team-icon">' + getTeamIcon(match.team2.name) + '</div>' +
        '<div class="team-name ' + (isTBD ? 'tbd' : '') + '">' + escapeHtml(match.team2.name) + '</div>' +
        '</div>' +
        '<div class="team-score ' + (match.team2.score === null ? 'empty' : '') + '">' +
        (match.team2.score !== null ? match.team2.score : '-') +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
}

function updateChampion() {
    var finalMatch = getMatchData(TOURNAMENT_STRUCTURE.final);
    var championSection = document.getElementById('championSection');
    var championName = document.getElementById('championName');

    if (finalMatch && finalMatch.status === '終了') {
        var winner = getWinner(finalMatch);
        if (winner) {
            var championTeam = winner === 1 ? finalMatch.team1.name : finalMatch.team2.name;
            championName.textContent = championTeam;
            championSection.style.display = 'block';
        }
    } else {
        championSection.style.display = 'none';
    }
}

function showError(message) {
    var container = document.getElementById('tournamentContainer');
    container.innerHTML = '<div class="loading" style="color: #d32f2f;">⚠️ ' + message + '</div>';
}

function initNavScrollIndicator() {
    var navLinks = document.getElementById('navLinks');
    var navWrapper = document.getElementById('navWrapper');

    if (!navLinks || !navWrapper) return;

    function updateScrollIndicator() {
        var scrollLeft = navLinks.scrollLeft;
        var scrollWidth = navLinks.scrollWidth;
        var clientWidth = navLinks.clientWidth;
        var maxScroll = scrollWidth - clientWidth;

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

return {
    init: function() {
        var refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                TournamentApp.manualRefresh();
            });
        }

        initNavScrollIndicator();
        fetchTournamentData();
        this.startAutoRefresh();
    },

    manualRefresh: function() {
        if (isRefreshing) return;

        isRefreshing = true;
        var btn = document.getElementById('refreshBtn');
        if (btn) btn.disabled = true;

        fetchTournamentData();

        var timeout = CONFIG && CONFIG.REFRESH_TIMEOUT ? CONFIG.REFRESH_TIMEOUT : 2000;
        setTimeout(function() {
            isRefreshing = false;
            if (btn) btn.disabled = false;
        }, timeout);
    },

    startAutoRefresh: function() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        
        var interval = CONFIG && CONFIG.AUTO_REFRESH_INTERVAL ? CONFIG.AUTO_REFRESH_INTERVAL : 60000;
        autoRefreshInterval = setInterval(function() {
            fetchTournamentData();
        }, interval);
    },

    stopAutoRefresh: function() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    },

    openMatch: function(court, gameNum) {
        if (!court) return;
        window.location.href = 'scoreboard.html#' + court + '-' + gameNum;
    }
};

})();

document.addEventListener('DOMContentLoaded', function() {
TournamentApp.init();
});

window.addEventListener('beforeunload', function() {
TournamentApp.stopAutoRefresh();
});