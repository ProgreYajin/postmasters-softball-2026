# Postmasters Softball 2026

2026年千葉県郵便局長ソフトボール大会の運営システム。

## プロジェクト概要

LINE公式アカウント + Google Apps Script + Cloudflare Workers + 静的Webサイトによるサーバーレス大会管理システム。

## アーキテクチャ

```
[スタッフLINE] → [GAS Staff Bot] → [Google Sheets] ← [GAS Audience Bot] ← [観客LINE]
                       ↓                                      ↓
                  [観客へ速報配信]                    [Cloudflare Worker → R2]
                                                              ↓
[Webサイト] ← Fetch JSON ← [GAS API endpoints]        [写真CDN配信]
```

## ディレクトリ構成

```
bot/                    # LINE Bot参考コード（GAS本体はgas-*/に）
  staff.js              #   スタッフbot参考
  audience              #   観客bot参考
gas-staff/              # スタッフ用GAS（得点報告・試合管理）
  コード.js              #   GAS本体（doPost/doGet、得点処理、API）
  写真一括アップロードスクリプト.js  # チーム名簿写真反映
  appsscript.json       #   GAS設定（V8、STACKDRIVER）
gas-audience/           # 観客用GAS（写真投稿・ブロードキャスト）
  コード.js              #   GAS本体（doPost/doGet、写真管理）
  appsscript.json       #   GAS設定
chiba-softball-r2-gallery/  # Cloudflare Worker（画像R2アップロード）
  src/index.js          #   Worker本体
  wrangler.jsonc        #   Worker設定（R2バインディング）
web/                    # 静的Webサイト
  index.html            #   トップ（スライダー、速報サマリー）
  scoreboard.html       #   試合速報（イニング別スコア、自動更新）
  gallery.html          #   写真ギャラリー（モーダル、スワイプ）
  tournament.html       #   トーナメント表（SVG描画）
  schedule.html         #   大会スケジュール
  teams.html            #   チーム・選手一覧（顔写真付き）
  venue.html            #   会場案内（佐倉市岩名運動公園）
  rules.html            #   大会ルール
  history.html          #   歴代優勝記録
  js/config.js          #   API URL、座標設定、定数
  js/common.js          #   共通ユーティリティ（ナビ生成）
  js/scoreboard-app.js  #   ScoreboardApp
  js/gallery-app.js     #   GalleryApp
  js/tournament-main.js #   TournamentApp（SVG）
  js/index-app.js       #   IndexApp
test/                   # テスト
  unit-test.js          #   ユニットテスト（Node.js assert）
.github/workflows/      # CI/CD
  deploy-gas.yml        #   GAS自動デプロイ（clasp push）
  deploy-workers.yml    #   Workers自動デプロイ（wrangler deploy）
```

## 技術スタック

- **フロントエンド**: HTML5 + CSS3 + Vanilla JS（フレームワーク不使用）
- **バックエンド**: Google Apps Script（V8ランタイム）
- **ストレージ**: Google Sheets（DB）、Google Drive（写真保存）、Cloudflare R2（画像CDN）
- **インフラ**: Cloudflare Workers、GitHub Actions
- **外部API**: LINE Messaging API

## 主要機能

### 得点報告（スタッフbot → gas-staff/コード.js）
- 入力形式: `Aコート 第1試合 3表 2`（コート、試合番号、イニング/表裏、得点）
- parseMessage()で正規表現パース → スコアボードシート更新 → 観客botへ速報配信
- LockServiceで排他制御（30秒タイムアウト）
- 対応コマンド: score, start_with_teams, end, resume, janken

### 写真投稿（観客bot → gas-audience/コード.js）
- LINE画像受信 → Content APIで取得 → Cloudflare Worker経由R2アップロード
- スプレッドシートに記録（タイムスタンプ、ユーザー名、URL）
- セキュリティ: LINE署名検証、10MBサイズ制限、キャッシュロック（重複防止60秒）

### Webサイト（web/）
- GAS APIからFetchでデータ取得、自動更新（configurable間隔）
- ScoreboardApp: イニング別スコア表示
- GalleryApp: 写真グリッド、モーダル（スワイプ/キーボード対応）、ハッシュ差分更新
- TournamentApp: SVG Canvas描画、座標マッピングでリアルタイム更新

## API仕様

