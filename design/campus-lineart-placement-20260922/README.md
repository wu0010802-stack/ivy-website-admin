# 分校建築線稿位置比較

2026-09-22，使用者要求先看 mock-up，尚未選定或整合正式 Nuxt。

- A「校名小線稿」：各校名稱上方各放一張縮小線稿，移入／選取時框線沿建築外緣顯示，各校輪廓獨立。取消矩形底色、整列直線與選取底線。桌機線稿框寬 120px，手機 49–62px，維持原圖 3:2 比例。
- B「右上角線稿」：當前校區線稿放在分校資訊區塊右上角，切校時同步更新。桌機線稿框 210 × 140px；手機 92–108 × 68–76px，雙語標題上下排列以留出空間。
- 素材沿用 `web/public/assets/campus-line-art-{key}.webp`。以 CSS grayscale、brightness、contrast 及 multiply 融合原有米白底，沒有修改原圖。
- 基礎樣式快照來自 2026-09-22 當前 `CampusBoard.vue`，資料讀取 `web/server/data/site-fixture.json`，保留五校照片、聯絡資訊及缺 LINE 的「待園方提供」。

預覽入口：

- 比較頁：http://127.0.0.1:8772/design/campus-lineart-placement-20260922/
- A：http://127.0.0.1:8772/design/campus-lineart-placement-20260922/preview.html?layout=a
- B：http://127.0.0.1:8772/design/campus-lineart-placement-20260922/preview.html?layout=b

可附加 `&campus=yihua` 等 campus key；`&capture=1` 隱藏比稿導覽與頁尾。預設明華校、輪播暫停，點播放即可輪播，切校支援點選、鍵盤與左右滑動。

若需重開服務，在 repo 根目錄執行：

```sh
python3 -m http.server 8772 --bind 127.0.0.1
```

驗證：Chrome 1440／768／390／320px × 兩款 × 五校共 40 個版面狀態，檢查線稿對應、選取與面板語意、至少 44px 操作範圍、字型載入、鍵盤循環、圖片載入與水平溢出；零 runtime error。原型 `node --check app.js`、`python3 package_preview.py` 通過，凍結 `preview.html` 無差異。Safari／iOS 實機未測。

截圖保留在 `screenshots/`；檢查腳本與 JSON 在 `output/playwright/campus-lineart-placement/`。獨立 mock-up，不修改 `web/` 或凍結原型，未 commit、push 或部署。

## 13:11 截圖回饋：A 按鈕建築輪廓

新增 `building-outlines.js`，以原圖 1536 × 1024 座標手工描出各校主要建築外緣，SVG 疊加在原線稿上，`vector-effect=non-scaling-stroke` 維持框線粗細。原始點陣圖不修改；線稿與框線同尺寸縮放。保留 tab 語意、鍵盤焦點與高對比模式可辨識的選取框。

**後續裁定**：使用者否決 A 的建築輪廓框線版本。新的三款想法在 `../campus-tab-framing-20260922/`，本目錄保留比稿紀錄，非待整合定案。
