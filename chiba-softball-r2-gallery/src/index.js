// ============================================
// Cloudflare Worker - R2アップロード用（改善版）
// ============================================

export default {
  async fetch(request, env) {
    // CORS対応（必要に応じて）
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    
    // POSTメソッドのみ許可
    if (request.method !== 'POST') {
      return jsonResponse({ 
        success: false, 
        error: 'Method not allowed. Only POST is supported.' 
      }, 405);
    }
    
    try {
      // 認証チェック
      const authToken = request.headers.get('X-Auth-Token');
      if (!authToken || authToken !== env.WORKER_AUTH_TOKEN) {
        console.error('認証失敗: トークン不一致');
        return jsonResponse({ 
          success: false, 
          error: 'Unauthorized: Invalid or missing auth token' 
        }, 401);
      }
      
      // ヘッダーから情報取得
      const filename = request.headers.get('X-Filename');
      const contentType = request.headers.get('X-Content-Type') || 'image/jpeg';
      
      if (!filename) {
        return jsonResponse({ 
          success: false, 
          error: 'Missing X-Filename header' 
        }, 400);
      }
      
      // ファイル名のバリデーション（セキュリティ対策）
      if (!isValidFilename(filename)) {
        return jsonResponse({ 
          success: false, 
          error: 'Invalid filename format' 
        }, 400);
      }
      
      // 画像データ取得
      const imageData = await request.arrayBuffer();
      const imageSizeKB = (imageData.byteLength / 1024).toFixed(2);
      
      console.log(`アップロード開始: ${filename} (${imageSizeKB}KB, ${contentType})`);
      
      // サイズチェック（例: 最大20MB）
      const MAX_SIZE_MB = 20;
      const maxSizeBytes = MAX_SIZE_MB * 1024 * 1024;
      
      if (imageData.byteLength > maxSizeBytes) {
        return jsonResponse({ 
          success: false, 
          error: `File too large. Max size: ${MAX_SIZE_MB}MB` 
        }, 413);
      }
      
      // R2にアップロード
      await env.R2_BUCKET.put(filename, imageData, {
        httpMetadata: {
          contentType: contentType
        },
        customMetadata: {
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'line-bot'
        }
      });
      
      console.log(`✓ アップロード成功: ${filename}`);
      
      // 公開URLを生成
      const publicUrl = `${env.R2_PUBLIC_URL}/${filename}`;
      
      return jsonResponse({ 
        success: true,
        url: publicUrl,
        filename: filename,
        size: imageData.byteLength,
        contentType: contentType
      }, 200);
      
    } catch (error) {
      console.error('アップロードエラー:', error);
      return jsonResponse({ 
        success: false, 
        error: `Upload failed: ${error.message}` 
      }, 500);
    }
  }
};

// ============================================
// JSONレスポンス生成
// ============================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // 必要に応じて制限
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Filename, X-Content-Type, X-Auth-Token'
    }
  });
}

// ============================================
// CORS Preflightハンドリング
// ============================================
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Filename, X-Content-Type, X-Auth-Token',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// ============================================
// ファイル名バリデーション（セキュリティ対策）
// ============================================
function isValidFilename(filename) {
  // 基本的なパターンチェック
  // photo_<timestamp>_<messageId>.<ext> の形式を想定
  const validPattern = /^photo_\d+_[A-Za-z0-9]+\.(jpg|jpeg|png|gif|webp|bmp)$/i;
  
  if (!validPattern.test(filename)) {
    console.warn(`無効なファイル名: ${filename}`);
    return false;
  }
  
  // パストラバーサル対策
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    console.warn(`危険なファイル名: ${filename}`);
    return false;
  }
  
  return true;
}