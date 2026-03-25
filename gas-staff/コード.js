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

  // 行ごとにグループ化してバッチ書き込み（APIコール削減）
  if (updates.length === 0) return;

  const byRow = {};
  updates.forEach(u => {
    if (!byRow[u.row]) byRow[u.row] = [];
    byRow[u.row].push(u);
  });

  Object.entries(byRow).forEach(([row, cells]) => {
    const rowNum = Number(row);
    const startCol = COLS.SCOREBOARD.INNING_START + 1 + 1; // 1-based, イニング1列目
    const range = sheet.getRange(rowNum, startCol, 1, MAX_INNINGS);
    const vals = range.getValues()[0];
    cells.forEach(c => {
      const idx = c.col - startCol;
      if (idx >= 0 && idx < MAX_INNINGS) vals[idx] = c.val;
    });
    range.setValues([vals]);
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

// ============================================================
// 試合開始処理（チーム指定あり）
// ============================================================
function handleGameStartWithTeams(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule } = sheetsData;

  updateScheduleWithTeams(scheduleSheet, schedule, parsed.court, parsed.gameNum, parsed.topTeam, parsed.bottomTeam);
  initializeScoreboard(scoreboardSheet, parsed.court, parsed.gameNum, parsed.topTeam, parsed.bottomTeam, fullTimestamp);
  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'start');

  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, `開始:${parsed.topTeam}vs${parsed.bottomTeam}`]);

  return {
    success: true,
    message: `${parsed.court}コート 第${parsed.gameNum}試合 開始\n先攻: ${parsed.topTeam}\n後攻: ${parsed.bottomTeam}`,
    broadcastMessage: `⚾ 試合開始!\n${parsed.court}コートで「${parsed.topTeam}（先攻）」対「${parsed.bottomTeam}（後攻）」の試合が始まりました!`
  };
}

// ============================================================
// 試合予定シートにチーム名を設定
// ============================================================
function updateScheduleWithTeams(scheduleSheet, scheduleData, court, gameNum, topTeam, bottomTeam) {
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.COURT] == court && scheduleData[i][COLS.SCHEDULE.GAME_NO] == gameNum) {
      scheduleSheet.getRange(i + 1, COLS.SCHEDULE.TOP_TEAM + 1).setValue(topTeam);
      scheduleSheet.getRange(i + 1, COLS.SCHEDULE.BOTTOM_TEAM + 1).setValue(bottomTeam);
      return;
    }
  }
  scheduleSheet.appendRow([court, gameNum, topTeam, bottomTeam, STATUS.STANDBY, '', '', '', '', '']);
}

// ============================================================
// スコアボード初期化
// ============================================================
function initializeScoreboard(scoreboardSheet, court, gameNum, topTeam, bottomTeam, timestamp) {
  const data = scoreboardSheet.getDataRange().getValues();

  let topExists = false;
  let bottomExists = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][COLS.SCOREBOARD.COURT] == court && data[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      if (data[i][COLS.SCOREBOARD.TEAM_NAME] === topTeam) topExists = true;
      if (data[i][COLS.SCOREBOARD.TEAM_NAME] === bottomTeam) bottomExists = true;
    }
  }

  const allInitialScores = Array(MAX_INNINGS).fill('');

  if (!topExists) {
    scoreboardSheet.appendRow([court, gameNum, topTeam, ...allInitialScores, 0, STATUS.PLAYING, timestamp]);
  }
  if (!bottomExists) {
    scoreboardSheet.appendRow([court, gameNum, bottomTeam, ...allInitialScores, 0, STATUS.PLAYING, timestamp]);
  }
}

