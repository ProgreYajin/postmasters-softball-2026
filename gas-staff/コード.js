// ============================================================
// ソフトボールスコア管理システム（統合・最適化版）
// ============================================================

// ★★★ 設定項目 ★★★
const PROPS = PropertiesService.getScriptProperties();
const LINE_ACCESS_TOKEN = PROPS.getProperty('LINE_ACCESS_TOKEN');
const AUDIENCE_BOT_SCRIPT_URL = PROPS.getProperty('AUDIENCE_BOT_URL');

// ★★★ シート名定義 ★★★
const SHEETS = {
  RECORD: '得点記録',
  SCHEDULE: '試合予定',
  SCOREBOARD: 'スコアボード'
};

// ★★★ イニング数設定 ★★★
const MAX_INNINGS = 20;

// ★★★ 列番号定義 ★★★
const COLS = {
  SCHEDULE: {
    COURT: 0,
    GAME_NO: 1,
    TOP_TEAM: 2,
    BOTTOM_TEAM: 3,
    STATUS: 4,
    WINNER_NEXT: 5,
    LOSER_NEXT: 6,
    WINNER_POS: 7,
    LOSER_POS: 8,
    START_TIME: 9
  },
  SCOREBOARD: {
    COURT: 0,
    GAME_NO: 1,
    TEAM_NAME: 2,
    INNING_START: 3,
    TOTAL: 3 + MAX_INNINGS,
    STATUS: 3 + MAX_INNINGS + 1,
    TIMESTAMP: 3 + MAX_INNINGS + 2
  },
  RECORD: {
    TIMESTAMP: 0,
    COURT: 1,
    GAME_NO: 2,
    INNING: 3,
    TOP_BOTTOM: 4,
    SCORE: 5,
    USER_ID: 6,
    TYPE: 7
  }
};

// ============================================================
// カスタムメニュー（スプレッドシート起動時）
// ============================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚾ 大会管理')
    .addItem('📋 スコアボードを同期', 'syncScoreboardWithSchedule')
    .addSeparator()
    .addItem('🔄 すべてのステータスをリセット', 'resetAllStatus')
    .addToUi();
}

// ============================================================
// LINE Bot Webhook
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData) {
      return ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    }

    const json = JSON.parse(e.postData.contents);
    const events = json.events;
    
    if (!events) return ContentService.createTextOutput('ok');

    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const message = event.message.text;
        const userId = event.source.userId;
        const replyToken = event.replyToken;
        
        if (message === 'ヘルプ' || message === '?') {
          replyMessage(replyToken, '【入力例】\n開始: Aコート 第1試合 開始 先チーム赤 後チーム青\n得点: Aコート 第1試合 1表 2\n終了: Aコート 第1試合 終了\nじゃんけん: Aコート 第1試合 じゃんけん チーム名');
          return;
        }

        const result = processMessage(message, userId);
        
        if (result.success) {
          replyMessage(replyToken, '✓ 記録: ' + result.message);
          
          if (result.broadcastMessage) {
            notifyAudienceBot(result.broadcastMessage);
          }
        } else {
          replyMessage(replyToken, '⚠️ ' + result.message);
        }
      }
    });
    
    return ContentService.createTextOutput(JSON.stringify({status: 'ok'}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('doPost エラー: ' + error);
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: error.toString()}));
  }
}

// ============================================================
// メッセージ処理メイン
// ============================================================
function processMessage(message, userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordSheet = ss.getSheetByName(SHEETS.RECORD);
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const scoreboardSheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  
  // ★データを一度だけ読み込み（パフォーマンス改善）
  const sheetsData = {
    schedule: scheduleSheet.getDataRange().getValues(),
    scoreboard: scoreboardSheet.getDataRange().getValues(),
    scheduleSheet: scheduleSheet,
    scoreboardSheet: scoreboardSheet,
    recordSheet: recordSheet
  };
  
  const parsed = parseMessage(message);
  
  if (!parsed) {
    return { success: false, message: '形式エラー。例: Aコート 第1試合 開始 先チーム赤 後チーム青' };
  }
  
  const fullTimestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  
  // --- 試合開始（チーム指定あり） ---
  if (parsed.type === 'start_with_teams') {
    return handleGameStartWithTeams(sheetsData, parsed, userId, fullTimestamp);
  }
  
  // --- 試合開始（チーム指定なし） ---
  if (parsed.type === 'start') {
    return handleGameStart(sheetsData, parsed, userId, fullTimestamp);
  }

  // --- 試合終了 ---
  if (parsed.type === 'end') {
    return handleGameEnd(sheetsData, parsed, userId, fullTimestamp);
  }
  
  // --- じゃんけん決着 ---
  if (parsed.type === 'janken') {
    return handleJanken(sheetsData, parsed, userId, fullTimestamp);
  }
  
  // --- 得点入力 ---
  if (parsed.type === 'score') {
    return handleScoreInput(sheetsData, parsed, userId, fullTimestamp);
  }
  
  return { success: false, message: '不明なコマンド' };
}

