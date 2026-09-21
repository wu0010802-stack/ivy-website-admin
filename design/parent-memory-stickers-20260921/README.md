# 親子共鳴貼紙探索，2026-09-21

使用者要求繼續探索乖寶寶貼紙、姓名貼與其他能觸動家長共鳴的樣式。四款為獨立互動 mock-up，保留既有翻面 icon，尚未整合正式網站。

## 比較方向

| 方案 | 貼紙文字 | 想喚起的回憶 | 設計取捨 |
| --- | --- | --- | --- |
| P1 獎勵花花貼 | 我做到了 | 放學時，孩子急著分享得到的小花 | 最醒目，童趣較強，適合強調小小成就 |
| P2 入園姓名貼 | 我的小日常 | 開學前，家長替書包水壺逐一貼姓名 | 熟悉且含蓄，接近生活用品的觸感 |
| P3 老師留言貼 | 想跟你說 | 聯絡簿裡，老師記下孩子的一個小發現 | 優先推薦，適合邀請家長閱讀孩子的日常 |
| P4 作品收藏貼 | 小小回憶 | 冰箱門上捨不得取下的第一張畫 | 像成長紀錄，與拍立得氣質接近 |

這些情感連結是設計假設，未做家長訪談或成效測試。沒有使用虛構家長見證、人名、班級或老師觀察紀錄。正反面的正式內容仍使用 repo 的早安入園 fixture 與原照片。

## 預覽與操作

從 repo 根目錄啟動 `python3 -m http.server 8783 --bind 127.0.0.1`：

`http://127.0.0.1:8783/design/parent-memory-stickers-20260921/`

`?view=p1` 到 `?view=p4` 可單獨觀看。按鈕在翻面時維持原位置，背面統一改為「看照片」；支援滑鼠、觸控、Tab、Enter、空白鍵、Escape 關閉提示與減少動態模式。這裡使用 CSS 3D 展示，不代替正式網站的 WebGL 紙張效果。

## 素材與字型

- 紙材／插畫：本次使用內建 image_gen 生成 4 張透明 PNG，保存在 `assets/p1-reward.png`、`assets/p2-name.png`、`assets/p3-note.png`、`assets/p4-keepsake.png`。完整提示詞在 `prompts.json`。
- 文字與功能圖示：HTML 文字、既有 Phosphor Regular 翻面 SVG。避免文字被燒進圖片，保留清楚的可存取名稱。
- 真實情境照片：`web/public/assets/day-hello.webp`，保留「陪伴互動 · 入園情境示意」。
- 手寫字型：[LXGW WenKai TC](https://github.com/lxgw/LxgwWenkaiTC)，由 [Google Fonts](https://github.com/google/fonts/tree/main/ofl/lxgwwenkaitc) 提供文字子集，存為 `assets/sticker-hand.woff`。僅用於本比較頁，OFL 授權與來源 URL 保存在 assets。其餘字體沿用前輪 mock-up。

## 驗證

Chrome / Playwright：1520px 桌機、390px 與 320px 手機；全部圖片及字型載入、無水平溢出、4 款點擊／觸控／鍵盤往返、焦點留在按鈕、非目前卡面的 inert／aria-hidden、背面文案與減少動態模式通過。未在真實手機或 VoiceOver 上驗證。

重跑：`node output/playwright/parent-memory-stickers-20260921/check.cjs`。截圖與報告保存在同一 output 目錄，最終比較圖及手機截圖另保存在本 design 目錄。

已執行 repo 要求的 `node --check app.js` → `python3 package_preview.py`。原 prototype 的內容不因獨立 mock-up 改變。
