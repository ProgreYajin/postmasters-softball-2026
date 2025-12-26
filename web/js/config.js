// ============================================================
// 設定ファイル読み込みモジュール（本番品質版）
// ============================================================

/**
 * 設定管理モジュール
 * - Promise共通化による多重実行防止
 * - ストレージエラー耐性
 * - メモリフォールバック機能
 */
const ConfigManager = (() => {
  // ============================================================
  // プライベート状態
  // ============================================================
  
  const CONFIG_STORAGE_KEY = 'app_config_cache';
  const CONFIG_FILE_PATH = '/config.json';
  
  // 設定キャッシュ（メモリ）
  let memoryCache = null;
  
  // 実行中のPromise（多重実行防止用）
  let loadingPromise = null;
  
  // ストレージ利用可否フラグ
  let storageAvailable = true;

  // ============================================================
  // ストレージユーティリティ
  // ============================================================
  
  /**
   * sessionStorageが利用可能かチェック
   * @returns {boolean}
   */
  const isStorageAvailable = () => {
    try {
      const testKey = '__storage_test__';
      sessionStorage.setItem(testKey, 'test');
      sessionStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn('[Config] sessionStorageが利用できません:', error.message);
      return false;
    }
  };

  /**
   * sessionStorageから安全に取得
   * @param {string} key
   * @returns {Object|null}
   */
  const getFromStorage = (key) => {
    if (!storageAvailable) return null;
    
    try {
      const cached = sessionStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('[Config] ストレージ読み込みエラー:', error.message);
      storageAvailable = false;
      return null;
    }
  };

  /**
   * sessionStorageに安全に保存
   * @param {string} key
   * @param {Object} value
   * @returns {boolean} 成功したかどうか
   */
  const saveToStorage = (key, value) => {
    if (!storageAvailable) return false;
    
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('[Config] ストレージ保存エラー:', error.message);
      storageAvailable = false;
      return false;
    }
  };

  /**
   * sessionStorageから安全に削除
   * @param {string} key
   */
  const removeFromStorage = (key) => {
    if (!storageAvailable) return;
    
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn('[Config] ストレージ削除エラー:', error.message);
    }
  };

  // ============================================================
  // 設定バリデーション
  // ============================================================
  
  /**
   * 設定オブジェクトの妥当性検証
   * @param {Object} config
   * @throws {Error} 必須項目が不足している場合
   */
  const validateConfig = (config) => {
    if (!config || typeof config !== 'object') {
      throw new Error('設定が無効です: オブジェクトではありません');
    }

    if (!config.staffBotApiUrl || typeof config.staffBotApiUrl !== 'string') {
      throw new Error('設定が無効です: staffBotApiUrlが不足しているか、文字列ではありません');
    }

    // URLの形式チェック（簡易版）
    try {
      new URL(config.staffBotApiUrl);
    } catch (error) {
      throw new Error(`staffBotApiUrlのURL形式が無効です: ${config.staffBotApiUrl}`);
    }

    // audienceBotApiUrlが存在する場合もチェック
    if (config.audienceBotApiUrl) {
      try {
        new URL(config.audienceBotApiUrl);
      } catch (error) {
        throw new Error(`audienceBotApiUrlのURL形式が無効です: ${config.audienceBotApiUrl}`);
      }
    }
  };

  // ============================================================
  // 設定読み込みコア処理
  // ============================================================
  
  /**
   * config.jsonを実際に読み込む処理
   * @returns {Promise<Object>}
   * @throws {Error}
   */
  const fetchConfigFromFile = async () => {
    const response = await fetch(CONFIG_FILE_PATH, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `設定ファイルの読み込みに失敗しました: HTTP ${response.status} ${response.statusText}`
      );
    }

    const config = await response.json();
    
    // バリデーション
    validateConfig(config);
    
    return config;
  };

  /**
   * 設定を読み込む（キャッシュ優先、多重実行防止）
   * @returns {Promise<Object>}
   */
  const loadConfig = async () => {
    // ステップ1: メモリキャッシュ確認
    if (memoryCache) {
      console.log('[Config] メモリキャッシュから設定を返します');
      return memoryCache;
    }

    // ステップ2: 実行中のPromiseがあれば再利用（多重実行防止）
    if (loadingPromise) {
      console.log('[Config] 既存のロード処理を再利用します');
      return loadingPromise;
    }

    // ステップ3: sessionStorageキャッシュ確認
    const cachedConfig = getFromStorage(CONFIG_STORAGE_KEY);
    if (cachedConfig) {
      console.log('[Config] sessionStorageから設定を読み込みました');
      memoryCache = cachedConfig;
      return cachedConfig;
    }

    // ステップ4: 新規読み込み
    console.log('[Config] config.jsonを読み込みます');
    
    loadingPromise = (async () => {
      try {
        const config = await fetchConfigFromFile();
        
        // メモリキャッシュに保存
        memoryCache = config;
        
        // sessionStorageに保存（失敗してもエラーにしない）
        const saved = saveToStorage(CONFIG_STORAGE_KEY, config);
        if (saved) {
          console.log('[Config] 設定をsessionStorageに保存しました');
        } else {
          console.log('[Config] sessionStorage保存失敗、メモリキャッシュのみ使用します');
        }
        
        return config;
        
      } catch (error) {
        console.error('[Config] 設定読み込みエラー:', error);
        throw error;
        
      } finally {
        // Promise参照をクリア
        loadingPromise = null;
      }
    })();

    return loadingPromise;
  };

  // ============================================================
  // キャッシュ管理
  // ============================================================
  
  /**
   * すべてのキャッシュをクリア
   */
  const clearCache = () => {
    memoryCache = null;
    loadingPromise = null;
    removeFromStorage(CONFIG_STORAGE_KEY);
    console.log('[Config] すべてのキャッシュをクリアしました');
  };

  /**
   * 設定を強制的に再読み込み
   * @returns {Promise<Object>}
   */
  const reloadConfig = async () => {
    clearCache();
    return loadConfig();
  };

  // ============================================================
  // API URL取得
  // ============================================================
  
  /**
   * 特定のAPI URLを取得
   * @param {string} apiType - 'staff' または 'audience'
   * @returns {Promise<string>}
   * @throws {Error}
   */
  const getApiUrl = async (apiType = 'staff') => {
    if (!['staff', 'audience'].includes(apiType)) {
      throw new Error(`無効なAPIタイプ: ${apiType}（'staff' または 'audience' を指定してください）`);
    }

    const config = await loadConfig();

    if (apiType === 'staff') {
      return config.staffBotApiUrl;
    }

    // audienceの場合、フォールバックあり
    return config.audienceBotApiUrl || config.staffBotApiUrl;
  };

  // ============================================================
  // 初期化時チェック
  // ============================================================
  
  // ストレージ利用可否を確認
  storageAvailable = isStorageAvailable();

  // ============================================================
  // 公開API
  // ============================================================
  
  return {
    /**
     * 設定を読み込む
     * @returns {Promise<Object>}
     */
    loadConfig,

    /**
     * API URLを取得
     * @param {string} apiType - 'staff' または 'audience'
     * @returns {Promise<string>}
     */
    getApiUrl,

    /**
     * キャッシュをクリア
     */
    clearCache,

    /**
     * 設定を強制再読み込み
     * @returns {Promise<Object>}
     */
    reloadConfig,

    /**
     * 現在のキャッシュ状態を取得（デバッグ用）
     * @returns {Object}
     */
    getCacheState() {
      return {
        hasMemoryCache: !!memoryCache,
        hasStorageCache: !!getFromStorage(CONFIG_STORAGE_KEY),
        storageAvailable,
        isLoading: !!loadingPromise
      };
    }
  };
})();