// ============================================================
// 試合開始処理（チーム指定あり）- スコアボード更新対応
// ============================================================
function handleGameStartWithTeams(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule } = sheetsData;
  
  // 試合予定シートを更新
  updateScheduleWithTeams(scheduleSheet, schedule, parsed.court, parsed.gameNum, parsed.topTeam, parsed.bottomTeam);
  
  // スコアボードを初期化（既存のプレースホルダーを上書き）
  updateOrCreateScoreboard(scoreboardSheet, parsed.court, parsed.gameNum, parsed.topTeam, parsed.bottomTeam, fullTimestamp);
  
  // ステータス更新
  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'start');
  
  // 記録
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, `開始:${parsed.topTeam}vs${parsed.bottomTeam}`]);
  
  const broadcastMsg = `⚾ 試合開始!\n${parsed.court}コートで「${parsed.topTeam}（先攻）」対「${parsed.bottomTeam}（後攻）」の試合が始まりました!`;
  
  return {
    success: true,
    message: `${parsed.court}コート 第${parsed.gameNum}試合 開始\n先攻: ${parsed.topTeam}\n後攻: ${parsed.bottomTeam}`,
    broadcastMessage: broadcastMsg
  };
}

// ============================================================
// 試合開始処理（チーム指定なし）
// ============================================================
function handleGameStart(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule } = sheetsData;
  
  // 試合予定からチーム名を取得
  const teams = getTeamNames(schedule, parsed.court, parsed.gameNum);
  
  if (!teams.top || !teams.bottom) {
    return { 
      success: false, 
      message: '試合予定にチーム名が登録されていません。\n以下の形式で開始してください:\n\nAコート 第1試合 開始 先チーム名 後チーム名' 
    };
  }
  
  // スコアボードを初期化
  // updateOrCreateScoreboardにリダイレクトされるinitializeScoreboardを使用
  initializeScoreboard(scoreboardSheet, parsed.court, parsed.gameNum, teams.top, teams.bottom, fullTimestamp);
  
  // ステータス更新
  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'start');
  
  // 記録
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, '開始']);
  
  const broadcastMsg = `⚾ 試合開始!\n${parsed.court}コートで「${teams.top}（先攻）」対「${teams.bottom}（後攻）」の試合が始まりました!`;
  
  return {
    success: true,
    message: `${parsed.court}コート 第${parsed.gameNum}試合 開始`,
    broadcastMessage: broadcastMsg
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
      Logger.log(`試合予定更新: ${court}コート第${gameNum}試合 ${topTeam} vs ${bottomTeam}`);
      return;
    }
  }
  
  // 試合が見つからない場合は新規行を追加
  scheduleSheet.appendRow([court, gameNum, topTeam, bottomTeam, '待機', '', '', '', '', '']);
  Logger.log(`試合予定追加: ${court}コート第${gameNum}試合 ${topTeam} vs ${bottomTeam}`);
}

