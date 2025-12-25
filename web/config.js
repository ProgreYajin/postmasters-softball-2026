// ============================================================
// 設定ファイル読み込みモジュール
// ============================================================

/**
 * セッションストレージのキー名
 */
const CONFIG_STORAGE_KEY = 'app_config_cache';

/**
 * config.jsonを読み込んでAPI URLを取得する関数
 * 
 * 動作の流れ:
 * 1. sessionStorageにキャッシュがあればそれを返す
 * 2. なければconfig.jsonをfetchで取得
 * 3. 取得した設定をsessionStorageに保存
 * 4. 設定オブジェクトを返す
 * 
 * @returns {Promise<Object>} 設定オブジェクト
 * @throws {Error} 読み込みに失敗した場合
 */
async function loadConfig() {
  try {
    // ステップ1: キャッシュの確認
    const cached = sessionStorage.getItem(CONFIG_STORAGE_KEY);
    
    if (cached) {
      console.log('[Config] キャッシュから設定を読み込みました');
      return JSON.parse(cached);
    }
    
    // ステップ2: config.jsonの読み込み
    // キャッシュ対策としてタイムスタンプをクエリパラメータに追加
    const timestamp = new Date().getTime();
    const response = await fetch(`/config.json?t=${timestamp}`, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // HTTPステータスコードのチェック
    if (!response.ok) {
      throw new Error(`設定ファイルの読み込みに失敗しました (HTTP ${response.status})`);
    }
    
    // ステップ3: JSONのパース
    const config = await response.json();
    
    // 必須項目の検証
    if (!config.staffBotApiUrl) {
      throw new Error('設定ファイルにstaffBotApiUrlが含まれていません');
    }
    
    // ステップ4: sessionStorageに保存
    sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    console.log('[Config] 設定ファイルを読み込み、キャッシュに保存しました');
    
    return config;
    
  } catch (error) {
    console.error('[Config] 設定読み込みエラー:', error);
    
    // エラーメッセージをユーザーに表示（オプション）
    const errorMsg = `設定ファイルの読み込みに失敗しました: ${error.message}`;
    console.error(errorMsg);
    
    throw error; // 呼び出し元でエラーハンドリングできるように再スロー
  }
}

/**
 * キャッシュをクリアする関数
 * 設定を更新した後などに使用
 */
function clearConfigCache() {
  sessionStorage.removeItem(CONFIG_STORAGE_KEY);
  console.log('[Config] キャッシュをクリアしました');
}

/**
 * 特定のAPI URLを取得するヘルパー関数
 * 
 * @param {string} apiType - 取得するAPIの種類 ('staff' または 'audience')
 * @returns {Promise<string>} API URL
 */
async function getApiUrl(apiType = 'staff') {
  const config = await loadConfig();
  
  if (apiType === 'staff') {
    return config.staffBotApiUrl;
  } else if (apiType === 'audience') {
    return config.audienceBotApiUrl || config.staffBotApiUrl; // フォールバック
  }
  
  throw new Error(`未知のAPIタイプ: ${apiType}`);
}
