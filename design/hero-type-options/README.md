# 首屏字體探索（2026-09-15）

開啟 `index.html` 可離線切換四個方向、原版對照、桌面／手機與主標縮放。`?overview=1` 為四款並排。

| 方向 | 主標字型 | 字重 | 桌面 1440px | 手機 390px | 行高 |
|---|---|---|---|---|---|
| A 清爽溫暖（建議先看） | LINE Seed TW | 700 | 60px | 34px | 1.32 |
| B 親切圓潤 | jf open 粉圓 / Huninn | 400 | 64px | 36px | 1.40 |
| C 沉穩書卷 | Noto Serif TC | 600 | 60px | 34px | 1.36 |
| D 自然手寫 | 芫荽 / Iansui | 400 | 64px | 36px | 1.42 |
| 原版 | LINE Seed TW | 800 | 73.6px | 36.32px | 1.24 |

新方向的副標統一桌面 18px、手機 16px、行高 1.85。字級實作以 rem 與 clamp 響應式縮放；表格為預設 16px 根字級的對照值。

本次為視覺選項，不修改主站。沿用目前頁首、文案、按鈕、底線、遮罩與影片海報；使用同一張海報減少不同影片畫格對判斷的影響。動態影片上的每幀可讀性需在選定方向後再驗證。

`build.py` 從主站 HTML、CSS 與 `home()` 的 hero 內容產生內嵌預覽；輸出包含實際字型、校徽與照片，不依賴外部網路。重新產生：

```sh
python3 design/hero-type-options/build.py
```

LINE Seed TW 沿用 `assets/fonts/` 的正式子集，來源 https://seed.line.me/index_tw.html 。其餘三款從 Google Fonts 官方 CSS API 取得僅含主標的子集，來源及下載資訊見 `fonts/sources.json`，OFL 授權文件同目錄保留。未使用人工合成粗體。

字型官方資料：

- https://github.com/justfont/open-huninn-font
- https://fonts.google.com/noto/specimen/Noto+Serif+TC
- https://github.com/ButTaiwan/iansui