// ============================================================
// スコアボードを更新または作成（プレースホルダー対応）
// ============================================================
function updateOrCreateScoreboard(scoreboardSheet, court, gameNum, topTeam, bottomTeam, timestamp) {
  const data = scoreboardSheet.getDataRange().getValues();
  
  let topRow = -1;
  let bottomRow = -1;
  
  // 既存の行を探す
  for (let i = 1; i < data.length; i++) {
    if (data[i][COLS.SCOREBOARD.COURT] == court && data[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      if (topRow === -1) {
        topRow = i + 1;
      } else if (bottomRow === -1) {
        bottomRow = i + 1;
      }
    }
  }
  
  const allInitialScores = Array(MAX_INNINGS).fill('');
  
  // 既存の行がある場合は更新、ない場合は新規作成
  if (topRow !== -1) {
    scoreboardSheet.getRange(topRow, COLS.SCOREBOARD.TEAM_NAME + 1).setValue(topTeam);
    scoreboardSheet.getRange(topRow, COLS.SCOREBOARD.STATUS + 1).setValue('試合中');
    scoreboardSheet.getRange(topRow, COLS.SCOREBOARD.TIMESTAMP + 1).setValue(timestamp);
    Logger.log(`スコアボード更新: 行${topRow} → ${topTeam}`);
  } else {
    const topRowData = [court, gameNum, topTeam, ...allInitialScores, 0, '試合中', timestamp];
    scoreboardSheet.appendRow(topRowData);
    Logger.log(`スコアボード新規作成: ${topTeam}`);
  }
  
  if (bottomRow !== -1) {
    scoreboardSheet.getRange(bottomRow, COLS.SCOREBOARD.TEAM_NAME + 1).setValue(bottomTeam);
    scoreboardSheet.getRange(bottomRow, COLS.SCOREBOARD.STATUS + 1).setValue('試合中');
    scoreboardSheet.getRange(bottomRow, COLS.SCOREBOARD.TIMESTAMP + 1).setValue(timestamp);
    Logger.log(`スコアボード更新: 行${bottomRow} → ${bottomTeam}`);
  } else {
    const bottomRowData = [court, gameNum, bottomTeam, ...allInitialScores, 0, '試合中', timestamp];
    scoreboardSheet.appendRow(bottomRowData);
    Logger.log(`スコアボード新規作成: ${bottomTeam}`);
  }
}

// ============================================================
// スコアボード初期化（updateOrCreateScoreboard に統合）
// ============================================================
function initializeScoreboard(scoreboardSheet, court, gameNum, topTeam, bottomTeam, timestamp) {
  // 新しい関数にリダイレクト
  updateOrCreateScoreboard(scoreboardSheet, court, gameNum, topTeam, bottomTeam, timestamp);
}

// ============================================================
// 試合終了処理
// ============================================================
function handleGameEnd(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule, scoreboard } = sheetsData;
  
  // 勝敗判定
  const winner = determineWinner(scoreboard, parsed.court, parsed.gameNum);
  
  // 引き分けの場合
  if (winner.isDraw) {
    Logger.log('引き分け検出: じゃんけんを促す');
    return {
      success: true,
      message: `⚠️ 0-0の引き分けです\nじゃんけんで勝者を決定してください\n\n入力例:\n${parsed.court}コート 第${parsed.gameNum}試合 じゃんけん チーム名`,
      broadcastMessage: null
    };
  }
  
  // 通常の勝敗が決まっている場合
  if (winner.winnerTeam && winner.loserTeam) {
    // ステータス更新
    updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'end');
    
    // 記録
    recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, '終了']);
    
    // 次試合への振り分け
    advanceTeams(scheduleSheet, schedule, parsed.gameNum, winner.winnerTeam, winner.loserTeam);
    
    // 最終スコア取得
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
// 得点入力処理
// ============================================================
function handleScoreInput(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule, scoreboard } = sheetsData;
  
  // イニング数チェック
  if (parsed.inning > MAX_INNINGS) {
    return { success: false, message: `${MAX_INNINGS}回までしか入力できません` };
  }
  
  // チーム名取得
  const teams = getTeamNames(schedule, parsed.court, parsed.gameNum);
  if (!teams.top || !teams.bottom) {
    return { success: false, message: '試合予定が見つかりません' };
  }
  
  // 試合が終了していないか確認
  const gameStatus = getGameStatus(schedule, parsed.court, parsed.gameNum);
  if (gameStatus === '終了') {
    return { 
      success: false, 
      message: `⚠️ この試合は既に終了しています\n${parsed.court}コート 第${parsed.gameNum}試合` 
    };
  }
  
  // 0点の場合は速報を送信しない
  const shouldBroadcast = parsed.score > 0;
  
  // 過去のイニングを0で埋める処理
  fillPastInnings(scoreboardSheet, scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, teams);
  
  // スコアボード更新
  const attackTeam = updateScore(scoreboardSheet, scoreboard, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, parsed.score, teams, fullTimestamp);
  
  if (!attackTeam) {
    return { success: false, message: 'スコアボードの更新に失敗しました' };
  }
  
  // 記録
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, parsed.inning, parsed.topBottom, parsed.score, userId, '得点']);
  
  const inningText = `${parsed.inning}回${parsed.topBottom}`;
  
  // 0点の場合は速報なし
  if (!shouldBroadcast) {
    return {
      success: true,
      message: `${parsed.court}第${parsed.gameNum} ${inningText} ${parsed.score}点（速報なし）`,
      broadcastMessage: null
    };
  }
  
  return {
    success: true,
    message: `${parsed.court}第${parsed.gameNum} ${inningText} ${parsed.score}点`,
    broadcastMessage: `📢 得点速報\n${parsed.court}コート 第${parsed.gameNum}試合\n${inningText}\n${attackTeam} に ${parsed.score}点が入りました！`
  };
}

