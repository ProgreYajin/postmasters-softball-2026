// ============================================
// 観客用BOT - Cloudflare R2対応 (Refactored)
// ============================================

const PROPS = PropertiesService.getScriptProperties();
const CONFIG = {
  LINE_ACCESS_TOKEN: PROPS.getProperty('LINE_ACCESS_TOKEN'),
  CHANNEL_SECRET: PROPS.getProperty('CHANNEL_SECRET'), // ★追加: 署名検証用
  R2_UPLOAD_WORKER_URL: PROPS.getProperty('R2_UPLOAD_WORKER_URL'),
  WORKER_AUTH_TOKEN: PROPS.getProperty('WORKER_AUTH_TOKEN'),
  MAX_IMAGE_SIZE_MB: 10
};

const SHEETS = {
  PHOTOS: '写真投稿',
  USERS: 'ユーザー一覧'
};

const MAX_IMAGE_SIZE_BYTES = CONFIG.MAX_IMAGE_SIZE_MB * 1024 * 1024;

// ============================================
// LINE Webhook受信
// ============================================
function doPost(e) {
  // 1. 署名検証 (セキュリティ)
  if (!validateSignature(e)) {
    return ContentService.createTextOutput('Invalid Signature')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    if (!e || !e.postData) return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }));

    const json = JSON.parse(e.postData.contents);

    // スタッフbotからの内部ブロードキャストリクエスト
    if (json.type === 'broadcast' && json.message) {
      broadcastToAllUsers(json.message);
      return ContentService.createTextOutput(JSON.stringify({ status: 'broadcast_sent' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const events = json.events;
    if (!events) return ContentService.createTextOutput('ok');

    events.forEach(event => {
      const userId = event.source.userId;
      const replyToken = event.replyToken;

      // ★追加: ユーザー情報の保存・更新（ブロードキャスト用）
      if (userId) saveUserIfNew(userId);

      // ★追加: イベント重複チェック (キャッシュロック)
      if (isEventProcessed(event.webhookEventId)) return;

      if (event.type === 'message') {
        if (event.message.type === 'image') {
          handleImageMessage(event.message.id, userId, replyToken);
        }
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('doPost Error:', error); // Loggerよりconsole.error推奨
    // エラーでもLINE側には200を返して再送を防ぐのが定石
    return ContentService.createTextOutput(JSON.stringify({ status: 'error' }));
  }
}

// 署名検証ロジック
function validateSignature(e) {
  if (!CONFIG.CHANNEL_SECRET) return true; // 設定なければスキップ(開発時用だが本番は必須)
  const signature = e.requestHeaders['x-line-signature'];
  if (!signature) return false;
  const computedSignature = Utilities.computeHmacSha256Signature(e.postData.contents, CONFIG.CHANNEL_SECRET);
  const computedSignatureBase64 = Utilities.base64Encode(computedSignature);
  return signature === computedSignatureBase64;
}

// 重複イベントチェック (LINEの再送対策)
function isEventProcessed(eventId) {
  if (!eventId) return false;
  const cache = CacheService.getScriptCache();
  if (cache.get(eventId)) return true; // 処理済み
  cache.put(eventId, 'processed', 60); // 60秒間記憶
  return false;
}

// ============================================
// 画像メッセージ処理
// ============================================
function handleImageMessage(messageId, userId, replyToken) {
  try {
    // LINEから画像を取得
    const imageResult = getImageFromLine(messageId);
    if (!imageResult.success) {
      replyMessage(replyToken, '⚠️ 画像の取得に失敗しました。時間をおいて再送してください。');
      return;
    }

    const { blob, contentType, size } = imageResult;

    // サイズチェック
    if (size > MAX_IMAGE_SIZE_BYTES) {
      const sizeMB = (size / (1024 * 1024)).toFixed(2);
      replyMessage(replyToken, `⚠️ サイズ超過 (${sizeMB}MB)\n${CONFIG.MAX_IMAGE_SIZE_MB}MB以下にしてください。`);
      return;
    }

    // ユーザー名取得 (APIコール節約のため、必要なら実行する形でもよいがUX優先で取得)
    const userName = getUserName(userId);

    // R2にアップロード
    const timestamp = new Date().getTime();
    const extension = getExtensionFromMimeType(contentType);
    const filename = `photo_${timestamp}_${messageId}${extension}`;

    const uploadResult = uploadToR2(blob, filename, contentType);

    if (!uploadResult.success) {
      console.error('R2 Upload Failed:', uploadResult.error);
      replyMessage(replyToken, '⚠️ 保存に失敗しました。もう一度お試しください。');
      return;
    }

    // スプレッドシートに記録
    savePhotoRecord(uploadResult.url, uploadResult.url, userName, userId, messageId, contentType);

    // 成功メッセージ
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    replyMessage(replyToken, `📸 保存しました！ (${sizeMB}MB)\nギャラリーに追加されます。`);

  } catch (error) {
    console.error('handleImageMessage Error:', error);
    replyMessage(replyToken, '⚠️ エラーが発生しました。');
  }
}

// ============================================
// LINEから画像取得
// ============================================
function getImageFromLine(messageId) {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  try {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return { success: false, error: response.getContentText() };
    }

    const blob = response.getBlob();
    return {
      success: true,
      blob: blob,
      contentType: response.getHeaders()['Content-Type'] || 'image/jpeg',
      size: blob.getBytes().length // ここだけはサイズ判定のためにBytes取得が必要
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================
// R2にアップロード (メモリ効率化)
// ============================================
function uploadToR2(blob, filename, contentType) {
  try {
    // blob.getBytes() をやめ、blob自体をpayloadに渡す
    const response = UrlFetchApp.fetch(CONFIG.R2_UPLOAD_WORKER_URL, {
      method: 'post',
      contentType: 'application/octet-stream', // Worker側がこれを受け取る前提
      payload: blob,
      headers: {
        'X-Filename': filename,
        'X-Content-Type': contentType,
        'X-Auth-Token': CONFIG.WORKER_AUTH_TOKEN
      },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      return { success: false, error: `Worker Error ${statusCode}: ${responseText}` };
    }

    const result = JSON.parse(responseText);
    return result.success ? { success: true, url: result.url } : { success: false, error: result.error };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// ============================================
// ユーザー管理 (新規追加)
// ============================================
function saveUserIfNew(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.USERS);
    sheet.appendRow(['登録日時', 'ユーザーID', '表示名(初回)']);
  }

  // テキスト検索で簡易的な重複チェック (ユーザー数が増えると遅くなるため、本来はCacheやMap推奨)
  // createTextFinderは高速なので数千人規模なら許容範囲
  const finder = sheet.getRange("B:B").createTextFinder(userId).matchEntireCell(true);
  if (!finder.findNext()) {
    const userName = getUserName(userId);
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([now, userId, userName]);
  }
}

// ============================================
// ユーティリティ
// ============================================
function getExtensionFromMimeType(mimeType) {
  const mimeMap = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp'
  };
  return mimeMap[mimeType.toLowerCase()] || '.jpg';
}

function getUserName(userId) {
  const cache = CacheService.getScriptCache();
  const cachedName = cache.get(`name_${userId}`);
  if (cachedName) return cachedName;

  try {
    const response = UrlFetchApp.fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200) {
      const name = JSON.parse(response.getContentText()).displayName || '投稿者';
      cache.put(`name_${userId}`, name, 21600); // 6時間キャッシュ
      return name;
    }
  } catch (e) {
    console.warn('UserName fetch failed', e);
  }
  return '投稿者';
}

function savePhotoRecord(fullUrl, thumbUrl, userName, userId, messageId, contentType) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.PHOTOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.PHOTOS);
    sheet.appendRow(['タイムスタンプ', 'ユーザー名', 'ユーザーID', '画像URL', 'サムネイル', 'MsgID', 'MIME']);
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([now, userName, userId, fullUrl, thumbUrl, messageId, contentType]);
}

function replyMessage(replyToken, message) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN
    },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: message }] }),
    muteHttpExceptions: true
  });
}

// ============================================
// ブロードキャスト (修正版)
// ============================================
function broadcastToAllUsers(message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.USERS);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const data = sheet.getDataRange().getValues();
  const userIds = [];
  // B列がIDと仮定
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]) userIds.push(data[i][1]);
  }

  // 500人ずつ分割送信
  const CHUNK_SIZE = 500;
  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    try {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN
        },
        payload: JSON.stringify({ to: chunk, messages: [{ type: 'text', text: message }] }),
        muteHttpExceptions: true
      });
    } catch (e) {
      console.error('Broadcast error:', e);
    }
  }
}

// ============================================
// API: ギャラリー取得
// ============================================
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.PHOTOS);

  if (!sheet || sheet.getLastRow() <= 1) {
    return jsonResponse({ photos: [] });
  }

  const data = sheet.getDataRange().getValues();
  const photos = [];
  // 最新順にするため後ろからループ
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][3]) {
      photos.push({
        timestamp: data[i][0],
        userName: data[i][1],
        fullImage: data[i][3],
        thumbnail: data[i][4],
        contentType: data[i][6] || 'image/jpeg'
      });
    }
  }

  return jsonResponse({ photos: photos });
}

function jsonResponse(obj) {
  obj.lastUpdate = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss');
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}