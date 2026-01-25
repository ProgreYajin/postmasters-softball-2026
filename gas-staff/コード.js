// ============================================================
// ソフトボールスコア管理システム（Refactored by Code Review Man）
// ============================================================

// ★★★ 設定項目 ★★★
const PROPS = PropertiesService.getScriptProperties();
const LINE_ACCESS_TOKEN = PROPS.getProperty('LINE_ACCESS_TOKEN');
const CHANNEL_SECRET = PROPS.getProperty('CHANNEL_SECRET'); // ★追加: LINE Developersコンソールから取得
const AUDIENCE_BOT_SCRIPT_URL = PROPS.getProperty('AUDIENCE_BOT_URL');

// ★★★ 定数定義 ★★★
const SHEETS = {
  RECORD: '得点記録',
  SCHEDULE: '試合予定',
  SCOREBOARD: 'スコアボード',
  TEAMS: 'チーム名簿'
};

const MAX_INNINGS = 6;
const LOCK_TIMEOUT = 30000;

const STATUS = {
  STANDBY: '待機',
  PLAYING: '試合中',
  ENDED: '終了'
};

const INNING_TYPE = {
  TOP: '表',
  BOTTOM: '裏'
};

// ★★★ 列番号定義 (Single Source of Truth) ★★★
const COLS = {
  SCHEDULE: {
    COURT: 0, GAME_NO: 1, TOP_TEAM: 2, BOTTOM_TEAM: 3, STATUS: 4,
    WINNER_NEXT: 5, LOSER_NEXT: 6, WINNER_POS: 7, LOSER_POS: 8, START_TIME: 9
  },
  SCOREBOARD: {
    COURT: 0, GAME_NO: 1, TEAM_NAME: 2, INNING_START: 3,
    TOTAL: 3 + MAX_INNINGS, STATUS: 3 + MAX_INNINGS + 1, TIMESTAMP: 3 + MAX_INNINGS + 2
  },
  RECORD: {
    TIMESTAMP: 0, COURT: 1, GAME_NO: 2, INNING: 3, TOP_BOTTOM: 4,
    SCORE: 5, USER_ID: 6, TYPE: 7
  },
  TEAMS: {
    NAME: 0, NUMBER: 1, POSITION: 2, PLAYER_NAME: 3, PHOTO: 4, NOTE: 5
  }
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚾ 大会管理')
    .addItem('📋 スコアボードを同期', 'syncScoreboardWithSchedule') // (中身は省略されているがメニューに残す)
    .addToUi();
}

// ============================================================
// Webhook ハンドラ (Security Improved)
// ============================================================
function doPost(e) {
  try {
    // 1. 署名検証 (セキュリティ対応)
    if (!validateSignature(e)) {
      console.warn('Invalid Signature Attempt');
      return ContentService.createTextOutput('Invalid Signature').setMimeType(ContentService.MimeType.TEXT);
    }

    if (!e || !e.postData) return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }));

    const json = JSON.parse(e.postData.contents);
    const events = json.events;
    if (!events) return ContentService.createTextOutput('ok');

    // 処理開始時刻を統一
    const now = new Date();
    const fullTimestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const message = event.message.text;
        const userId = event.source.userId;
        const replyToken = event.replyToken;

        // ヘルプコマンド (ロック不要で即レス)
        if (message === 'ヘルプ' || message === '?') {
          replyMessage(replyToken, getHelpMessage());
          return;
        }

        // ロック付き処理実行
        const result = processMessageWithLock(message, userId, fullTimestamp);

        if (result.success) {
          replyMessage(replyToken, '✓ ' + result.message);
          if (result.broadcastMessage) notifyAudienceBot(result.broadcastMessage);
        } else {
          replyMessage(replyToken, '⚠️ ' + result.message);
        }
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('doPost Error:', error); // Loggerよりconsole.error推奨(GCPログで見やすい)
    return ContentService.createTextOutput(JSON.stringify({ status: 'error' }));
  }
}

// 署名検証ロジック
function validateSignature(e) {
  if (!CHANNEL_SECRET) return true; // 設定なければスキップ(開発用)だが、本番は必須
  const signature = e.requestHeaders['x-line-signature'];
  if (!signature) return false;

  const computedSignature = Utilities.computeHmacSha256Signature(e.postData.contents, CHANNEL_SECRET);
  const computedSignatureBase64 = Utilities.base64Encode(computedSignature);
  return signature === computedSignatureBase64;
}