// ============================================================
// じゃんけん決着処理
// ============================================================
function handleJanken(sheetsData, parsed, userId, fullTimestamp) {
  const { scheduleSheet, scoreboardSheet, recordSheet, schedule } = sheetsData;
  
  // チーム名を取得して勝者が正しいか確認
  const teams = getTeamNames(schedule, parsed.court, parsed.gameNum);
  if (!teams.top || !teams.bottom) {
    return { success: false, message: '試合予定が見つかりません' };
  }
  
  // 勝者チーム名の確認
  if (parsed.winnerTeam !== teams.top && parsed.winnerTeam !== teams.bottom) {
    return { 
      success: false, 
      message: `チーム名が一致しません\n正しいチーム名: ${teams.top} / ${teams.bottom}` 
    };
  }
  
  // 敗者を特定
  const loserTeam = parsed.winnerTeam === teams.top ? teams.bottom : teams.top;
  
  // ステータスを終了に更新
  updateGameStatus(scheduleSheet, scoreboardSheet, parsed.court, parsed.gameNum, 'end');
  
  // 記録
  recordSheet.appendRow([fullTimestamp, parsed.court, parsed.gameNum, '-', '-', '-', userId, `じゃんけん:${parsed.winnerTeam}`]);
  
  // 次試合への振り分け
  advanceTeams(scheduleSheet, schedule, parsed.gameNum, parsed.winnerTeam, loserTeam);
  
  // 実況メッセージ
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
// メッセージ解析（柔軟なコート名対応）
// ============================================================
function parseMessage(message) {
  message = message.trim().replace(/[ 　]+/g, ' ');
  
  // 試合開始パターン（チーム指定あり）
  const startWithTeamsMatch = message.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*開始\s*先(?:攻)?(.+?)\s*後(?:攻)?(.+)$/);
  if (startWithTeamsMatch) {
    return { 
      type: 'start_with_teams', 
      court: startWithTeamsMatch[1], 
      gameNum: parseInt(startWithTeamsMatch[2]),
      topTeam: startWithTeamsMatch[3].trim(),
      bottomTeam: startWithTeamsMatch[4].trim()
    };
  }
  
  // 試合開始パターン（チーム指定なし）
  const startMatch = message.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*開始$/);
  if (startMatch) return { type: 'start', court: startMatch[1], gameNum: parseInt(startMatch[2]) };
  
  const endMatch = message.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*終了$/);
  if (endMatch) return { type: 'end', court: endMatch[1], gameNum: parseInt(endMatch[2]) };
  
  // じゃんけんパターン
  const jankenMatch = message.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*じゃんけん\s*(.+)$/);
  if (jankenMatch) {
    return { 
      type: 'janken', 
      court: jankenMatch[1], 
      gameNum: parseInt(jankenMatch[2]),
      winnerTeam: jankenMatch[3].trim()
    };
  }
  
  const scoreMatch = message.match(/^([A-Za-z0-9]+)(?:コート)?\s*第?(\d+)(?:試合)?\s*(\d+)(表|裏)\s*(\d+)$/);
  if (scoreMatch) {
    return {
      type: 'score',
      court: scoreMatch[1],
      gameNum: parseInt(scoreMatch[2]),
      inning: parseInt(scoreMatch[3]),
      topBottom: scoreMatch[4],
      score: parseInt(scoreMatch[5])
    };
  }
  return null;
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
  
  if (topRow === -1 || bottomRow === -1) {
    Logger.log(`エラー: チームが見つかりません top=${topRow} bottom=${bottomRow}`);
    return null;
  }
  
  const isTop = topBottom === '表';
  const targetRow = isTop ? topRow : bottomRow;
  const attackTeamName = isTop ? teams.top : teams.bottom;
  
  Logger.log(`得点更新: ${inning}回${topBottom} / 攻撃チーム=${attackTeamName} / 行=${targetRow}`);
  
  const inningCol = COLS.SCOREBOARD.INNING_START + inning;
  
  scoreboardSheet.getRange(targetRow, inningCol).setValue(score);
  updateTotal(scoreboardSheet, targetRow);
  scoreboardSheet.getRange(targetRow, COLS.SCOREBOARD.TIMESTAMP + 1).setValue(timestamp);
  
  return attackTeamName;
}

// ============================================================
// 合計得点計算
// ============================================================
function updateTotal(sheet, row) {
  const scores = sheet.getRange(row, COLS.SCOREBOARD.INNING_START + 1, 1, MAX_INNINGS).getValues()[0];
  const total = scores.reduce((sum, val) => sum + (Number(val) || 0), 0);
  sheet.getRange(row, COLS.SCOREBOARD.TOTAL + 1).setValue(total);
}

