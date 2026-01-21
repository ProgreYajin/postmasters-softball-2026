/**
 * アプリケーション設定ファイル
 */

const CONFIG = {
    // ==================== APIエンドポイント ====================

    STAFF_API_URL: 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec',
    AUDIENCE_API_URL: 'https://script.google.com/macros/s/AKfycbyuzbb9txRNAsHRbVcmmB17tROBnOii87QtP13KcfoTMk4tSLeJ9tmT5IwHUHa1omS6uw/exec',

    // ==================== 定数 ====================

    AUTO_REFRESH_INTERVAL: 60000,
    REFRESH_TIMEOUT: 2000,
    MAX_INNINGS: 6,
    PLACEHOLDER_PATTERNS: /第\d+試合(勝者|敗者)|TBD|未定|待機中/,

    // ==================== トーナメント表設定（座標調整版） ====================

    /**
     * チーム座標マッピング
     */
    TEAM_COORDINATES: {
        // メイントーナメントのチーム（Y: 700）
        '南部': { x: 50, y: 900, isSeed: true, gameNum: null },
        '東南': { x: 200, y: 900, isSeed: false, gameNum: 1 },
        '中部': { x: 350, y: 900, isSeed: false, gameNum: 1 },
        '印旛': { x: 500, y: 900, isSeed: false, gameNum: 2 },
        '西部': { x: 650, y: 900, isSeed: false, gameNum: 2 },
        '東部': { x: 800, y: 900, isSeed: false, gameNum: 3 },
        '北部': { x: 950, y: 900, isSeed: false, gameNum: 3 },

        // 3位決定戦用チームカード（Y: 500 = 準決勝と同じ行、真ん中に寄せる）
        '第4試合敗者': { x: 1050, y: 700, isSeed: false, gameNum: 6, position: 'team1' },
        '第5試合敗者': { x: 1300, y: 700, isSeed: false, gameNum: 6, position: 'team2' }
    },

    /**
     * 試合ブロック座標
     */
    MATCH_COORDINATES: {
        // 1回戦（Y: 500）
        1: { x: 275, y: 700, round: 1, label: '第1試合' },
        2: { x: 575, y: 700, round: 1, label: '第2試合' },
        3: { x: 875, y: 700, round: 1, label: '第3試合' },

        // 準決勝（Y: 300）
        4: { x: 200, y: 500, round: 2, label: '第4試合（準決勝）' },
        5: { x: 725, y: 500, round: 2, label: '第5試合（準決勝）' },

        // 決勝戦と3位決定戦（Y: 100 = 同じ行）
        6: { x: 1175, y: 300, round: 3, label: '第6試合（3位決定戦）', special: 'third' },
        7: { x: 425, y: 300, round: 3, label: '第7試合（決勝）', special: 'final' }
    },

    /**
     * 3位カード座標
     * 第6試合の200px上（優勝カードと対称）
     */
    THIRD_PLACE_CARD: {
        x: 1200,
        y: 100,  // 第6試合(Y:100)の200px上
        label: '3位'
    },

    TOURNAMENT_CANVAS: {
        width: 1000,
        height: 1000,
        viewBox: '0 0 1000 1000'
    },

    CARD_SIZE: {
        width: 120,
        height: 80
    },

    TEAM_ICONS: {
        '南部': '🏆',
        '東南': '⚾',
        '中部': '🥎',
        '印旛': '⭐',
        '西部': '⚡',
        '東部': '🎯',
        '北部': '🔥',
        '第4試合敗者': '📍',
        '第5試合敗者': '📍'
        '北部': '🔥',
        '第4試合敗者': '📍',
        '第5試合敗者': '📍'
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
        return this.TEAM_ICONS[teamName] || '📍';
    },

    updateTeamCoordinates(apiTeams) {
        if (!Array.isArray(apiTeams) || apiTeams.length === 0) {
            console.warn('⚠️ トーナメント表データが空です。デフォルト値を使用します。');
            return;
        }

        const newCoordinates = {};
        apiTeams.forEach(team => {
            newCoordinates[team.name] = {
                x: team.x,
                y: team.y,
                isSeed: team.isSeed,
                gameNum: team.gameNum,
                position: team.position
            };
        });

        this.TEAM_COORDINATES = newCoordinates;
        console.log('✅ トーナメント表座標を更新しました:', Object.keys(newCoordinates));
    }
};

// グローバルに公開
window.CONFIG = CONFIG;