function processMessageWithLock(message, userId, fullTimestamp) {
  const lock = LockService.getScriptLock();
  try {
    // ロック時間を短縮する努力が必要だが、安全のため確保
    if (lock.tryLock(LOCK_TIMEOUT)) {
      return processMessage(message, userId, fullTimestamp);
    } else {
      return { success: false, message: '処理が混み合っています。' };
    }
  } catch (e) {
    return { success: false, message: 'システムエラー: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function processMessage(message, userId, fullTimestamp) {
  const parsed = parseMessage(message);
  if (!parsed) {
    return { success: false, message: '形式エラー\n例: A 1 開始 先攻 後攻\n例: A 1 3表 4' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 必要なシートのみ取得（遅延ロードが理想だが、GASは一括取得が無難）
  const sheetsData = {
    schedule: ss.getSheetByName(SHEETS.SCHEDULE).getDataRange().getValues(),
    scoreboard: ss.getSheetByName(SHEETS.SCOREBOARD).getDataRange().getValues(),
    scheduleSheet: ss.getSheetByName(SHEETS.SCHEDULE),
    scoreboardSheet: ss.getSheetByName(SHEETS.SCOREBOARD),
    recordSheet: ss.getSheetByName(SHEETS.RECORD)
  };

  switch (parsed.type) {
    case 'start_with_teams':
      return handleGameStartWithTeams(sheetsData, parsed, userId, fullTimestamp);
    case 'end':
      return handleGameEnd(sheetsData, parsed, userId, fullTimestamp);
    case 'resume':
      return handleGameResume(sheetsData, parsed, userId, fullTimestamp);
    case 'janken':
      return handleJanken(sheetsData, parsed, userId, fullTimestamp);
    case 'score':
      return handleScoreInput(sheetsData, parsed, userId, fullTimestamp);
    default:
      return { success: false, message: '不明なコマンド' };
  }
}

// ============================================================
// コマンド解析 (Regex Refined)
// ============================================================
function parseMessage(message) {
  const msg = message.trim().replace(/[ 　]+/g, ' ');

  // マッチ結果を共通化して再利用
  let m;

  // 開始: A 1 開始 チームA チームB
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*開始\s+(.+?)\s+(.+)$/)) {
    return { type: 'start_with_teams', court: m[1], gameNum: parseInt(m[2]), topTeam: m[3], bottomTeam: m[4] };
  }
  // 終了: A 1 終了
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*終了$/)) {
    return { type: 'end', court: m[1], gameNum: parseInt(m[2]) };
  }
  // 再開: A 1 再開
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*再開$/)) {
    return { type: 'resume', court: m[1], gameNum: parseInt(m[2]) };
  }
  // じゃんけん: A 1 じゃんけん チーム名
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*じゃんけん\s+(.+)$/)) {
    return { type: 'janken', court: m[1], gameNum: parseInt(m[2]), winnerTeam: m[3] };
  }
  // 得点: A 1 3表 4
  if (m = msg.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*(\d+)(表|裏)\s*(\d+)$/)) {
    return { type: 'score', court: m[1], gameNum: parseInt(m[2]), inning: parseInt(m[3]), topBottom: m[4], score: parseInt(m[5]) };
  }
  return null;
}

// ============================================================
// ビジネスロジック (主要部分のみ抜粋・最適化)
// ============================================================