// ============================================================
// 試合終了処理
// ============================================================
function handleGameEnd(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule, scoreboard } = sheetsData;

  const winner = determineWinner(scoreboard, parsed.court, parsed.gameNum);

  if (winner.isDraw) {
    return {
      success: true,
      message: `⚠️ 0-0の引き分けです\nじゃんけんで勝者を決定してください\n\n入力例:\n${parsed.court} ${parsed.gameNum} じゃんけん チーム名`,
      broadcastMessage: null
    };
  }

  if (winner.winnerTeam && winner.loserTeam) {
    updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'end', schedule, scoreboard);
    recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, '終了']);
    advanceTeams(scheduleSheet, schedule, parsed.gameNum, winner.winnerTeam, winner.loserTeam);

    const finalScore = getFinalScore(scoreboard, parsed.court, parsed.gameNum);
    let broadcastMsg = `🏁 試合終了!\n${parsed.court}コート 第${parsed.gameNum}試合\n${finalScore}`;

    const nextMatchDetails = getNextMatchDetails(schedule, parsed.gameNum);
    broadcastMsg += `\n\n🎉 ${winner.winnerTeam} の勝利!`;

    if (nextMatchDetails.winnerMatch) {
      const wm = nextMatchDetails.winnerMatch;
      broadcastMsg += `\n次は第${wm.gameNum}試合（${wm.court}コート・${wm.startTime}開始予定）に進出します!`;
    }
    if (nextMatchDetails.loserMatch) {
      const lm = nextMatchDetails.loserMatch;
      broadcastMsg += `\n${winner.loserTeam} は第${lm.gameNum}試合（${lm.court}コート・${lm.startTime}開始予定）へ`;
    }

    const nextCourtMatch = getNextCourtMatch(schedule, parsed.court, parsed.gameNum);
    if (nextCourtMatch) {
      broadcastMsg += `\n\n📢 ${parsed.court}コートの次の試合\n第${nextCourtMatch.gameNum}試合: ${nextCourtMatch.top} vs ${nextCourtMatch.bottom}\n${nextCourtMatch.startTime}開始予定`;
    }

    return {
      success: true,
      message: `${parsed.court}コート 第${parsed.gameNum}試合 終了`,
      broadcastMessage: broadcastMsg
    };
  }

  return {
    success: false,
    message: 'スコアボードにデータがありません。試合開始コマンドを送信してください。'
  };
}

// ============================================================
// 試合再開処理
// ============================================================
function handleGameResume(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet } = sheetsData;

  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'start');
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, '再開']);

  return {
    success: true,
    message: `${parsed.court}コート 第${parsed.gameNum}試合 再開しました`,
    broadcastMessage: null
  };
}

// ============================================================
// じゃんけん決着処理
// ============================================================
function handleJanken(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule } = sheetsData;

  const teams = getTeamNames(schedule, parsed.court, parsed.gameNum);
  if (!teams.top || !teams.bottom) {
    return { success: false, message: '試合予定が見つかりません' };
  }

  if (parsed.winnerTeam !== teams.top && parsed.winnerTeam !== teams.bottom) {
    return {
      success: false,
      message: `チーム名が一致しません\n正しいチーム名: ${teams.top} / ${teams.bottom}`
    };
  }

  const loserTeam = parsed.winnerTeam === teams.top ? teams.bottom : teams.top;

  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'end');
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, `じゃんけん:${parsed.winnerTeam}`]);
  advanceTeams(scheduleSheet, schedule, parsed.gameNum, parsed.winnerTeam, loserTeam);

  const nextMatchDetails = getNextMatchDetails(schedule, parsed.gameNum);
  let broadcastMsg = `🏁 試合終了（じゃんけん決着）\n${parsed.court}コート 第${parsed.gameNum}試合\n${teams.top} 0 - 0 ${teams.bottom}`;
  broadcastMsg += `\n\n✊✌️✋ じゃんけんで ${parsed.winnerTeam} の勝利!`;

  if (nextMatchDetails.winnerMatch) {
    const wm = nextMatchDetails.winnerMatch;
    broadcastMsg += `\n次は第${wm.gameNum}試合（${wm.court}コート・${wm.startTime}開始予定）に進出します!`;
  }
  if (nextMatchDetails.loserMatch) {
    const lm = nextMatchDetails.loserMatch;
    broadcastMsg += `\n${loserTeam} は第${lm.gameNum}試合（${lm.court}コート・${lm.startTime}開始予定）へ`;
  }

  const nextCourtMatch = getNextCourtMatch(schedule, parsed.court, parsed.gameNum);
  if (nextCourtMatch) {
    broadcastMsg += `\n\n📢 ${parsed.court}コートの次の試合\n第${nextCourtMatch.gameNum}試合: ${nextCourtMatch.top} vs ${nextCourtMatch.bottom}\n${nextCourtMatch.startTime}開始予定`;
  }

  return {
    success: true,
    message: `${parsed.court}コート 第${parsed.gameNum}試合 じゃんけんで ${parsed.winnerTeam} の勝利`,
    broadcastMessage: broadcastMsg
  };
}

