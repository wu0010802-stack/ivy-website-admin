# 首屏「完全沒有字」預覽（2026-09-15）

- 在網址加 `?hero=quiet`（例如 `index.html?hero=quiet#/home`）即可看首屏不放任何文字的樣子：eyebrow、標語、副標、按鈕、影片說明列、底部列都不顯示，遮罩只留頁首帶，影片以原本亮度呈現，暫停鈕改成只有圖示的圓鈕。
- 對應規則在 `studio.css` 最下方的 `.hero-quiet` 區塊，開關在 `app.js` 開頭；正式版若不需要可整段移除。
- `desktop-1440.jpeg`、`desktop-1440-b.jpeg`（兩個不同鏡頭）、`mobile-390.jpeg` 為截圖。
