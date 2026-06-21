---
paths:
  - web/**
---

# Web開発ルール

- 全ページで `common.js`（escapeHtml, getSafeValue等）をグローバル依存として使用
- 新ページ追加時: `config.js` → `common.js` → アプリJS の順で読み込むこと
- フレームワーク不使用のVanilla JS、ビルドステップなし
- トーナメント表はSVG座標のハードコードあり（config.jsのTEAM_COORDINATES, MATCH_COORDINATES）
