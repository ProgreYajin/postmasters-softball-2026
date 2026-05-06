'use strict';

const assert = require('assert');

// ============================================================
// gas-staff/コード.js から抽出した定数
// ============================================================
const MAX_INNINGS = 6;

const STATUS = {
  STANDBY: '待機',
  PLAYING: '試合中',
  ENDED: '終了'
};

const INNING_TYPE = {
  TOP: '表',
  BOTTOM: '裏'
};

const COLS = {
  SCOREBOARD: {
    COURT: 0, GAME_NO: 1, TEAM_NAME: 2, INNING_START: 3,
    TOTAL: 3 + MAX_INNINGS, STATUS: 3 + MAX_INNINGS + 1, TIMESTAMP: 3 + MAX_INNINGS + 2
  }
};

// ============================================================
// gas-staff/コード.js から抽出した純粋関数
// ============================================================

function parseMessage(message) {
  const msg = message.trim().replace(/[ 　]+/g, ' ');
  let m;

  // 開始: A 開始 チームA チームB
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*開始\s+(.+?)\s+(.+)$/)) {
    return { type: 'start_with_teams', court: m[1], topTeam: m[2], bottomTeam: m[3] };
  }
  // 終了: A 終了
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*終了$/)) {
    return { type: 'end', court: m[1] };
  }
  // 再開: A 再開
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*再開$/)) {
    return { type: 'resume', court: m[1] };
  }
  // じゃんけん: A じゃんけん チーム名
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*じゃんけん\s+(.+)$/)) {
    return { type: 'janken', court: m[1], winnerTeam: m[2] };
  }
  // 得点+ホームラン: A 3表 4 ホームラン
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*(\d+)(表|裏)\s*(\d+)\s*ホームラン$/))
    return { type: 'score', court: m[1], inning: parseInt(m[2]), topBottom: m[3], score: parseInt(m[4]), homerun: true };
  // 得点: A 3表 4
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*(\d+)(表|裏)\s*(\d+)$/)) {
    return { type: 'score', court: m[1], inning: parseInt(m[2]), topBottom: m[3], score: parseInt(m[4]) };
  }
  return null;
}

// ============================================================
// コートから現在の試合番号を自動解決（テスト用）
// ============================================================
const SCHEDULE_COLS = { COURT: 0, GAME_NO: 1, TOP_TEAM: 2, BOTTOM_TEAM: 3, STATUS: 4 };

function getActiveGameForCourt(scheduleData, court, commandType) {
  if (commandType === 'start_with_teams') {
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][SCHEDULE_COLS.COURT] == court &&
          scheduleData[i][SCHEDULE_COLS.STATUS] === '待機') {
        return scheduleData[i][SCHEDULE_COLS.GAME_NO];
      }
    }
    return null;
  }
  if (commandType === 'resume') {
    let lastEndedGameNum = null;
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][SCHEDULE_COLS.COURT] == court &&
          scheduleData[i][SCHEDULE_COLS.STATUS] === '終了') {
        lastEndedGameNum = scheduleData[i][SCHEDULE_COLS.GAME_NO];
      }
    }
    return lastEndedGameNum;
  }
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][SCHEDULE_COLS.COURT] == court &&
        scheduleData[i][SCHEDULE_COLS.STATUS] === '試合中') {
      return scheduleData[i][SCHEDULE_COLS.GAME_NO];
    }
  }
  return null;
}

function determineWinner(scoreboardData, court, gameNum) {
  const teams = [];

  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      teams.push({
        name: scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME],
        total: scoreboardData[i][COLS.SCOREBOARD.TOTAL] || 0
      });
    }
  }

  if (teams.length < 2) {
    return { winnerTeam: null, loserTeam: null, isDraw: false };
  }

  const team1Total = Number(teams[0].total) || 0;
  const team2Total = Number(teams[1].total) || 0;

  if (team1Total > team2Total) {
    return { winnerTeam: teams[0].name, loserTeam: teams[1].name, isDraw: false };
  } else if (team2Total > team1Total) {
    return { winnerTeam: teams[1].name, loserTeam: teams[0].name, isDraw: false };
  } else {
    return { winnerTeam: null, loserTeam: null, isDraw: true };
  }
}

