// ============================================================
// 写真一括アップロードスクリプト
// ============================================================

// ★★★ 設定項目 ★★★
const PHOTO_FOLDER_ID = '1CFwIsscf-hrX1TCVrlqjh69I1CqLvn1f'; // Google DriveのフォルダID
const TARGET_SHEET_NAME = 'チーム名簿'; // 書き込み先のシート名

// ============================================================
// メイン処理：フォルダ内の画像URLを一括生成
// ============================================================
function generatePhotoURLs() {
  try {
    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const files = folder.getFiles();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const targetSheet = ss.getSheetByName(TARGET_SHEET_NAME);
    
    if (!targetSheet) {
      Browser.msgBox('エラー', `「${TARGET_SHEET_NAME}」シートが見つかりません`, Browser.Buttons.OK);
      return;
    }
    
    // 一時シートを作成（作業用）
    let tempSheet = ss.getSheetByName('写真URL一覧_temp');
    if (tempSheet) {
      ss.deleteSheet(tempSheet);
    }
    tempSheet = ss.insertSheet('写真URL一覧_temp');
    
    // ヘッダー行を追加
    tempSheet.appendRow(['ファイル名', 'チーム名', '選手名', '背番号', '写真URL', '備考']);
    
    let fileCount = 0;
    const fileList = [];
    
    // ファイル一覧を取得
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      
      // 画像ファイルのみ処理（jpg, jpeg, png, gif）
      if (!/\.(jpg|jpeg|png|gif)$/i.test(fileName)) {
        continue;
      }
      
      fileCount++;
      const fileId = file.getId();
      const photoUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
      
      // ファイル名からチーム名と選手名を抽出
      // 想定形式: "チーム名_選手名_背番号.jpg" または "チーム名_選手名.jpg"
      const parsed = parseFileName(fileName);
      
      fileList.push({
        fileName: fileName,
        teamName: parsed.teamName,
        playerName: parsed.playerName,
        number: parsed.number,
        photoUrl: photoUrl,
        note: parsed.note
      });
      
      // 一時シートに書き込み
      tempSheet.appendRow([
        fileName,
        parsed.teamName,
        parsed.playerName,
        parsed.number,
        photoUrl,
        parsed.note
      ]);
    }
    
    if (fileCount === 0) {
      Browser.msgBox('情報', 'フォルダ内に画像ファイルが見つかりませんでした', Browser.Buttons.OK);
      return;
    }
    
    // 結果を表示
    const message = `${fileCount}枚の画像を検出しました。\n\n「写真URL一覧_temp」シートを確認して、\n問題なければ「チーム名簿に反映」ボタンを押してください。`;
    Browser.msgBox('完了', message, Browser.Buttons.OK);
    
    // アクティブシートを一時シートに切り替え
    ss.setActiveSheet(tempSheet);
    
  } catch (error) {
    Browser.msgBox('エラー', `エラーが発生しました: ${error.message}`, Browser.Buttons.OK);
    Logger.log('エラー: ' + error);
  }
}

// ============================================================
// ファイル名解析
// ============================================================
function parseFileName(fileName) {
  // 拡張子を除去
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  
  // アンダースコアで分割
  const parts = nameWithoutExt.split('_');
  
  let teamName = '';
  let playerName = '';
  let number = '';
  let note = '';
  
  if (parts.length >= 2) {
    teamName = parts[0].trim();
    playerName = parts[1].trim();
    
    // 3つ目のパーツがあれば背番号
    if (parts.length >= 3 && /^\d+$/.test(parts[2])) {
      number = parts[2].trim();
    }
    
    // 4つ目以降は備考
    if (parts.length >= 4) {
      note = parts.slice(3).join('_').trim();
    }
  } else {
    // アンダースコアがない場合
    teamName = '未分類';
    playerName = nameWithoutExt;
    note = 'ファイル名を確認してください';
  }
  
  return {
    teamName: teamName,
    playerName: playerName,
    number: number,
    note: note
  };
}

