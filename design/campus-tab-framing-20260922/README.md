# 分校線稿按鈕：三個新方向

**定案更新**：使用者選定 A「留白短線」，已整合至 `web/app/components/CampusBoard.vue`；[本機正式前台](http://127.0.0.1:3010/#campuses)。此目錄保留三款比稿，最新驗證與截圖在 `output/playwright/campus-lineart-a/`，尚未部署。

2026-09-22，使用者否決沿建築外緣描邊的按鈕框線，要求其他想法。新增獨立比較頁；三款都保留五校原有線稿、明體標題及既有照片輪播。

- A「留白短線」：選取時只在校名下方加 25px 短底線，手機為 20px。
- B「校名膠囊」：細線小膠囊只包住校名，選取時淡灰綠。
- C「輕框卡片」：14px 圓角細框包住線稿與校名，選取時淡灰綠；手機圓角 10px。

[比較頁](http://127.0.0.1:8772/design/campus-tab-framing-20260922/)。互動預覽 `preview.html?frame=a|b|c`，預設 B、明華校、輪播暫停。可加 `&capture=1` 隱藏比稿導覽，`&campus=renwu` 等指定校區。只改獨立 mock-up，未整合 Nuxt 或部署。

在 repo 根目錄啟動：

```sh
python3 -m http.server 8772 --bind 127.0.0.1
```

Chrome 1440／768／390／320px × 三款 × 五校共 60 個版面狀態與鍵盤循環通過，操作範圍至少 44px，無水平溢出、缺圖或 runtime error。截圖在 `screenshots/`；驗證程式及 JSON 在 `output/playwright/campus-tab-framing/`。Safari／iOS 實機未測。
