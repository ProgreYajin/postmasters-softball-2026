---
paths:
  - gas-staff/**
  - gas-audience/**
---

# GAS開発ルール

- シート列番号は `COLS` 定数（0-based）で管理。`getRange()` は1-basedなので `+1` が必要
- イニング列: 配列(0-based)は `INNING_START + inning - 1`、getRange(1-based)は `INNING_START + inning`。混同注意
- GASファイルはUTF-8で日本語ファイル名を使用
- LINE Webhook署名検証は必須（HMAC-SHA256）
- LockServiceで排他制御（30秒タイムアウト）
