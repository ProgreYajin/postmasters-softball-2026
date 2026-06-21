---
name: deploy
description: GASおよびCloudflare Workersのデプロイ手順。clasp pushやwrangler deployを実行するとき使う。
---

## GAS デプロイ（gas-staff/, gas-audience/）
- 自動: GitHub Actions（`gas-staff/**` or `gas-audience/**` 変更でトリガー）
- 手動: `~/.local/node_modules/.bin/clasp push -f`（認証: `~/.clasprc.json`）

## Cloudflare Workers デプロイ（chiba-softball-r2-gallery/）
- 自動: GitHub Actions（mainブランチpush or 手動dispatch）
- 手動: `wrangler deploy`

## GitHub Secrets 設定
GitHub API + pynacl暗号化を使う（`/tmp/set_secret.py`参照）。
iPhoneからのコピペは改行混入で失敗しやすい。