// ============================================================
// 後方互換性のためのグローバル関数エクスポート
// ============================================================

/**
 * 設定を読み込む（後方互換）
 * @returns {Promise<Object>}
 */
const loadConfig = () => ConfigManager.loadConfig();

/**
 * API URLを取得（後方互換）
 * @param {string} apiType
 * @returns {Promise<string>}
 */
const getApiUrl = (apiType) => ConfigManager.getApiUrl(apiType);

/**
 * キャッシュをクリア（後方互換）
 */
const clearConfigCache = () => ConfigManager.clearCache();

// ============================================================
// 使用例・テストコード
// ============================================================

/**
 * 多重実行のテスト
 */
async function testConcurrentCalls() {
  console.log('=== 多重実行テスト開始 ===');
  
  // 同時に5回呼び出し
  const promises = Array.from({ length: 5 }, (_, i) => 
    ConfigManager.getApiUrl('staff').then(url => {
      console.log(`呼び出し${i + 1}: ${url}`);
      return url;
    })
  );

  const results = await Promise.all(promises);
  console.log('すべて同じPromiseを再利用:', new Set(results).size === 1);
  console.log('=== 多重実行テスト完了 ===');
}

/**
 * ストレージエラー耐性テスト
 */
async function testStorageResilience() {
  console.log('=== ストレージエラー耐性テスト開始 ===');
  
  // sessionStorageを無効化（シミュレーション）
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error('QuotaExceededError');
  };

  try {
    ConfigManager.clearCache();
    const url = await ConfigManager.getApiUrl('staff');
    console.log('ストレージエラーでも取得成功:', url);
    console.log('キャッシュ状態:', ConfigManager.getCacheState());
  } finally {
    // 元に戻す
    Storage.prototype.setItem = originalSetItem;
  }

  console.log('=== ストレージエラー耐性テスト完了 ===');
}

// デバッグモードの場合のみテスト実行
if (typeof window !== 'undefined' && window.location.search.includes('debug=config')) {
  console.log('🔧 config.js デバッグモード');
  testConcurrentCalls().catch(console.error);
  testStorageResilience().catch(console.error);
}

// ============================================================
// index-app.js との橋渡し設定（互換性維持のため）
// ============================================================
const CONFIG = {
    // 実際のURLに書き換えてください
    STAFF_API_URL: 'https://script.google.com/macros/s/AKfycby17_LC3yqT-_t16_nBkoXyZ7ZL8ku1cD__kCP5oF3VhVUaN3khClsffH70IaMt058/exec', 
    AUDIENCE_API_URL: 'https://script.google.com/macros/s/AKfycbyuzbb9txRNAsHRbVcmmB17tROBnOii87QtP13KcfoTMk4tSLeJ9tmT5IwHUHa1omS6uw/exec',
    AUTO_REFRESH_INTERVAL: 60000,
    
    isStaffApiConfigured: function() {
        return !!this.STAFF_API_URL && this.STAFF_API_URL.includes('http');
    },
    isAudienceApiConfigured: function() {
        return !!this.AUDIENCE_API_URL && this.AUDIENCE_API_URL.includes('http');
    }
};