// ============================================================
// チーム名簿に反映
// ============================================================
function applyToTeamRoster() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tempSheet = ss.getSheetByName('写真URL一覧_temp');
    const targetSheet = ss.getSheetByName(TARGET_SHEET_NAME);
    
    if (!tempSheet) {
      Browser.msgBox('エラー', '一時シートが見つかりません。先に「写真URL生成」を実行してください。', Browser.Buttons.OK);
      return;
    }
    
    if (!targetSheet) {
      Browser.msgBox('エラー', `「${TARGET_SHEET_NAME}」シートが見つかりません`, Browser.Buttons.OK);
      return;
    }
    
    const tempData = tempSheet.getDataRange().getValues();
    
    // ヘッダー行をスキップ
    let addedCount = 0;
    let updatedCount = 0;
    
    for (let i = 1; i < tempData.length; i++) {
      const teamName = tempData[i][1];
      const playerName = tempData[i][2];
      const number = tempData[i][3];
      const photoUrl = tempData[i][4];
      const note = tempData[i][5];
      
      // チーム名または選手名が空の場合はスキップ
      if (!teamName || !playerName) {
        continue;
      }
      
      // チーム名簿シートで該当する選手を探す
      const targetData = targetSheet.getDataRange().getValues();
      let found = false;
      
      for (let j = 1; j < targetData.length; j++) {
        const existingTeam = targetData[j][0];
        const existingName = targetData[j][3];
        
        // チーム名と選手名が一致する行を探す
        if (existingTeam === teamName && existingName === playerName) {
          // 既存の行に写真URLを追加
          targetSheet.getRange(j + 1, 5).setValue(photoUrl); // E列（顔写真URL）
          
          // 備考がある場合は追加
          if (note) {
            const existingNote = targetData[j][5] || '';
            const newNote = existingNote ? `${existingNote} / ${note}` : note;
            targetSheet.getRange(j + 1, 6).setValue(newNote); // F列（備考）
          }
          
          updatedCount++;
          found = true;
          break;
        }
      }
      
      // 見つからなかった場合は新規行を追加
      if (!found) {
        // チーム名簿の形式: チーム名 | 背番号 | 肩書 | 名前 | 顔写真URL | 備考
        targetSheet.appendRow([
          teamName,
          number,
          '', // 肩書は空
          playerName,
          photoUrl,
          note
        ]);
        addedCount++;
      }
    }
    
    // 一時シートを削除
    ss.deleteSheet(tempSheet);
    
    // アクティブシートをチーム名簿に切り替え
    ss.setActiveSheet(targetSheet);
    
    const message = `完了しました！\n\n更新: ${updatedCount}件\n追加: ${addedCount}件`;
    Browser.msgBox('完了', message, Browser.Buttons.OK);
    
  } catch (error) {
    Browser.msgBox('エラー', `エラーが発生しました: ${error.message}`, Browser.Buttons.OK);
    Logger.log('エラー: ' + error);
  }
}

// ============================================================
// カスタムメニュー追加
// ============================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📸 写真管理')
    .addItem('1. 写真URL生成', 'generatePhotoURLs')
    .addItem('2. チーム名簿に反映', 'applyToTeamRoster')
    .addSeparator()
    .addItem('ヘルプ', 'showHelp')
    .addToUi();
}

// ============================================================
// ヘルプ表示
// ============================================================
function showHelp() {
  const helpText = `
【写真一括アップロードの使い方】

1. 写真のファイル名を以下の形式にする：
   チーム名_選手名_背番号.jpg
   
   例: レッドファイターズ_山田太郎_1.jpg
       ブルードラゴンズ_佐藤次郎_2.png

2. Google Driveの指定フォルダに写真をアップロード

3. スプレッドシートで「📸 写真管理」→「1. 写真URL生成」を実行

4. 一時シートで内容を確認

5. 問題なければ「2. チーム名簿に反映」を実行

【注意事項】
- ファイル名にアンダースコア(_)を使用してください
- 背番号は省略可能です
- 対応形式: jpg, jpeg, png, gif
- チーム名と選手名が一致する場合は写真URLが更新されます
- 一致しない場合は新規行として追加されます

【設定】
スクリプトエディタで以下を設定してください:
- PHOTO_FOLDER_ID: DriveフォルダのID
- TARGET_SHEET_NAME: 書き込み先シート名
`;
  
  Browser.msgBox('ヘルプ', helpText, Browser.Buttons.OK);
}