// ============================================================
// 試合ステータス更新
// ============================================================
function updateGameStatus(scheduleSheet, scoreboardSheet, court, gameNum, status) {
  const statusText = status === 'start' ? '試合中' : '終了';
  
  const scheduleData = scheduleSheet.getDataRange().getValues();
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.COURT] == court && scheduleData[i][COLS.SCHEDULE.GAME_NO] == gameNum) {
      scheduleSheet.getRange(i + 1, COLS.SCHEDULE.STATUS + 1).setValue(statusText);
      break;
    }
  }
  
  const scoreData = scoreboardSheet.getDataRange().getValues();
  for (let i = 1; i < scoreData.length; i++) {
    if (scoreData[i][COLS.SCOREBOARD.COURT] == court && scoreData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      scoreboardSheet.getRange(i + 1, COLS.SCOREBOARD.STATUS + 1).setValue(statusText);
    }
  }
}

// ============================================================
// 勝敗判定
// ============================================================
function determineWinner(scoreboardData, court, gameNum) {
  const teams = [];
  
  Logger.log(`勝敗判定開始: ${court}コート 第${gameNum}試合`);
  
  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      teams.push({
        name: scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME],
        total: scoreboardData[i][COLS.SCOREBOARD.TOTAL] || 0
      });
      Logger.log(`チーム発見: ${scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME]} - ${scoreboardData[i][COLS.SCOREBOARD.TOTAL]}点`);
    }
  }
  
  Logger.log(`検出されたチーム数: ${teams.length}`);
  
  if (teams.length < 2) {
    Logger.log('警告: チームが2つ未満です');
    return { winnerTeam: null, loserTeam: null, isDraw: false };
  }
  
  if (teams.length >= 2) {
    const team1Total = Number(teams[0].total) || 0;
    const team2Total = Number(teams[1].total) || 0;
    
    Logger.log(`比較: ${teams[0].name}(${team1Total}点) vs ${teams[1].name}(${team2Total}点)`);
    
    if (team1Total > team2Total) {
      Logger.log(`結果: ${teams[0].name}の勝利`);
      return { winnerTeam: teams[0].name, loserTeam: teams[1].name, isDraw: false };
    } else if (team2Total > team1Total) {
      Logger.log(`結果: ${teams[1].name}の勝利`);
      return { winnerTeam: teams[1].name, loserTeam: teams[0].name, isDraw: false };
    } else {
      Logger.log(`結果: 引き分け (${team1Total} - ${team2Total})`);
      return { winnerTeam: null, loserTeam: null, isDraw: true };
    }
  }
  
  return { winnerTeam: null, loserTeam: null, isDraw: false };
}

// ============================================================
// 次試合へチームを振り分け（スコアボード更新対応版）
// ============================================================
function advanceTeams(scheduleSheet, scheduleData, finishedGameNum, winnerTeam, loserTeam) {
  let winnerNextGame = null;
  let loserNextGame = null;
  let winnerPosition = null;
  let loserPosition = null;
  
  // 試合予定から次の試合情報を取得
  for (let i = 1; i < scheduleData.length; i++) {
    if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == finishedGameNum) {
      winnerNextGame = scheduleData[i][COLS.SCHEDULE.WINNER_NEXT];
      loserNextGame = scheduleData[i][COLS.SCHEDULE.LOSER_NEXT];
      winnerPosition = (scheduleData[i][COLS.SCHEDULE.WINNER_POS] || '').trim();
      loserPosition = (scheduleData[i][COLS.SCHEDULE.LOSER_POS] || '').trim();
      break;
    }
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scoreboardSheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  
  // 勝者の次試合を更新
  if (winnerNextGame) {
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == winnerNextGame) {
        // 試合予定シートを更新
        if (winnerPosition === '先攻') {
          scheduleSheet.getRange(i + 1, COLS.SCHEDULE.TOP_TEAM + 1).setValue(winnerTeam);
        } else if (winnerPosition === '後攻') {
          scheduleSheet.getRange(i + 1, COLS.SCHEDULE.BOTTOM_TEAM + 1).setValue(winnerTeam);
        }
        
        // スコアボードシートも更新
        updateScoreboardTeamName(scoreboardSheet, winnerNextGame, winnerPosition, winnerTeam);
        
        Logger.log(`勝者 ${winnerTeam} を第${winnerNextGame}試合（${winnerPosition}）に振り分け`);
        break;
      }
    }
  }
  
  // 敗者の次試合を更新
  if (loserNextGame) {
    for (let i = 1; i < scheduleData.length; i++) {
      if (scheduleData[i][COLS.SCHEDULE.GAME_NO] == loserNextGame) {
        // 試合予定シートを更新
        if (loserPosition === '先攻') {
          scheduleSheet.getRange(i + 1, COLS.SCHEDULE.TOP_TEAM + 1).setValue(loserTeam);
        } else if (loserPosition === '後攻') {
          scheduleSheet.getRange(i + 1, COLS.SCHEDULE.BOTTOM_TEAM + 1).setValue(loserTeam);
        }
        
        // スコアボードシートも更新
        updateScoreboardTeamName(scoreboardSheet, loserNextGame, loserPosition, loserTeam);
        
        Logger.log(`敗者 ${loserTeam} を第${loserNextGame}試合（${loserPosition}）に振り分け`);
        break;
      }
    }
  }
}

