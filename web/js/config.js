/**
 * アプリケーション設定ファイル
 * APIエンドポイント、更新間隔、その他の設定をここで一括管理
 */

const CONFIG = {
    // ===== API設定 =====
    // Google Apps ScriptのウェブアプリURLを設定してください
    API_URL: (() => {
        // URLパラメータから取得（優先度1）
        const urlParams = new URLSearchParams(window.location.search);
        const urlApi = urlParams.get('api') || urlParams.get('staff_api');
        if (urlApi) {
            localStorage.setItem('STAFF_BOT_API_URL', urlApi);
            return urlApi;
        }

        // LocalStorageから取得（優先度2）
        const storedApi = localStorage.getItem('STAFF_BOT_API_URL');
        if (storedApi) {
            return storedApi;
        }

        // デフォルト値（優先度3）
        // 以下のURLを実際のGAS URLに置き換えてください
        return 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec';
    })(),

    // ===== 更新設定 =====
    AUTO_REFRESH_INTERVAL: 60000, // 60秒ごとに自動更新
    REFRESH_TIMEOUT: 5000,         // リフレッシュボタンの無効化時間（ミリ秒）

    // ===== UI設定 =====
    MAX_INNINGS: 7,           // 表示する最大イニング数
    PLACEHOLDER_PATTERNS: [   // プレースホルダー判定の正規表現
        /第\d+試合勝者/,
        /第\d+試合敗者/,
        /TBD/i,
        /未定/
    ],

    // ===== ローカルストレージキー =====
    STORAGE_KEY: {
        API_URL: 'STAFF_BOT_API_URL',
        CURRENT_COURT: 'CURRENT_SELECTED_COURT'
    },

    // ===== ユーティリティメソッド =====
    /**
     * APIが有効に設定されているか判定
     */
    isApiConfigured() {
        return this.API_URL && 
               !this.API_URL.includes('YOUR_SCRIPT_ID');
    },

    /**
     * テキストがプレースホルダーかどうかを判定
     */
    isPlaceholder(text) {
        if (!text || typeof text !== 'string') return true;
        return this.PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
    }
};

// デバッグ用ログ
if (window.location.hash === '#debug') {
    console.log('CONFIG:', CONFIG);
}
