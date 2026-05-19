/**
 * アプリケーション設定ファイル
 */

const CONFIG = {
    // ==================== APIエンドポイント ====================

    STAFF_API_URL: 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec',
    AUDIENCE_API_URL: 'https://script.google.com/macros/s/AKfycbyuzbb9txRNAsHRbVcmmB17tROBnOii87QtP13KcfoTMk4tSLeJ9tmT5IwHUHa1omS6uw/exec',

    // ==================== 定数 ====================

    AUTO_REFRESH_INTERVAL: 0,
    REFRESH_TIMEOUT: 2000,
    MAX_INNINGS: 6,
    PLACEHOLDER_PATTERNS: /第\d+試合(勝者|敗者)|TBD|未定|待機中/,

    // ==================== トーナメント表設定（座標調整版） ====================

    /**
     * チーム座標マッピング
     */
    TEAM_COORDINATES: {
        '印旛': { x: 50,  y: 900, isSeed: true,  gameNum: null, side: null },
        '①':   { x: 200, y: 900, isSeed: false, gameNum: 'A',  side: '1塁側' },
        '②':   { x: 350, y: 900, isSeed: false, gameNum: 'A',  side: '3塁側' },
        '③':   { x: 500, y: 900, isSeed: false, gameNum: 'B',  side: '1塁側' },
        '④':   { x: 650, y: 900, isSeed: false, gameNum: 'B',  side: '3塁側' },
        '⑤':   { x: 800, y: 900, isSeed: false, gameNum: 'C',  side: '1塁側' },
        '⑥':   { x: 950, y: 900, isSeed: false, gameNum: 'C',  side: '3塁側' },
    },

    /**
     * 試合ブロック座標
     */
    MATCH_COORDINATES: {
        'A': { x: 275,  y: 700, round: 1, label: 'A', time: '10:00', venue: '長嶋茂雄球場' },
        'B': { x: 575,  y: 700, round: 1, label: 'B', time: '10:00', venue: '第2球場' },
        'C': { x: 875,  y: 700, round: 1, label: 'C', time: '11:20', venue: '長嶋茂雄球場' },
        'D': { x: 200,  y: 500, round: 2, label: 'D', time: '13:00', venue: '長嶋茂雄球場', special: 'semi' },
        'E': { x: 725,  y: 500, round: 2, label: 'E', time: '13:00', venue: '第2球場',      special: 'semi' },
        'F': { x: 1175, y: 300, round: 3, label: 'F', time: '14:30', venue: '第2球場',       special: 'third' },
        'G': { x: 425,  y: 300, round: 3, label: 'G', time: '14:30', venue: '長嶋茂雄球場',  special: 'final' },
    },

    TOURNAMENT_CANVAS: {
        width: 1400,
        height: 1000,
        viewBox: '0 0 1400 1000'
    },

    CARD_SIZE: {
        width: 120,
        height: 80
    },

    TEAM_ICONS: {
        '印旛': '⭐',
    },

    // ==================== ヘルパーメソッド ====================

    isStaffApiConfigured() {
        return this.STAFF_API_URL &&
            !this.STAFF_API_URL.includes('YOUR_STAFF_SCRIPT_ID');
    },

    isAudienceApiConfigured() {
        return this.AUDIENCE_API_URL &&
            !this.AUDIENCE_API_URL.includes('YOUR_AUDIENCE_SCRIPT_ID');
    },

    isApiConfigured() {
        return this.isStaffApiConfigured();
    },

    get API_URL() {
        return this.STAFF_API_URL;
    },

    getSafeValue(obj, ...keyVariants) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const key of keyVariants) {
            if (key in obj && obj[key] !== null && obj[key] !== undefined) {
                return obj[key];
            }
        }
        return undefined;
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    isPlaceholder(teamName) {
        if (!teamName) return true;
        return this.PLACEHOLDER_PATTERNS.test(teamName);
    },

    getTeamIcon(teamName) {
        if (!teamName) return '📍';
        return this.TEAM_ICONS[teamName] || '⚾';
    },

    updateTeamCoordinates(apiTeams) {
        if (!Array.isArray(apiTeams) || apiTeams.length === 0) {
            console.warn('⚠️ トーナメント表データが空です。デフォルト値を使用します。');
            return;
        }

        const NUM_TO_LABEL = { 1:'A', 2:'B', 3:'C', 4:'D', 5:'E', 6:'F', 7:'G' };
        const newCoordinates = {};
        apiTeams.forEach(team => {
            const gameLabel = typeof team.gameNum === 'number'
                ? (NUM_TO_LABEL[team.gameNum] ?? team.gameNum)
                : (team.gameNum || null);
            newCoordinates[team.name] = {
                x: team.x,
                y: team.y,
                isSeed: team.isSeed,
                gameNum: gameLabel,
                position: team.position
            };
        });

        this.TEAM_COORDINATES = newCoordinates;
        console.log('✅ トーナメント表座標を更新しました:', Object.keys(newCoordinates));
    }
};

// グローバルに公開
window.CONFIG = CONFIG;