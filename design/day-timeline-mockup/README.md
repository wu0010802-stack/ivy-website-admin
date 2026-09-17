# 孩子的一天：固定影片背景與交錯時間軸

2026-09-17 獨立動態 mock-up。僅新增此目錄及 `output/playwright/day-timeline/` 截圖，尚未整合主站，也未重新打包主站 `preview.html`。

## 預覽

本機入口：<http://127.0.0.1:8886/design/day-timeline-mockup/>

若伺服器已停止，從專案根目錄執行：

```sh
python3 -m http.server 8886 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

也可直接開啟本目錄的 `index.html`。請保留專案既有 `assets/` 和 `design/day-stories-demo/`，本提案引用其中的字型、日常照片與品牌圖。

## 觀看順序

1. 從全人教育的淡綠收尾畫面開始，下滑讓前景由下往上揭開，露出影片與「跟著孩子，過一天」。
2. 影片固定在導覽列下方，隨自身時間播放；一般頁面捲動帶動前景，不攔截滾輪，不逐格拖動影片。
3. 六張照片／色塊卡在桌機左右交錯，依閱讀位置淡入上移，中央時間軸逐段亮起。
4. 手機將時間軸移至左側，照片維持足夠寬度、照作息順序呈現；結尾可「重看進場轉場」。

效果參考：[Wellington College](https://www.wellingtoncollege.org.uk/) 與使用者提供的兩張截圖；使用義華素材與常春藤品牌色。

## 影片剪輯

原檔：`/Users/yilunwu/Downloads/義華 遊藝表演 Acopy.mp4`，3840 × 2160、約 51 分鐘。抽看全片 33 個時間點，再檢查候選段落的連續影格，選取以下群舞畫面：

| 原片段落 | 素材內容 |
| --- | --- |
| 04:08–04:15 | 藍色舞衣群舞 |
| 10:00–10:07 | 銀色舞衣群舞 |
| 29:58–30:05 | 團體舞台演出 |
| 42:31–42:38 | 多人隊形演出 |

每段取 7 秒，段落間 0.75 秒交叉淡接，尾段淡接回首段；裁去開頭重複的 0.75 秒，輸出 **25 秒循環**。原音訊移除、原速、24 fps、H.264／yuv420p、faststart。

- `media/day-film.mp4`：1440 × 810，約 8.9 MiB，桌機版。
- `media/day-film-mobile.mp4`：960 × 540，約 2.9 MiB，800px 以下首次載入選用。
- `media/day-poster.webp`：開場影格，約 149 KiB；影片載入前或失敗時顯示。

影片在區塊進入可視範圍後才載入、靜音播放；可手動暫停／播放，頁籤隱藏或區塊離開視窗時暫停。偏好減少動態時預設不載入影片，仍可手動播放。

## 日常照片與時刻

08:00、09:30、11:30、12:30、14:30、16:30 都是**提案示意時刻**，不是園方已核定的作息。

- 五張日常照片引用 `design/day-stories-demo/media/`，出處與原始切點見該目錄 README。
- 午餐使用準備餐具畫面，不宣稱是實際進食；回家使用整理物品畫面。
- 午休使用 `assets/classroom.webp` 作為教室空間參考，畫面標註「午休照片待補」。
- 背景是遊藝表演紀錄，照片與時間不是同一天的連續拍攝；頁尾有簡短註記。

## 驗證

Chromium 已檢查：

- 1440 × 1000、768 × 844、390 × 844、320 × 844：無水平溢出、無破圖。
- 轉場確實裁切淡綠前景；卡片交錯與進場動畫正常。
- 下滑 260px 後背景 top 仍為 76px（手機導覽高度），確認背景保持固定。
- 背景暫停與恢復播放、行動導覽開啟與 Escape 關閉通過。
- `prefers-reduced-motion: reduce`：進入 still 模式、不自動載入影片、六張卡可閱讀。
- 模擬不支援 CSS scroll timeline：passive scroll／requestAnimationFrame 備援揭幕正常。
- 停用 JavaScript：仍保留六張卡與靜態背景，390px 無溢出。
- `node --check mockup.js` 通過；檢查過程沒有 JavaScript 錯誤。

尚未做 Safari／Firefox 實機驗證。

截圖位於 `../../output/playwright/day-timeline/`：`desktop-entry.png`、`desktop-transition.png`、`desktop-intro.png`、`desktop-timeline.png`、`desktop-stories.png`、`mobile-intro.png` 與各寬度的 timeline 圖。
