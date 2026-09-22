# 無文字照片翻面提示 — 2026-09-22

使用者要求三版 mock-up：以視覺提示卡片可翻面，移除可見的操作文字。A 已由使用者選定，2026-09-22 第二輪改為 32px 淡折角，並整合 Nuxt 官網；B／C 保留比稿。

- A 掀起一角（已採用）：32px 淡折角＋橫線紙背面，首次入鏡輕掀一次；折角在旋轉紙面內，不再固定在外層。
- B 正反雙面：照片／橫線紙小圖與 Phosphor 回轉箭頭，直接印在相紙留白，不加貼籤。
- C 側邊露背：右下整段紙緣捲起，露出背面；滑鼠移入微彎。

桌機三欄比較，手機縱向比較；網址 `?view=a|b|c` 可單獨看每版。每張都可點擊／觸控／Enter／Space 翻到原有故事並再翻回。背面同步使用同一視覺提示；減少動態改為立即切換。視覺上不顯示翻面文字，但保留 accessible name、aria-expanded、aria-controls 與隱藏面的 inert。

照片與故事沿用 `web/public/assets/day-hello.webp`、`web/server/data/site-fixture.json`。本頁 CSS 3D 供操作示意；官網已使用現有 WebGL 柔軟紙張，折角畫入貼圖。根目錄原型保持凍結。首輪 PNG 保留為原始比稿；第二輪驗證圖在 output/playwright/flip-a-subtle/。

本機：於 repo 根目錄啟動 `python3 -m http.server 8768 --bind 127.0.0.1`，開啟 `http://127.0.0.1:8768/design/flip-without-copy-20260922/`。