// formatTime: Utilities.formatDate はGAS固有なので、
// Date/number分岐のうちNode.jsで動く部分のみテスト
function formatTime(timeValue) {
  if (!timeValue) return '未定';

  if (timeValue instanceof Date) {
    // GAS版: Utilities.formatDate(timeValue, 'Asia/Tokyo', 'HH:mm')
    // Node.js互換版: toLocaleTimeString で代替
    const h = String(timeValue.getUTCHours()).padStart(2, '0');
    const m = String(timeValue.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (typeof timeValue === 'string') {
    return timeValue.trim();
  }
  if (typeof timeValue === 'number') {
    // Excelシリアル値 → Date変換
    const date = new Date((timeValue - 25569) * 86400 * 1000);
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return '未定';
}

// ============================================================
// テストユーティリティ
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  FAIL: ${name}`);
    console.log(`        ${e.message}`);
  }
}

// スコアボードのヘッダー行を含むモックデータ生成ヘルパー
// 列: court, gameNum, teamName, inn1..inn6, total, status, timestamp
function makeScoreboardRow(court, gameNum, teamName, innings, total, status) {
  const row = [court, gameNum, teamName, ...innings, total, status || '', ''];
  return row;
}

function makeScoreboardData(rows) {
  // ヘッダー行
  const header = ['コート', '試合', 'チーム名', '1', '2', '3', '4', '5', '6', '合計', 'ステータス', 'タイムスタンプ'];
  return [header, ...rows];
}

// ============================================================
// テスト実行
// ============================================================
console.log('\n=== parseMessage テスト ===');

// --- 正常系 ---
test('開始コマンド: A 開始 南部 東南', () => {
  const result = parseMessage('A 開始 南部 東南');
  assert.deepStrictEqual(result, {
    type: 'start_with_teams', court: 'A', topTeam: '南部', bottomTeam: '東南'
  });
});

test('得点コマンド: A 3表 4', () => {
  const result = parseMessage('A 3表 4');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'A', inning: 3, topBottom: '表', score: 4
  });
});

test('終了コマンド: A 終了', () => {
  const result = parseMessage('A 終了');
  assert.deepStrictEqual(result, {
    type: 'end', court: 'A'
  });
});

test('再開コマンド: A 再開', () => {
  const result = parseMessage('A 再開');
  assert.deepStrictEqual(result, {
    type: 'resume', court: 'A'
  });
});

test('じゃんけんコマンド: A じゃんけん 南部', () => {
  const result = parseMessage('A じゃんけん 南部');
  assert.deepStrictEqual(result, {
    type: 'janken', court: 'A', winnerTeam: '南部'
  });
});

test('裏の得点: B 1裏 0', () => {
  const result = parseMessage('B 1裏 0');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'B', inning: 1, topBottom: '裏', score: 0
  });
});

test('コート記法揺れ: Aコート 開始 南部 東南', () => {
  const result = parseMessage('Aコート 開始 南部 東南');
  assert.deepStrictEqual(result, {
    type: 'start_with_teams', court: 'A', topTeam: '南部', bottomTeam: '東南'
  });
});

test('コート記法揺れ(終了): Bコート 終了', () => {
  const result = parseMessage('Bコート 終了');
  assert.deepStrictEqual(result, {
    type: 'end', court: 'B'
  });
});

test('コート記法揺れ(得点): Aコート 4表 3', () => {
  const result = parseMessage('Aコート 4表 3');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'A', inning: 4, topBottom: '表', score: 3
  });
});

test('全角スペース混在: A　開始　南部　東南', () => {
  const result = parseMessage('A　開始　南部　東南');
  assert.deepStrictEqual(result, {
    type: 'start_with_teams', court: 'A', topTeam: '南部', bottomTeam: '東南'
  });
});

test('前後の空白トリム: "  A 終了  "', () => {
  const result = parseMessage('  A 終了  ');
  assert.deepStrictEqual(result, {
    type: 'end', court: 'A'
  });
});

test('得点0: A 1表 0', () => {
  const result = parseMessage('A 1表 0');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'A', inning: 1, topBottom: '表', score: 0
  });
});

test('大きい得点: A 2裏 15', () => {
  const result = parseMessage('A 2裏 15');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'A', inning: 2, topBottom: '裏', score: 15
  });
});

test('7回はパース自体は成功する（MAX_INNINGS制限はhandlerで行う）', () => {
  const result = parseMessage('A 7表 3');
  assert.deepStrictEqual(result, {
    type: 'score', court: 'A', inning: 7, topBottom: '表', score: 3
  });
});

// --- 異常系 ---
test('空文字列 → null', () => {
  assert.strictEqual(parseMessage(''), null);
});

test('挨拶 → null', () => {
  assert.strictEqual(parseMessage('こんにちは'), null);
});

test('不完全な入力 "A 1" → null', () => {
  assert.strictEqual(parseMessage('A 1'), null);
});

test('コマンドなし "A 1 何か" → null', () => {
  assert.strictEqual(parseMessage('A 1 何か'), null);
});

test('数字だけ → null', () => {
  assert.strictEqual(parseMessage('123'), null);
});

test('得点にマイナスは不可 → null', () => {
  assert.strictEqual(parseMessage('A 3表 -1'), null);
});

test('開始コマンドにチーム名なし → null', () => {
  assert.strictEqual(parseMessage('A 開始'), null);
});

test('ホームラン（得点と同時）', () => {
  const r = parseMessage('B 3表 1 ホームラン');
  assert.deepStrictEqual(r, { type: 'score', court: 'B', inning: 3, topBottom: '表', score: 1, homerun: true });
});

test('ホームラン（長形式）', () => {
  const r = parseMessage('Bコート 3表 0 ホームラン');
  assert.deepStrictEqual(r, { type: 'score', court: 'B', inning: 3, topBottom: '表', score: 0, homerun: true });
});


console.log('\n=== determineWinner テスト ===');

test('チーム1が勝ち: 5-3', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [2, 0, 3, 0, 0, 0], 5),
    makeScoreboardRow('A', 1, 'チームB', [1, 0, 2, 0, 0, 0], 3),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, 'チームA');
  assert.strictEqual(result.loserTeam, 'チームB');
  assert.strictEqual(result.isDraw, false);
});

test('チーム2が勝ち: 3-5', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [1, 0, 2, 0, 0, 0], 3),
    makeScoreboardRow('A', 1, 'チームB', [2, 0, 3, 0, 0, 0], 5),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, 'チームB');
  assert.strictEqual(result.loserTeam, 'チームA');
  assert.strictEqual(result.isDraw, false);
});

test('引き分け: 0-0', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [0, 0, 0, 0, 0, 0], 0),
    makeScoreboardRow('A', 1, 'チームB', [0, 0, 0, 0, 0, 0], 0),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, null);
  assert.strictEqual(result.loserTeam, null);
  assert.strictEqual(result.isDraw, true);
});

test('引き分け: 3-3', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [1, 1, 1, 0, 0, 0], 3),
    makeScoreboardRow('A', 1, 'チームB', [0, 0, 0, 1, 1, 1], 3),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, null);
  assert.strictEqual(result.loserTeam, null);
  assert.strictEqual(result.isDraw, true);
});

test('データなし（空配列）', () => {
  const data = makeScoreboardData([]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, null);
  assert.strictEqual(result.loserTeam, null);
  assert.strictEqual(result.isDraw, false);
});

test('1チームしかない場合', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [5, 0, 0, 0, 0, 0], 5),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, null);
  assert.strictEqual(result.loserTeam, null);
  assert.strictEqual(result.isDraw, false);
});

test('異なるコートの試合は無視される', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [5, 0, 0, 0, 0, 0], 5),
    makeScoreboardRow('A', 1, 'チームB', [3, 0, 0, 0, 0, 0], 3),
    makeScoreboardRow('B', 1, 'チームC', [10, 0, 0, 0, 0, 0], 10),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, 'チームA');
  assert.strictEqual(result.loserTeam, 'チームB');
});

test('totalが文字列でも数値変換される', () => {
  const data = makeScoreboardData([
    makeScoreboardRow('A', 1, 'チームA', [0, 0, 0, 0, 0, 0], '7'),
    makeScoreboardRow('A', 1, 'チームB', [0, 0, 0, 0, 0, 0], '3'),
  ]);
  const result = determineWinner(data, 'A', 1);
  assert.strictEqual(result.winnerTeam, 'チームA');
  assert.strictEqual(result.loserTeam, 'チームB');
});


console.log('\n=== formatTime テスト ===');

test('null → "未定"', () => {
  assert.strictEqual(formatTime(null), '未定');
});

test('undefined → "未定"', () => {
  assert.strictEqual(formatTime(undefined), '未定');
});

test('空文字 → "未定"', () => {
  assert.strictEqual(formatTime(''), '未定');
});

test('文字列 "10:30" → "10:30"', () => {
  assert.strictEqual(formatTime('10:30'), '10:30');
});

test('文字列 " 9:00 " → "9:00"（トリム）', () => {
  assert.strictEqual(formatTime(' 9:00 '), '9:00');
});

test('Dateオブジェクト UTC 01:30 → "01:30"', () => {
  const d = new Date(Date.UTC(2026, 5, 15, 1, 30, 0));
  assert.strictEqual(formatTime(d), '01:30');
});

test('Dateオブジェクト UTC 10:00 → "10:00"', () => {
  const d = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
  assert.strictEqual(formatTime(d), '10:00');
});

test('Excelシリアル値 0.4375 (10:30) → "10:30"', () => {
  // Excel serial: 0.4375 = 10:30 AM
  // 変換式: (0.4375 - 25569) * 86400 * 1000 はマイナスになるので、
  // 時刻のみのシリアル値(0-1の範囲)は日付部分なしの場合
  // GASでは日付シリアル値が25569ベース（1970/1/1）
  // 時刻だけの場合: 0.4375日 = 10時間30分
  // (0.4375 - 25569) * 86400 * 1000 → 巨大な負の値
  // 実際のGASの時刻セル: 日付+時刻で返ってくる
  // 実際のExcelシリアル値テスト: 44927.4375 = 2023/1/1 10:30
  const serial = 25569 + 0.4375; // 1970/1/1 10:30 UTC
  assert.strictEqual(formatTime(serial), '10:30');
});

test('Excelシリアル値 25569.625 (15:00 UTC) → "15:00"', () => {
  const serial = 25569.625; // 1970/1/1 15:00 UTC
  assert.strictEqual(formatTime(serial), '15:00');
});

test('オブジェクト入力 → "未定"', () => {
  assert.strictEqual(formatTime({}), '未定');
});

test('配列入力 → "未定"', () => {
  assert.strictEqual(formatTime([]), '未定');
});

test('boolean入力 → "未定"（falsyだが型チェック）', () => {
  // false は !timeValue で true なので '未定'
  assert.strictEqual(formatTime(false), '未定');
});

test('数値 0 → "未定"（falsyなので）', () => {
  assert.strictEqual(formatTime(0), '未定');
});


// ============================================================
// validateSignature テスト (Node.js crypto で GAS Utilities を代替)
// ============================================================
console.log('\n=== validateSignature テスト ===');

const crypto = require('crypto');

function validateSignature(e, channelSecret) {
  if (!channelSecret) return true;
  const signature = e.requestHeaders && e.requestHeaders['x-line-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(e.postData.contents);
  const computedSignatureBase64 = hmac.digest('base64');
  return signature === computedSignatureBase64;
}

test('CHANNEL_SECRET未設定 → true (開発用スキップ)', () => {
  const e = { requestHeaders: {}, postData: { contents: '{}' } };
  assert.strictEqual(validateSignature(e, null), true);
  assert.strictEqual(validateSignature(e, ''), true);
});

test('署名ヘッダーなし → false', () => {
  const e = { requestHeaders: {}, postData: { contents: '{}' } };
  assert.strictEqual(validateSignature(e, 'secret123'), false);
});

test('正しい署名 → true', () => {
  const secret = 'test_channel_secret';
  const body = '{"events":[]}';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const validSig = hmac.digest('base64');

  const e = {
    requestHeaders: { 'x-line-signature': validSig },
    postData: { contents: body }
  };
  assert.strictEqual(validateSignature(e, secret), true);
});

test('不正な署名 → false', () => {
  const e = {
    requestHeaders: { 'x-line-signature': 'invalid_signature_base64' },
    postData: { contents: '{"events":[]}' }
  };
  assert.strictEqual(validateSignature(e, 'test_secret'), false);
});

test('bodyが変わると署名不一致 → false', () => {
  const secret = 'test_channel_secret';
  const originalBody = '{"events":[]}';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(originalBody);
  const sig = hmac.digest('base64');

  const e = {
    requestHeaders: { 'x-line-signature': sig },
    postData: { contents: '{"events":[{"type":"tampered"}]}' }
  };
  assert.strictEqual(validateSignature(e, secret), false);
});

// ============================================================
// Cloudflare Worker リクエスト検証テスト
// ============================================================
console.log('\n=== Cloudflare Worker バリデーションテスト ===');

// Worker の検証ロジックを再現
function validateWorkerRequest(headers, bodySize) {
  const errors = [];
  const authToken = headers['x-auth-token'];
  const filename = headers['x-filename'];
  const maxSizeBytes = 20 * 1024 * 1024;

  if (!authToken) errors.push('missing_auth');
  if (authToken && authToken !== 'valid_token') errors.push('invalid_auth');
  if (!filename) errors.push('missing_filename');
  if (filename && !/^[a-zA-Z0-9._-]+$/.test(filename)) errors.push('invalid_filename');
  if (filename && (filename.includes('..') || filename.includes('/'))) errors.push('path_traversal');
  if (bodySize > maxSizeBytes) errors.push('too_large');

  return errors;
}

test('正常なリクエスト → エラーなし', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'valid_token',
    'x-filename': 'photo_123.jpg'
  }, 1024 * 1024);
  assert.deepStrictEqual(errors, []);
});

test('認証トークンなし → missing_auth', () => {
  const errors = validateWorkerRequest({ 'x-filename': 'test.jpg' }, 100);
  assert.ok(errors.includes('missing_auth'));
});

test('不正な認証トークン → invalid_auth', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'wrong_token',
    'x-filename': 'test.jpg'
  }, 100);
  assert.ok(errors.includes('invalid_auth'));
});

test('ファイル名なし → missing_filename', () => {
  const errors = validateWorkerRequest({ 'x-auth-token': 'valid_token' }, 100);
  assert.ok(errors.includes('missing_filename'));
});

test('不正なファイル名（日本語） → invalid_filename', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'valid_token',
    'x-filename': '写真.jpg'
  }, 100);
  assert.ok(errors.includes('invalid_filename'));
});

test('パストラバーサル → invalid_filename', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'valid_token',
    'x-filename': '../../../etc/passwd'
  }, 100);
  assert.ok(errors.includes('invalid_filename'));
});

test('20MB超過 → too_large', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'valid_token',
    'x-filename': 'big.jpg'
  }, 21 * 1024 * 1024);
  assert.ok(errors.includes('too_large'));
});

test('20MBちょうど → エラーなし', () => {
  const errors = validateWorkerRequest({
    'x-auth-token': 'valid_token',
    'x-filename': 'exact.jpg'
  }, 20 * 1024 * 1024);
  assert.deepStrictEqual(errors, []);
});

// ============================================================
// 結果サマリー
// ============================================================
console.log('\n========================================');
console.log(`結果: ${passed} passed, ${failed} failed (全${passed + failed}件)`);
if (failures.length > 0) {
  console.log('\n失敗したテスト:');
  failures.forEach(f => {
    console.log(`  - ${f.name}: ${f.error}`);
  });
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
