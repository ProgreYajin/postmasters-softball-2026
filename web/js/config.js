/**
 * アプリケーション設定ファイル
 * APIエンドポイント、定数などを一元管理
 */

const CONFIG = {
    // ==================== APIエンドポイント ====================

    /**
     * スタッフ用BOTのAPI URL
     * スコアボード、試合予定、チーム名簿データを取得
     */
    STAFF_API_URL: 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec',

    /**
     * 観客用BOTのAPI URL
     * 写真ギャラリーデータを取得
     */
    AUDIENCE_API_URL: 'https://script.google.com/macros/s/AKfycbyuzbb9txRNAsHRbVcmmB17tROBnOii87QtP13KcfoTMk4tSLeJ9tmT5IwHUHa1omS6uw/exec',

    // ==================== 定数 ====================

    /**
     * 自動更新の間隔（ミリ秒）
     * デフォルト: 60000ms = 60秒
     */
    AUTO_REFRESH_INTERVAL: 60000,

    /**
     * 手動更新後の待機時間（ミリ秒）
     * デフォルト: 2000ms = 2秒
     */
    REFRESH_TIMEOUT: 2000,

    /**
     * 表示するイニング数
     * デフォルト: 6イニング
     */
    MAX_INNINGS: 6,

    /**
     * プレースホルダー判定の正規表現パターン
     * チーム名が未確定かどうかを判定
     */
    PLACEHOLDER_PATTERNS: /第\d+試合(勝者|敗者)|TBD|未定|待機中/,

    // ==================== トーナメント表設定 ====================

    /**
     * トーナメント表：チーム座標マッピング
     * x, y: 絶対座標（ピクセル）
     * isSeed: シードチームかどうか
     * gameNum: 参加する1回戦の試合番号（シードはnull）
     */
    TEAM_COORDINATES: {
        '南部': { x: 50, y: 900, isSeed: true, gameNum: null },
        '東南': { x: 200, y: 900, isSeed: false, gameNum: 1 },
        '中部': { x: 350, y: 900, isSeed: false, gameNum: 1 },
        '印旛': { x: 500, y: 900, isSeed: false, gameNum: 2 },
        '西部': { x: 650, y: 900, isSeed: false, gameNum: 2 },
        '東部': { x: 800, y: 900, isSeed: false, gameNum: 3 },
        '北部': { x: 950, y: 900, isSeed: false, gameNum: 3 }
    },

    /**
     * トーナメント表：試合ブロック座標
     * x, y: 試合ブロックの中心座標
     * round: ラウンド（1=1回戦, 2=準決勝, 3=決勝/3位決定戦）
     */
    MATCH_COORDINATES: {
        // 1回戦
        1: { x: 275, y: 750, round: 1, label: '第1試合' },
        2: { x: 575, y: 750, round: 1, label: '第2試合' },
        3: { x: 875, y: 750, round: 1, label: '第3試合' },
        
        // 準決勝
        4: { x: 200, y: 500, round: 2, label: '第4試合（準決勝）' },
        5: { x: 725, y: 500, round: 2, label: '第5試合（準決勝）' },
        
        // 決勝・3位決定戦
        6: { x: 650, y: 250, round: 3, label: '第6試合（3位決定戦）', special: 'third' },
        7: { x: 275, y: 250, round: 3, label: '第7試合（決勝）', special: 'final' }
    },

    /**
     * トーナメント表：SVGキャンバスサイズ
     */
    TOURNAMENT_CANVAS: {
        width: 1000,
        height: 1000,
        viewBox: '0 0 1000 1000'
    },

    /**
     * トーナメント表：カードサイズ
     */
    CARD_SIZE: {
        width: 120,
        height: 80
    },

    /**
     * トーナメント表：チームアイコン
     */
    TEAM_ICONS: {
        '南部': '🏆',
        '東南': '⚾',
        '中部': '🥎',
        '印旛': '⭐',
        '西部': '⚡',
        '東部': '🎯',
        '北部': '🔥'
    },

    // ==================== ヘルパーメソッド ====================

    /**
     * スタッフAPIが設定されているか確認
     */
    isStaffApiConfigured() {
        return this.STAFF_API_URL && 
               !this.STAFF_API_URL.includes('YOUR_STAFF_SCRIPT_ID');
    },

    /**
     * 観客APIが設定されているか確認
     */
    isAudienceApiConfigured() {
        return this.AUDIENCE_API_URL && 
               !this.AUDIENCE_API_URL.includes('YOUR_AUDIENCE_SCRIPT_ID');
    },

    /**
     * 旧コードとの互換性のためのエイリアス
     */
    isApiConfigured() {
        return this.isStaffApiConfigured();
    },

    /**
     * 旧コードとの互換性のためのエイリアス
     */
    get API_URL() {
        return this.STAFF_API_URL;
    },

    /**
     * JSONキーの値を安全に取得（大文字小文字対応）
     */
    getSafeValue(obj, ...keyVariants) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (const key of keyVariants) {
            if (key in obj && obj[key] !== null && obj[key] !== undefined) {
                return obj[key];
            }
        }
        return undefined;
    },

    /**
     * HTMLエスケープ（XSS対策）
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * プレースホルダーかどうか判定
     */
    isPlaceholder(teamName) {
        if (!teamName) return true;
        return this.PLACEHOLDER_PATTERNS.test(teamName);
    },

    /**
     * チームアイコンを取得
     */
    getTeamIcon(teamName) {
        if (!teamName) return '📍';
        return this.TEAM_ICONS[teamName] || '📍';
    }
};

// グローバルに公開
window.CONFIG = CONFIG;
