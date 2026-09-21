# 家長共鳴貼紙探索 P5–P10

延續 P1–P4 的獨立互動 mock-up。保留原本翻面 icon，探索幼兒園物件與家長生活記憶的連結；未套用至正式網站。

預覽：<http://127.0.0.1:8783/design/parent-memory-more-20260921/>

先看六款近圖，點選任何一款即可進入拍立得情境試翻面。也可以切換全部卡片比較。網址支援 `?view=p8` 或 `?mode=cards`。

| 編號 | 樣式 | 按鈕文案 | 設計聯想 |
| --- | --- | --- | --- |
| P5 | 聯絡簿印章 | 小發現 | 今天的小事被留意 |
| P6 | 鉛筆姓名貼 | 我的今天 | 陪孩子寫下第一筆 |
| P7 | 小書包吊牌 | 出發囉 | 第一次自己走進校門 |
| P8 | 衣物布標 | 慢慢長大 | 洗衣收衣時發現孩子長大了 |
| P9 | 成長集點貼 | 又長大了 | 記下每一點勇氣 |
| P10 | 孩子的撕紙拼貼 | 送給你 | 收到孩子親手做的小禮物 |

這些情緒連結是設計假設，尚未經家長訪談驗證。優先比較 P8 的日常照顧感與 P10 的親子贈禮感。

## 素材與互動

- 六張背景由 imagegen 生成，原始檔位於 `assets/p5-stamp.png` 至 `assets/p10-collage.png`；完整提示詞記錄於 `prompts.json`。
- 文案與 SVG icon 由 HTML 呈現，背景圖不承載文字。圖像未另外修圖。
- 沿用前輪的相同示意照片與故事，照片來源為專案 `web/public/assets/day-hello.webp`，方便比較按鈕設計。
- 手寫字型為 LXGW WenKai TC 的本機子集，來源記錄與授權分別為 `assets/font-source.txt`、`assets/FONT-LICENSE.txt`。
- 翻面後文案切換為「看照片」；保留鍵盤焦點，隱藏面的內容設為 inert / aria-hidden，支援 reduced motion。

## 瀏覽器驗證

Chrome / Playwright：1520 px 桌面、390 px 與 320 px 觸控模擬，六款點擊、觸控與鍵盤翻面流程通過；無水平溢出，素材正常載入，無記錄到瀏覽器錯誤。詳見 `verification.json`。

截圖：`six-stickers.png` 六款近圖、`comparison.png` 實際卡片比較、`gallery-mobile.png` 手機圖集，以及 `p5-mobile.png` 至 `p10-mobile.png` 個別手機情境。這些是瀏覽器模擬，未進行實機與 VoiceOver 驗證。

根目錄必要檢查 `node --check app.js`、`python3 package_preview.py` 已完成，沒有產生 tracked `preview.html` 變更。
