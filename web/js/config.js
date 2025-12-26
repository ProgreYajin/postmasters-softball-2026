/**
 * 設定ファイル
 * すべてのページで使用するAPI URLと共通設定
 */

const CONFIG = {
    // ==================== API設定 ====================
    
    /**
     * スタッフ用Bot API URL（試合データ用）
     * Google Apps ScriptのウェブアプリURL
     */
    STAFF_API_URL: 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec',
    
    /**
     * 観客用Bot API URL（写真ギャラリー用）
     * Google Apps ScriptのウェブアプリURL
     */
    AUDIENCE_API_URL: 'https://script.google.com/macros/s/AKfycbyuzbb9txRNAsHRbVcmmB17tROBnOii87QtP13KcfoTMk4tSLeJ9tmT5IwHUHa1omS6uw/exec',
    
    // ==================== 共通設定 ====================
    
    /**
     * 自動更新間隔（ミリ秒）
     * デフォルト: 60000ms = 60秒
     */
    AUTO_REFRESH_INTERVAL: 60000,
    
    /**
     * 表示する最大イニング数
     */
    MAX_INNINGS: 7,
    
    /**
     * プレースホルダーパターン（チーム名判定用）
     */
    PLACEHOLDER_PATTERNS: /第\d+試合(勝者|敗者)|TBD|未定/,
    
    // ==================== ヘルパー関数 ====================
    
    /**
     * スタッフAPIが設定されているか確認
     */
    isStaffApiConfigured() {
        return this.STAFF_API_URL && 
               this.STAFF_API_URL !== '' && 
               !this.STAFF_API_URL.includes('YOUR_STAFF_SCRIPT_ID');
    },
    
    /**
     * 観客APIが設定されているか確認
     */
    isAudienceApiConfigured() {
        return this.AUDIENCE_API_URL && 
               this.AUDIENCE_API_URL !== '' && 
               !this.AUDIENCE_API_URL.includes('YOUR_AUDIENCE_SCRIPT_ID');
    },
    
    /**
     * 少なくとも1つのAPIが設定されているか確認
     */
    isApiConfigured() {
        return this.isStaffApiConfigured() || this.isAudienceApiConfigured();
    },
    
    /**
     * チーム名がプレースホルダーか判定
     */
    isPlaceholder(teamName) {
        if (!teamName || teamName === '') return true;
        return this.PLACEHOLDER_PATTERNS.test(teamName);
    }
};

// グローバルに公開
window.CONFIG = CONFIG;

// デバッグ用（開発時のみ）
console.log('CONFIG loaded:', {
    staffApiConfigured: CONFIG.isStaffApiConfigured(),
    audienceApiConfigured: CONFIG.isAudienceApiConfigured()
});