// ============================================================
// 得点更新
// ============================================================
function updateScore(scoreboardSheet, scoreboardData, court, gameNum, inning, topBottom, score, teams, timestamp) {
  let topRow = -1;
  let bottomRow = -1;

  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      if (scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME] === teams.top) topRow = i + 1;
      if (scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME] === teams.bottom) bottomRow = i + 1;
    }
  }

  if (topRow === -1 || bottomRow === -1) return null;

  const isTop = topBottom === INNING_TYPE.TOP;
  const targetRow = isTop ? topRow : bottomRow;
  const attackTeamName = isTop ? teams.top : teams.bottom;
  // COLS.SCOREBOARD.INNING_START は0-based(=3)、inningは1始まり
  // getRange()は1-based なので: (0-based列3)+1 + (inning-1) = INNING_START + inning
  const inningCol = COLS.SCOREBOARD.INNING_START + inning;

  scoreboardSheet.getRange(targetRow, inningCol).setValue(score);
  updateTotal(scoreboardSheet, targetRow);
  scoreboardSheet.getRange(targetRow, COLS.SCOREBOARD.TIMESTAMP + 1).setValue(timestamp);

  return attackTeamName;
}

// ============================================================
// 現在のイニングスコア取得
// ============================================================
function getCurrentInningScore(scoreboardData, court, gameNum, inning, topBottom, teams) {
  const attackTeamName = topBottom === INNING_TYPE.TOP ? teams.top : teams.bottom;
  const inningCol = COLS.SCOREBOARD.INNING_START + inning;

  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court &&
        scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum &&
        scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME] === attackTeamName) {
      const val = scoreboardData[i][inningCol];
      return { score: (val === '' || val === null || val === undefined) ? 0 : Number(val) };
    }
  }
  return { score: 0 };
}

// ============================================================
// ライブ合計スコア文字列生成
// ============================================================
function calculateLiveTotalScore(scoreboardData, court, gameNum, currentInning, topBottom, newScore, teams) {
  let topTotal = 0;
  let bottomTotal = 0;

  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      const teamName = scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME];
      let total = 0;

      for (let j = 1; j <= MAX_INNINGS; j++) {
        const colIdx = COLS.SCOREBOARD.INNING_START + j;
        const val = scoreboardData[i][colIdx];
        if (j === currentInning && teamName === (topBottom === INNING_TYPE.TOP ? teams.top : teams.bottom)) {
          total += newScore;
        } else {
          total += (val === '' || val === null || val === undefined) ? 0 : Number(val);
        }
      }

      if (teamName === teams.top) topTotal = total;
      if (teamName === teams.bottom) bottomTotal = total;
    }
  }
  return `${teams.top} ${topTotal} - ${bottomTotal} ${teams.bottom}`;
}

