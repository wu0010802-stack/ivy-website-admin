# 五校入口版型 mock-up（2026-09-16）

首頁「五校介紹」區塊依設計回饋重排的 mock-up，發佈為 Claude Design 畫布（連結見 repo README／記憶）。

- `build.mjs`：唯一要改的來源；`node build.mjs` 產生五張 artboard（`*.dc.html`）與 `canvas.json`。
  色票、字級、間距直接取自 `styles.css`／`studio.css` 的 token；LINE Seed TW 700 子集內嵌成 data URI。
- `*.jpg`：五校照片裁成 4:3（640×480、≤70KB），裁切位置逐張定：義華偏右 58%、國際偏左 48%、其餘置中。
  重裁指令在對話紀錄（PIL crop → JPEG）。
- 地圖為五校位置示意，座標取 `../campus-directions/map-data.js`；站內實作仍可沿用 Google 單校嵌入。
- 重新產畫布：改 `build.mjs` → `node build.mjs` → 用 design skill 的 `seed-canvas.mjs` 重新 seed 後更新同一個 artifact。

畫布分三頁：第一頁是首版五校目錄 mock-up（09-16 下午已依回饋上站：拿掉展開列與校名箭頭），第二頁是「分校輪播」提案，第三頁是使用者選定桌機 A 後的 UI/UX 探索（開啟時落在第三頁）。

Artboards（第一頁）：
| 檔案 | 內容 | 尺寸 |
|---|---|---|
| `Main.dc.html` | 桌機・五校目錄（聯絡區收合） | 1440×700 |
| `DesktopExpanded.dc.html` | 桌機・展開校區位置與聯絡資訊 | 1440×1200 |
| `Mobile.dc.html` | 手機・五列目錄 | 390×980 |
| `MobileExpanded.dc.html` | 手機・展開聯絡區 | 390×1620 |
| `States.dc.html` | 入口 hover／focus、校區選單、展開列兩態 | 960×680 |

Artboards（第二頁・分校輪播提案，2026-09-16 下午）：
| 檔案 | 內容 | 尺寸 |
|---|---|---|
| `CarouselDesktop.dc.html` | 桌機 A：置中標題、校名 chip 選校、左大照片＋01/05 與上一／下一校、右示意地圖＋分校資訊＋預約＋社群 | 1440×1080 |
| `CarouselThumbs.dc.html` | 桌機 B：同上，但用五校縮圖當選擇器 | 1440×1120 |
| `CarouselMobile.dc.html` | 手機：chip 折兩行，照片→進度→資訊→預約→社群→地圖直排 | 390×1460 |

圖示改為直接讀 `../../index.html` 的 sprite（Phosphor＋LINE／Facebook），不再手抄路徑。

Artboards（第三頁・桌機 A 的 UI/UX 探索，2026-09-16 下午）：
| 檔案 | 內容 | 尺寸 |
|---|---|---|
| `ExploreA1.dc.html` | A1 資訊優先：標題靠左＋右引言（全站標準）、chip 帶地區、右欄校名→地址電話→預約＋認識Ｘ校→社群→200px 小地圖、照片圖說用校區介紹句、上一／下一校在圖說列 | 1440×1040 |
| `ExploreA2.dc.html` | A2 草圖順序：標題置中、← chip →、右欄地圖在上 | 1440×1120 |
| `ExploreA3.dc.html` | A3 依地區選校：四個地區小標分組 chip | 1440×1080 |
| `ExploreStates.dc.html` | chip 四態、上一／下一校、切換行為（tab 鍵盤、200ms 淡入淡出、aria-live、不自動輪播） | 960×470 |

三個變體共用的修正寫在畫布便利貼「桌機 A 的 UI/UX 修正」；200px 小地圖改用 viewBox `80 205 480 200`，避免最南的義華校圖釘被裁。