// ============================================================
// スコアボードシートのチーム名を更新
// ============================================================
function updateScoreboardTeamName(scoreboardSheet, gameNum, position, newTeamName) {
  const data = scoreboardSheet.getDataRange().getValues();
  
  // 該当する試合の行を収集
  const gameRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      gameRows.push({
        rowIndex: i + 1,
        teamName: data[i][COLS.SCOREBOARD.TEAM_NAME]
      });
    }
  }
  
  if (gameRows.length === 0) {
    Logger.log(`スコアボード更新対象が見つかりません: 第${gameNum}試合`);
    return;
  }
  
  // 先攻は最初の行、後攻は2番目の行
  const targetRow = position === '先攻' ? gameRows[0] : gameRows[1];
  
  if (!targetRow) {
    Logger.log(`スコアボード更新対象が見つかりません: 第${gameNum}試合 ${position}`);
    return;
  }
  
  // プレースホルダーかどうかを判定
  const isPlaceholder = /第\d+試合(勝者|敗者)|TBD|未定/.test(targetRow.teamName);
  
  if (isPlaceholder) {
    scoreboardSheet.getRange(targetRow.rowIndex, COLS.SCOREBOARD.TEAM_NAME + 1).setValue(newTeamName);
    Logger.log(`スコアボード更新: 第${gameNum}試合 ${position} ${targetRow.teamName} → ${newTeamName}`);
  } else {
    Logger.log(`スコアボード更新スキップ: 第${gameNum}試合 ${position} は既に確定 (${targetRow.teamName})`);
  }
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
  
  const result = {
    winnerMatch: null,
    loserMatch: null
  };
  
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
        scheduleData[i][COLS.SCHEDULE.STATUS] === '待機') {
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
// 過去のイニングを0で埋める
// ============================================================
function fillPastInnings(scoreboardSheet, scoreboardData, court, gameNum, currentInning, topBottom, teams) {
  const targetRows = [];
  
  for (let i = 1; i < scoreboardData.length; i++) {
    if (scoreboardData[i][COLS.SCOREBOARD.COURT] == court && scoreboardData[i][COLS.SCOREBOARD.GAME_NO] == gameNum) {
      targetRows.push({ 
        row: i + 1, 
        data: scoreboardData[i],
        teamName: scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME]
      });
    }
  }
  
  if (targetRows.length === 0) return;
  
  // 得点を入力するチームを特定
  const attackTeamName = topBottom === '表' ? teams.top : teams.bottom;
  
  // 埋める必要がある最大イニング数を計算
  const maxInningToFill = topBottom === '表' ? currentInning - 1 : currentInning;
  
  targetRows.forEach(targetRow => {
    // 得点を入力するチームの行のみ処理
    if (targetRow.teamName !== attackTeamName) return;
    
    for (let inning = 1; inning <= maxInningToFill; inning++) {
      const inningCol = COLS.SCOREBOARD.INNING_START + inning;
      const currentValue = targetRow.data[inningCol];
      
      if (currentValue === null || currentValue === undefined || currentValue === '') {
        scoreboardSheet.getRange(targetRow.row, inningCol).setValue(0);
      }
    }
    
    // 裏の場合、現在のイニングの表も0で埋める
    if (topBottom === '裏') {
      const currentInningCol = COLS.SCOREBOARD.INNING_START + currentInning;
      const currentValue = targetRow.data[currentInningCol];
      
      if (currentValue === null || currentValue === undefined || currentValue === '') {
        scoreboardSheet.getRange(targetRow.row, currentInningCol).setValue(0);
      }
    }
    
    updateTotal(scoreboardSheet, targetRow.row);
  });
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
// 観客Botへ通知
// ============================================================
function notifyAudienceBot(message) {
  if (!AUDIENCE_BOT_SCRIPT_URL) return;

  const payload = {
    type: 'broadcast',
    message: message
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(AUDIENCE_BOT_SCRIPT_URL, options);
  } catch (e) {
    Logger.log('観客Botへの通知失敗: ' + e);
  }
}

// ============================================================
// LINE返信
// ============================================================
function replyMessage(replyToken, message) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: message }]
    })
  });
}

