# 首頁 News 交界三版轉場（2026-09-22，未整合）

依使用者截圖的深綠 → 近期活動／最新消息交界，參考 Wellington College 的 scroll-linked clip-path 章節交接，做三版可捲動、重播、拖曳進度的獨立提案。

- A 直線揭幕：深綠退開，露出已採用的霧藍 `#DCE7EB`。推薦方向。
- B 圓弧展開：暖米 `#EDE0C9` 從下方以橢圓遮罩展開。
- C 整面漸染：深綠漸變到鼠尾草綠 `#DBE6D5`，內容分段淡入。

本次不修改 Nuxt、CMS、部署或已凍結原型。現行 Nuxt 五校已為暖白左右分景；此頁的深綠五校尾段僅重現使用者截圖的轉場起點，並非新五校設計。News 沿用現行雙欄／三張照片、日期卡與手機列表。日期和文案為既有設計範例。

預覽：`http://127.0.0.1:8765/design/news-transition-20260922/`

直接體驗：`stage.html?direction=a|b|c`。`p=0..1` 可指定初始進度，`motion=fallback` 可檢查原生捲動動畫之外的 JS 備援。原生 CSS 支援同時檢查 animation-timeline、animation-range 與 timeline-scope；備援採 passive scroll + rAF，沒有攔截 wheel／touch。prefers-reduced-motion／forced-colors 使用直接閱讀版。

新聞連結開啟說明用 dialog，沒有報名、通知或資料寫入。被遮罩的內容在轉場完成前設 inert，避免鍵盤進入不可見內容。重播遇到手動捲動、觸控或背景分頁即停止。

參考：[Wellington College](https://www.wellingtoncollege.org.uk/)，於 2026-09-22 實際檢視首頁及 animations-homepage-2025.js：區塊以捲動進度驅動 clipPath inset 退場。本次保留章節交接概念，不複製其品牌／照片／文字。

Chrome 驗證通過：五尺寸（320、390、768、1440、2048px）× 三版 × 四進度（0%、50%、100%、反向25%）共60狀態，CSS 原生與拉桿進度誤差小於1.5%，舞台固定位置正確、圖片載入完成、無水平溢出／runtime error。JS 備援另檢查九狀態；dialog／Esc／焦點還原、5.2秒播放／手動中止、鍵盤拉桿、減少動態、高對比切換通過。比較頁四尺寸 × 三版的12狀態與390px iframe切換通過。

驗證截圖與摘要存於 `output/playwright/news-transition/`；三版代表性轉場縮圖存於 `shots/`。A 截圖進度89%、B72%、C88%，各選能辨識其形狀的時間點，不表示相同進度。新增標題使用系統繁中字型，既有 News 標題沿用 LINE Seed 子集及既有字元 fallback（丁／季／消／秋）。

`node --check app.js`、`node --check design/news-transition-20260922/stage.js`、`python3 package_preview.py` 通過，`preview.html` 無差異。未做 Nuxt 主站整合、Safari／Firefox 或 iOS 實機驗收。
