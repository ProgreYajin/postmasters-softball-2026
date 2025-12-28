/**

- アプリケーション設定ファイル
- APIエンドポイント、定数などを一元管理
  */

const CONFIG = {
// ==================== APIエンドポイント ====================

```
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
 * デフォルト: 7イニング
 */
MAX_INNINGS: 7,

/**
 * プレースホルダー判定の正規表現パターン
 * チーム名が未確定かどうかを判定
 */
PLACEHOLDER_PATTERNS: /第\d+試合(勝者|敗者)|TBD|未定|待機中/,

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
 * 
 * @param {Object} obj - 対象オブジェクト
 * @param {...string} keyVariants - 取得したいキーのバリエーション
 * @returns {*} 見つかった値、または undefined
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
 * 
 * @param {string} str - エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
},

/**
 * プレースホルダーかどうか判定
 * 
 * @param {string} teamName - チーム名
 * @returns {boolean} プレースホルダーならtrue
 */
isPlaceholder(teamName) {
    if (!teamName) return true;
    return this.PLACEHOLDER_PATTERNS.test(teamName);
}
```

};

// グローバルに公開（他のスクリプトから利用可能にする）
window.CONFIG = CONFIG;