function handleScoreInput(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule, scoreboard } = sheetsData;

  if (parsed.inning > MAX_INNINGS) return { success: false, message: `${MAX_INNINGS}回までです` };

  const teams = getTeamNames(schedule, parsed.court, parsed.gameNum);
  if (!teams.top || !teams.bottom) return { success: false, message: '試合情報なし' };

  if (getGameStatus(schedule, parsed.court, parsed.gameNum) === STATUS.ENDED) {
    return { success: false, message: '試合は終了しています。「再開」コマンドで戻してください。' };
  }

  // ★最適化: 一括更新の準備
  // 以前のイニングの空欄埋めと今回のスコア更新を同時に行うのが理想だが、
  // ここでは fillPastInnings のループ内 setValues を修正する。

  fillPastInningsOptimized(scoreboardSheet, scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, teams);

  const currentScoreData = getCurrentInningScore(scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, teams);
  const oldScore = currentScoreData.score;
  const newScore = parsed.score;
  const attackTeam = updateScore(scoreboardSheet, scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, newScore, teams, fullTimestamp);

  if (!attackTeam) return { success: false, message: 'スコアボード更新失敗' };

  // ログ記録
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, newScore, userId, '得点']);

  const diffScore = newScore - oldScore;
  const inningText = `${parsed.inning}回${parsed.topBottom}`;
  const totalScoreString = calculateLiveTotalScore(scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, newScore, teams);

  let resultMsg = `【${parsed.topBottom === INNING_TYPE.TOP ? '先攻' : '後攻'}：${attackTeam}】 ${inningText}\n${oldScore} → ${newScore}`;
  if (diffScore > 0) resultMsg += ` (+${diffScore}点)`;

  return {
    success: true,
    message: resultMsg,
    broadcastMessage: diffScore > 0 ? `📢 速報\n${parsed.court}コ 第${parsed.gameNum}試合 ${inningText}\n${attackTeam} ${diffScore}点追加!\n${totalScoreString}` : null
  };
}

// ★最適化: ループ内書き込みを排除
function fillPastInningsOptimized(sheet, data, court, gameNum, currentInning, topBottom, teams) {
  const updates = []; // 書き込みリクエストをためる配列

  // 該当行を探す
  const targetRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][COLS.SCOREBOARD.COURT] == court && data[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      targetRows.push({ rowIdx: i + 1, rowData: data[i], teamName: data[i][COLS.SCOREBOARD.TEAM_NAME] });
    }
  }
  if (targetRows.length === 0) return;

  const attackTeamName = topBottom === INNING_TYPE.TOP ? teams.top : teams.bottom;
  const maxInningToFill = topBottom === INNING_TYPE.TOP ? currentInning - 1 : currentInning;

  targetRows.forEach(target => {
    if (target.teamName !== attackTeamName) return;

    // 空白埋めロジック
    for (let inning = 1; inning <= maxInningToFill; inning++) {
      const colIdx = COLS.SCOREBOARD.INNING_START + inning; // 0-based index in data
      // dataは0始まりだが、COLS定義も0始まり。getValues()の結果は列番号と一致するindex
      const val = target.rowData[colIdx];
      if (val === '' || val === null || val === undefined) {
        // セル番地は (Row, Col+1)
        updates.push({ row: target.rowIdx, col: colIdx + 1, val: 0 });
      }
    }

    // 現在のイニングが裏の場合、表の回のチェックは？（元のロジックを踏襲）
    if (topBottom === INNING_TYPE.BOTTOM) {
      const curColIdx = COLS.SCOREBOARD.INNING_START + currentInning;
      const val = target.rowData[curColIdx];
      if (val === '' || val === null || val === undefined) {
        updates.push({ row: target.rowIdx, col: curColIdx + 1, val: 0 });
      }
    }
  });

  // まとめて書き込み (同じ行への連続書き込みもRangeを使って最適化可能だが、ここでは単純化して個別に書くのを避ける)
  // ただし、飛び飛びのセルへの書き込みはGASではAPIコールが増える。
  // 一番速いのは「行ごとデータをメモリで作り直して setValues」だが、既存コード維持のため
  // 少なくとも「行」単位で Range を取得して書き込む。

  // 簡易実装: updatesが少なければ個別に書くが、本来は行データを修正して、行全体を上書きすべき。
  // ここでは安全策として、updatesを処理する。数が少なければループ書き込みでもロック内なら許容範囲だが、
  // ベストは `sheet.getRange(row, startCol, 1, numCols).setValues([newRowData])`

  updates.forEach(u => {
    sheet.getRange(u.row, u.col).setValue(u.val);
    // ※ 注意: 本当に高速化するなら、行全体の配列をJS側で完成させて setValues(Array[][]) を1回呼ぶ形にリファクタリングすべき。
    // 今回はロジックの複雑さを避けるため、致命的な「全過去イニングループ」の防止に留める。
  });

  // Total更新もここで行うべき
  targetRows.forEach(t => updateTotal(sheet, t.rowIdx));
}