### GAS Staff API (doGet)
```
GET .../exec?type=schedule|scoreboard|teams
→ JSON { lastUpdate, schedule|scoreboard|teams }
```

### GAS Audience API (doGet)
```
GET .../exec
→ JSON { lastUpdate, photos: [{ timestamp, userName, fullImage, thumbnail }] }
```

### Cloudflare Worker API
```
POST /
Headers: X-Filename, X-Content-Type, X-Auth-Token
Body: binary image
→ JSON { success, url, filename, size, contentType }
```

## 環境変数・シークレット

### GAS（PropertiesServiceで管理）
- `LINE_ACCESS_TOKEN` — LINE Messaging API認証
- `CHANNEL_SECRET` — LINE Webhook署名検証
- `AUDIENCE_BOT_URL` — 観客bot GAS公開URL（スタッフbot側で使用）
- `R2_UPLOAD_WORKER_URL` — Cloudflare Worker URL（観客bot側で使用）
- `WORKER_AUTH_TOKEN` — Worker認証トークン
- `DRIVE_FOLDER_ID` — Google Drive写真フォルダID
- `BROADCAST_TOKEN` — スタッフbot→観客bot内部通信認証（両方に同じ値を設定。`setupBroadcastToken()`で設定済み）

### Cloudflare Workers（wrangler.jsonc）
- `WORKER_AUTH_TOKEN` — アップロード認証
- `R2_PUBLIC_URL` — R2公開URL
- `R2_BUCKET` (binding) — R2バケット参照

### GitHub Actions Secrets
- `CLASP_REFRESH_TOKEN` — clasp認証用Googleリフレッシュトークン（workflowのnode -eでclasprc.jsonを組み立て）
- `CLOUDFLARE_API_TOKEN` — Cloudflareデプロイ認証
- `CLOUDFLARE_ACCOUNT_ID` — CloudflareアカウントID

## デプロイ

### GAS（gas-staff/, gas-audience/）
- GitHub Actionsで自動デプロイ（`clasp push -f`）
- トリガー: `gas-staff/**` or `gas-audience/**` or `.github/workflows/deploy-gas.yml` パス変更時
- ローカルからの手動デプロイ: `~/.local/node_modules/.bin/clasp push -f`（認証情報: `~/.clasprc.json`）

### Cloudflare Workers（chiba-softball-r2-gallery/）
- GitHub Actionsで自動デプロイ（`wrangler deploy`）
- トリガー: mainブランチpush or 手動dispatch

## Google Sheetsのシート構成
- 試合予定 — コート、試合番号、チーム名、時間、状態
- スコアボード — イニング別得点（6回制）
- 得点記録 — 監査ログ（全入力履歴）
- チーム名簿 — 選手情報（背番号、ポジション、名前、写真URL）
- 写真投稿 — 投稿写真の記録
- ユーザー一覧 — LINEユーザー管理

## テスト

### ユニットテスト（test/unit-test.js）
- `node test/unit-test.js` で実行（npm依存なし、Node.js assertのみ）
- テスト対象: parseMessage, determineWinner, formatTime, validateSignature, Workerバリデーション
- GAS固有API（Utilities等）はNode.js crypto等で代替してテスト
- 新しい純粋関数を追加した場合はここにテストを追加すること

### API疎通テスト
- Staff API: `config.js` の `STAFF_API_URL` にGETリクエスト（パラメータ: なし/schedule/teams）
- Audience API: `config.js` の `AUDIENCE_API_URL` にGETリクエスト
- GAS URLは302リダイレクト（script.google.com → script.googleusercontent.com）を経由する

## 開発時の注意

- GASファイルはUTF-8で日本語ファイル名を使用
- LINE Webhook署名検証は必須（HMAC-SHA256）
- R2公開URL: `https://pub-d1b8738273da4b779dbc93fc861dc066.r2.dev`
- Web側はフレームワーク不使用のVanilla JS、ビルドステップなし
- トーナメント表はSVG座標のハードコードあり（config.jsのTEAM_COORDINATES, MATCH_COORDINATES）
- Web全ページで `common.js`（escapeHtml, getSafeValue等）をグローバル依存として使用。新ページ追加時は `config.js` → `common.js` → アプリJS の順で読み込むこと
- GASのシート列番号は `COLS` 定数（0-based）で管理。`getRange()` は1-basedなので `+1` が必要