// ============================================================
// 試合ステータス更新
// ============================================================
function updateGameStatus(scheduleSheet, scoreboardSheet, court, gameNum, status, scheduleData, scoreData) {
  const statusText = status === 'start' ? STATUS.PLAYING : STATUS.ENDED;

  const sData = scheduleData || scheduleSheet.getDataRange().getValues();
  for (let i = 1; i < sData.length; i++) {
    if (sData[i][COLS.SCHEDULE.COURT] == court && sData[i][COLS.SCHEDULE.GAME_NO] == gameNum) {
      scheduleSheet.getRange(i + 1, COLS.SCHEDULE.STATUS + 1).setValue(statusText);
      break;
    }
  }

  const scData = scoreData || scoreboardSheet.getDataRange().getValues();
  for (let i = 1; i < scData.length; i++) {
    if (scData[i][COLS.SCOREBOARD.COURT] == court && scData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      scoreboardSheet.getRange(i + 1, COLS.SCOREBOARD.STATUS + 1).setValue(statusText);
    }
  }
}

// ============================================================
// 勝敗判定
// ============================================================
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

// ============================================================
// 次試合へチームを振り分け
// ============================================================
function advanceTeams(scheduleSheet, scheduleData, finishedGameNum, winnerTeam, loserTeam) {
  let winnerNextGame = null;
  let loserNextGame = null;
  let winnerPosition = null;
  let loserPosition = null;
  const rowByGameNum = {};

  // 1回のループで次試合情報の取得と行インデックスのマッピングを同時に行う
  for (let i = 1; i < scheduleData.length; i++) {
    const gn = scheduleData[i][COLS.SCHEDULE.GAME_NO];
    rowByGameNum[gn] = i;
    if (gn == finishedGameNum) {
      winnerNextGame = scheduleData[i][COLS.SCHEDULE.WINNER_NEXT];
      loserNextGame = scheduleData[i][COLS.SCHEDULE.LOSER_NEXT];
      winnerPosition = (scheduleData[i][COLS.SCHEDULE.WINNER_POS] || '').trim();
      loserPosition = (scheduleData[i][COLS.SCHEDULE.LOSER_POS] || '').trim();
    }
  }

  if (winnerNextGame && rowByGameNum[winnerNextGame] !== undefined) {
    const row = rowByGameNum[winnerNextGame] + 1;
    if (winnerPosition === '先攻') {
      scheduleSheet.getRange(row, COLS.SCHEDULE.TOP_TEAM + 1).setValue(winnerTeam);
    } else if (winnerPosition === '後攻') {
      scheduleSheet.getRange(row, COLS.SCHEDULE.BOTTOM_TEAM + 1).setValue(winnerTeam);
    }
  }

  if (loserNextGame && rowByGameNum[loserNextGame] !== undefined) {
    const row = rowByGameNum[loserNextGame] + 1;
    if (loserPosition === '先攻') {
      scheduleSheet.getRange(row, COLS.SCHEDULE.TOP_TEAM + 1).setValue(loserTeam);
    } else if (loserPosition === '後攻') {
      scheduleSheet.getRange(row, COLS.SCHEDULE.BOTTOM_TEAM + 1).setValue(loserTeam);
    }
  }
}

// ============================================================
// チーム名取得
// ============================================================
function getTeamNames(scheduleData, court, gameNum) {
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.COURT] == court && scheduleData[i][COLS.SCHEDULE.GAME_NO] == gameNum) {
      return {
        top: scheduleData[i][COLS.SCHEDULE.TOP_TEAM],
        bottom: scheduleData[i][COLS.SCHEDULE.BOTTOM_TEAM]
      };
    }
  }
  return { top: '', bottom: '' };
}

// ============================================================
// 試合ステータス取得
// ============================================================
function getGameStatus(scheduleData, court, gameNum) {
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.COURT] == court && scheduleData[i][COLS.SCHEDULE.GAME_NO] == gameNum) {
      return scheduleData[i][COLS.SCHEDULE.STATUS];
    }
  }
  return null;
}