// ============================================================
// 手動でスコアボードのプレースホルダーを更新する関数
// ============================================================
function syncScoreboardWithSchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const scoreboardSheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  
  if (!scheduleSheet || !scoreboardSheet) {
    Logger.log('シートが見つかりません');
    return;
  }
  
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scoreboardData = scoreboardSheet.getDataRange().getValues();
  
  let updateCount = 0;
  
  // 試合ごとにグループ化
  const gameGroups = {};
  for (let i = 1; i < scoreboardData.length; i++) {
    const gameNum = scoreboardData[i][COLS.SCOREBOARD.GAME_NO];
    if (!gameNum) continue;
    
    if (!gameGroups[gameNum]) {
      gameGroups[gameNum] = [];
    }
    
    gameGroups[gameNum].push({
      rowIndex: i + 1,
      teamName: scoreboardData[i][COLS.SCOREBOARD.TEAM_NAME]
    });
  }
  
  // 各試合を処理
  for (const gameNum in gameGroups) {
    const rows = gameGroups[gameNum];
    
    if (rows.length < 2) {
      Logger.log(`第${gameNum}試合: チームが2つ揃っていません`);
      continue;
    }
    
    // 試合予定から対応するチーム名を取得
    let scheduleTopTeam = null;
    let scheduleBottomTeam = null;
    
    for (let j = 1; j < scheduleData.length; j++) {
      if (scheduleData[j][COLS.SCHEDULE.GAME_NO] == gameNum) {
        scheduleTopTeam = scheduleData[j][COLS.SCHEDULE.TOP_TEAM];
        scheduleBottomTeam = scheduleData[j][COLS.SCHEDULE.BOTTOM_TEAM];
        break;
      }
    }
    
    if (!scheduleTopTeam || !scheduleBottomTeam) {
      Logger.log(`第${gameNum}試合: 試合予定に情報がありません`);
      continue;
    }
    
    // 先攻チーム（1行目）を更新
    const topTeamRow = rows[0];
    const isTopPlaceholder = /第\d+試合(勝者|敗者)|TBD|未定/.test(topTeamRow.teamName);
    const isScheduleTopValid = !/第\d+試合(勝者|敗者)|TBD|未定/.test(scheduleTopTeam);
    
    if (isTopPlaceholder && isScheduleTopValid) {
      scoreboardSheet.getRange(topTeamRow.rowIndex, COLS.SCOREBOARD.TEAM_NAME + 1).setValue(scheduleTopTeam);
      Logger.log(`同期: 第${gameNum}試合 先攻 ${topTeamRow.teamName} → ${scheduleTopTeam}`);
      updateCount++;
    }
    
    // 後攻チーム（2行目）を更新
    const bottomTeamRow = rows[1];
    const isBottomPlaceholder = /第\d+試合(勝者|敗者)|TBD|未定/.test(bottomTeamRow.teamName);
    const isScheduleBottomValid = !/第\d+試合(勝者|敗者)|TBD|未定/.test(scheduleBottomTeam);
    
    if (isBottomPlaceholder && isScheduleBottomValid) {
      scoreboardSheet.getRange(bottomTeamRow.rowIndex, COLS.SCOREBOARD.TEAM_NAME + 1).setValue(scheduleBottomTeam);
      Logger.log(`同期: 第${gameNum}試合 後攻 ${bottomTeamRow.teamName} → ${scheduleBottomTeam}`);
      updateCount++;
    }
  }
  
  Logger.log(`スコアボード同期完了: ${updateCount}件更新`);
  SpreadsheetApp.getUi().alert(`スコアボードを同期しました\n${updateCount}件のチーム名を更新しました`);
}

// ============================================================
// 全試合のステータスをリセット（開発・テスト用）
// ============================================================
function resetAllStatus() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '確認',
    'すべての試合を「待機」状態にリセットしますか？\nこの操作は取り消せません。',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    return;
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const scoreboardSheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  
  if (scheduleSheet) {
    const scheduleData = scheduleSheet.getDataRange().getValues();
    for (let i = 1; i < scheduleData.length; i++) {
      scheduleSheet.getRange(i + 1, COLS.SCHEDULE.STATUS + 1).setValue('待機');
    }
  }
  
  if (scoreboardSheet) {
    const scoreboardData = scoreboardSheet.getDataRange().getValues();
    for (let i = 1; i < scoreboardData.length; i++) {
      scoreboardSheet.getRange(i + 1, COLS.SCOREBOARD.STATUS + 1).setValue('待機');
    }
  }
  
  ui.alert('リセット完了', 'すべての試合を「待機」状態にリセットしました', ui.ButtonSet.OK);
}