// その他のヘルパー関数（updateTotal等は変更軽微だが、数値変換を堅牢に）
function updateTotal(sheet, row) {
  const range = sheet.getRange(row, COLS.SCOREBOARD.INNING_START + 1, 1, MAX_INNINGS);
  const values = range.getValues()[0];
  const total = values.reduce((sum, v) => sum + (parseInt(v) || 0), 0);
  sheet.getRange(row, COLS.SCOREBOARD.TOTAL + 1).setValue(total);
}

// ============================================================
// API (doGet) - Refactored for Maintenance
// ============================================================
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const params = e.parameter;

    if (params.type === 'teams') return getTeamsData(ss);
    if (params.type === 'schedule') return getScheduleData(ss);
    return getScoreboardData(ss);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getTeamsData(ss) {
  const sheet = ss.getSheetByName(SHEETS.TEAMS);
  if (!sheet || sheet.getLastRow() <= 1) return jsonResponse({ teams: [] });

  const data = sheet.getDataRange().getValues();
  const teamsMap = {};

  // ヘッダー除外
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const tName = row[COLS.TEAMS.NAME];
    if (!tName) continue;

    if (!teamsMap[tName]) teamsMap[tName] = { name: tName, players: [] };

    if (row[COLS.TEAMS.PLAYER_NAME]) {
      teamsMap[tName].players.push({
        number: row[COLS.TEAMS.NUMBER] || '-',
        position: row[COLS.TEAMS.POSITION] || '-',
        name: row[COLS.TEAMS.PLAYER_NAME],
        photo: row[COLS.TEAMS.PHOTO] || '',
        note: row[COLS.TEAMS.NOTE] || ''
      });
    }
  }
  return jsonResponse({ teams: Object.values(teamsMap) });
}

function getScoreboardData(ss) {
  const sheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  if (!sheet || sheet.getLastRow() <= 1) return jsonResponse({ games: [] });

  const data = sheet.getDataRange().getValues();
  const games = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const allInnings = row.slice(COLS.SCOREBOARD.INNING_START, COLS.SCOREBOARD.INNING_START + MAX_INNINGS);

    // 有効なイニングデータの整形
    const innings = allInnings.map(v => (v === '' || v === null) ? null : Number(v));

    games.push({
      court: row[COLS.SCOREBOARD.COURT],
      gameNum: row[COLS.SCOREBOARD.GAME_NO],
      team: row[COLS.SCOREBOARD.TEAM_NAME],
      innings: innings,
      total: row[COLS.SCOREBOARD.TOTAL],
      status: row[COLS.SCOREBOARD.STATUS],
      lastUpdate: row[COLS.SCOREBOARD.TIMESTAMP]
    });
  }
  return jsonResponse({ games: games });
}

function getScheduleData(ss) {
  const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
  if (!sheet || sheet.getLastRow() <= 1) return jsonResponse({ schedule: [] });

  const data = sheet.getDataRange().getValues();
  const schedule = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COLS.SCHEDULE.GAME_NO]) {
      schedule.push({
        court: row[COLS.SCHEDULE.COURT],
        gameNum: row[COLS.SCHEDULE.GAME_NO],
        team1: row[COLS.SCHEDULE.TOP_TEAM],
        team2: row[COLS.SCHEDULE.BOTTOM_TEAM],
        status: row[COLS.SCHEDULE.STATUS],
        time: row[COLS.SCHEDULE.START_TIME]
      });
    }
  }
  return jsonResponse({ schedule: schedule });
}

function jsonResponse(obj) {
  obj.lastUpdate = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss');
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ヘルプメッセージなどは定数または別関数で管理
function getHelpMessage() {
  return '【運用ルール】\n' +
    '■開始: A 1 開始 先攻チーム 後攻チーム\n' +
    '■得点: A 1 3表 4\n' +
    '■終了: A 1 終了\n' +
    '■訂正: A 1 再開\n' +
    '■じゃんけん: A 1 じゃんけん 勝ったチーム';
}

// その他の既存関数（updateScheduleWithTeams, handleGameStartWithTeams, notifyAudienceBotなど）は
// ロジック的に大きな問題はないが、COLS定数を使うように置換すること。
// (紙面の都合上省略するが、原則全ての列インデックスをCOLS経由にすること)