// ============================================================
// 最終スコア取得
// ============================================================
function getFinalScore(scoreboardData, court, gameNum) {
  const teams = [];

  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      teams.push({
        name: scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME],
        total: scoreboardData[i][COLS.SCOREBOARD.TOTAL] || 0
      });
    }
  }

  if (teams.length >= 2) {
    return `${teams[0].name} ${teams[0].total} - ${teams[1].total} ${teams[1].name}`;
  }
  return '試合結果取得エラー';
}

// ============================================================
// 次試合の詳細情報を取得
// ============================================================
function getNextMatchDetails(scheduleData, finishedGameNum) {
  let winnerNextGameNum = null;
  let loserNextGameNum = null;

  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == finishedGameNum) {
      winnerNextGameNum = scheduleData[i][COLS.SCHEDULE.WINNER_NEXT];
      loserNextGameNum = scheduleData[i][COLS.SCHEDULE.LOSER_NEXT];
      break;
    }
  }

  const result = { winnerMatch: null, loserMatch: null };

  if (winnerNextGameNum) {
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == winnerNextGameNum) {
        result.winnerMatch = {
          gameNum: scheduleData[i][COLS.SCHEDULE.GAME_NO],
          court: scheduleData[i][COLS.SCHEDULE.COURT],
          startTime: formatTime(scheduleData[i][COLS.SCHEDULE.START_TIME])
        };
        break;
      }
    }
  }

  if (loserNextGameNum) {
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == loserNextGameNum) {
        result.loserMatch = {
          gameNum: scheduleData[i][COLS.SCHEDULE.GAME_NO],
          court: scheduleData[i][COLS.SCHEDULE.COURT],
          startTime: formatTime(scheduleData[i][COLS.SCHEDULE.START_TIME])
        };
        break;
      }
    }
  }

  return result;
}

// ============================================================
// 同じコートの次の試合を取得
// ============================================================
function getNextCourtMatch(scheduleData, court, currentGameNum) {
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.COURT] == court &&
        scheduleData[i][COLS.SCHEDULE.GAME_NO] > currentGameNum &&
        scheduleData[i][COLS.SCHEDULE.STATUS] === STATUS.STANDBY) {
      return {
        gameNum: scheduleData[i][COLS.SCHEDULE.GAME_NO],
        court: scheduleData[i][COLS.SCHEDULE.COURT],
        top: scheduleData[i][COLS.SCHEDULE.TOP_TEAM] || 'TBD',
        bottom: scheduleData[i][COLS.SCHEDULE.BOTTOM_TEAM] || 'TBD',
        startTime: formatTime(scheduleData[i][COLS.SCHEDULE.START_TIME])
      };
    }
  }
  return null;
}

// ============================================================
// 時刻フォーマット
// ============================================================
function formatTime(timeValue) {
  if (!timeValue) return '未定';

  if (timeValue instanceof Date) {
    return Utilities.formatDate(timeValue, 'Asia/Tokyo', 'HH:mm');
  }
  if (typeof timeValue === 'string') {
    return timeValue.trim();
  }
  if (typeof timeValue === 'number') {
    const date = new Date((timeValue - 25569) * 86400 * 1000);
    return Utilities.formatDate(date, 'Asia/Tokyo', 'HH:mm');
  }
  return '未定';
}

// ============================================================
// 観客Botへ通知
// ============================================================
function notifyAudienceBot(message) {
  if (!AUDIENCE_BOT_SCRIPT_URL) return;

  try {
    const res = UrlFetchApp.fetch(AUDIENCE_BOT_SCRIPT_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ type: 'broadcast', message: message }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('観客Botへの通知失敗 HTTP ' + code + ': ' + res.getContentText());
    }
  } catch (e) {
    console.error('観客Botへの通知失敗:', e);
  }
}

// ============================================================
// LINE返信
// ============================================================
function replyMessage(replyToken, message) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: message }]
    }),
    muteHttpExceptions: true
  });
}