// ============================================================
// Web公開用API（スコアボード＋チーム名簿）
// ============================================================
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const params = e.parameter;
    
    // 試合予定APIのリクエスト判定
    if (params.type === 'schedule') {
      return getScheduleData(ss);
    }
    
    // チーム名簿APIのリクエスト判定
    if (params.type === 'teams') {
      return getTeamsData(ss);
    }
    
    // 既存のスコアボードAPI
    return getScoreboardData(ss);
    
  } catch (error) {
    Logger.log('doGet エラー: ' + error);
    return ContentService.createTextOutput(JSON.stringify({
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// チーム名簿データ取得
function getTeamsData(ss) {
  const teamSheet = ss.getSheetByName('チーム名簿');
  
  if (!teamSheet) {
    return ContentService.createTextOutput(JSON.stringify({
      error: 'チーム名簿シートが見つかりません',
      lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
      teams: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (teamSheet.getLastRow() <= 1) {
    return ContentService.createTextOutput(JSON.stringify({
      lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
      teams: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  const lastRow = teamSheet.getLastRow();
  const data = teamSheet.getRange(1, 1, lastRow, 6).getValues();
  const teamsMap = {};
  
  for (let i = 1; i < data.length; i++) {
    const teamName = data[i][0];
    const number = data[i][1];
    const position = data[i][2];
    const name = data[i][3];
    const photoUrl = data[i][4];
    const note = data[i][5];
    
    if (!teamName || teamName === '') continue;
    
    if (!teamsMap[teamName]) {
      teamsMap[teamName] = {
        name: teamName,
        players: []
      };
    }
    
    if (name && name !== '') {
      teamsMap[teamName].players.push({
        number: number || '-',
        position: position || '-',
        name: name,
        photo: photoUrl || '',
        note: note || ''
      });
    }
  }
  
  const teams = Object.values(teamsMap);
  
  const result = {
    lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
    teams: teams
  };
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// スコアボードデータ取得
function getScoreboardData(ss) {
  const scoreboardSheet = ss.getSheetByName(SHEETS.SCOREBOARD);
  
  if (!scoreboardSheet) {
    return ContentService.createTextOutput(JSON.stringify({
      error: 'スコアボードシートが見つかりません',
      lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
      games: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (scoreboardSheet.getLastRow() <= 1) {
    return ContentService.createTextOutput(JSON.stringify({
      lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
      games: []
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const data = scoreboardSheet.getDataRange().getValues();
  
  const result = {
    lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
    games: []
  };
  
  for (let i = 1; i < data.length; i++) {
    const allInnings = data[i].slice(COLS.SCOREBOARD.INNING_START, COLS.SCOREBOARD.INNING_START + MAX_INNINGS);
    
    let maxInning = 7;
    
    for (let j = allInnings.length - 1; j >= 0; j--) {
      const value = allInnings[j];
      if (typeof value === 'number' || (value !== null && value !== undefined && value !== '')) {
        maxInning = Math.max(7, j + 1);
        break;
      }
    }
    
    const innings = [];
    for (let j = 0; j < maxInning; j++) {
      const value = allInnings[j];
      if (value === null || value === undefined || value === '') {
        innings.push(null);
      } else {
        innings.push(Number(value));
      }
    }
    
    result.games.push({
      court: data[i][COLS.SCOREBOARD.COURT],
      gameNum: data[i][COLS.SCOREBOARD.GAME_NO],
      team: data[i][COLS.SCOREBOARD.TEAM_NAME],
      innings: innings,
      total: data[i][COLS.SCOREBOARD.TOTAL],
      status: data[i][COLS.SCOREBOARD.STATUS],
      lastUpdate: data[i][COLS.SCOREBOARD.TIMESTAMP]
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 試合予定データ取得
function getScheduleData(ss) {
  const scheduleSheet = ss.getSheetByName('試合予定');
  
  if (!scheduleSheet || scheduleSheet.getLastRow() <= 1) {
    return ContentService.createTextOutput(JSON.stringify({
      lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
      schedule: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  const data = scheduleSheet.getDataRange().getValues();
  const schedule = [];
  
  // ヘッダー行をスキップ（i=1から開始）
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]) { // 試合番号がある行のみ
      schedule.push({
        court: data[i][0],      // コート
        gameNum: data[i][1],    // 試合番号
        team1: data[i][2],      // 先攻チーム
        team2: data[i][3],      // 後攻チーム
        status: data[i][4] || '',  // 状況
        time: data[i][9]        // 開始予定時刻
      });
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    lastUpdate: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss'),
    schedule: schedule
  })).setMimeType(ContentService.MimeType.JSON);
}