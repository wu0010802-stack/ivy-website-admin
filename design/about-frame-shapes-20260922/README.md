# 關於常春藤：外框形狀探索

2026-09-22，延續前輪三種構圖 mock-up，依使用者要求進一步比較外框形狀。這次只建立獨立比稿，尚未選定或套用官網。

預覽：`http://127.0.0.1:8784/design/about-frame-shapes-20260922/`

- A 大圓角：四角均衡圓潤，保留方形照片感。
- B 拱形窗：上方拱形、下方平底小圓角；小照片採膠囊形。
- C 對角圓弧：兩個對角加大弧線，小照片反向呼應。
- D 鵝卵石：不對稱的自然曲線，主副照片均採有機輪廓。

四款共用相同照片、薄荷綠底色、米白框、主副圖尺寸與交疊位置。各款可切換完整區塊和照片細節；手機保留雙照片，介紹可展開。

沿用 `../about-photo-three-20260922/mockup.css` 的共同比稿樣式和 `about.json` 文案快照。原圖直接讀取 `web/public/assets/about-curious.webp` 與 `learning.webp`，未重建或修改影像內容。

若預覽 server 未開啟，在 repo 根目錄執行 `python3 -m http.server 8784 --bind 127.0.0.1`。

驗證與截圖存於 `output/playwright/about-frame-shapes-20260922/`。

- Chrome 320／390／768／1024／1440／1920px × 四款，共 24 個版面檢查通過。
- 比較頁另驗證 1800／1024／390px；無水平溢出、破圖、runtime error 或圖說遮住小照片。
- 四款切換、完整區塊／照片細節切換、比較頁連結及手機介紹展開收合通過。
- 共 15 張截圖：比較頁三尺寸、四款桌機／手機，以及各款照片細節。
- 人工檢視比較頁與桌機／手機截圖；主要人物表情及指向動作可辨識，曲線會減少周邊背景與其他人物露出的範圍。
- `node --check design/about-frame-shapes-20260922/shapes.js`、`node --check app.js` 與 `python3 package_preview.py` 通過。凍結原型重打包前後 SHA-256 相同。
- 尚未做 Safari／iOS 實機驗證。
