# 更多網站轉場探索（2026-09-22，未整合）

2026-09-22 後續裁定：使用者選定 E，已整合到 Nuxt `web/app/components/HomeNewsTransition.vue`；本目錄保留原始四版比較。正式實作／驗證與手機差異見根目錄 README、DESIGN.md 與 `output/playwright/news-paper-e/`。

使用者希望在前一輪 A／B／C 之外，尋找其他真實網站的設計。此頁整理六個來源、四個新方向，並製作相同 News 內容下的互動示意。

比較頁：`http://127.0.0.1:8765/design/news-transition-explore-20260922/`

## 來源與轉化

| 方向 | 來源 | 實際證據 | 常春藤提案 |
|---|---|---|---|
| D 留白展幅 | [Motto](https://wearemotto.com/) | 本次 Chrome 實際捲動，看見影像窗逐漸放大，保留前後截圖 | 校園影像從小窗展開，交接完整 News；霧藍底 |
| E 紙頁覆疊 | [TrueKind](https://truekindskincare.com/) | 本次實站截圖＋[原作者案例](https://tympanus.net/codrops/2025/06/25/designing-truekind-a-skincare-brands-journey-through-moodboards-motion-and-meaning/) 的柔和分層揭露 | 圓角紙頁向上覆疊，前段後退，暖白轉霧藍；紙頁為本次轉化，非原站效果名稱 |
| F 照片取色 | [Guggenheim](https://www.guggenheim.org/) | [Cotton 2025 官方案例](https://www.linkedin.com/posts/cottondesigninc_when-the-guggenheim-museum-rebranded-at-the-activity-7293306937058680832-VTSa) 描述從滾動作品擷取顏色的動態漸層。本次現行首頁較簡潔，沒有重現完整舊效果 | 從既有果樹／陽光／天空照片手動配出淡綠、米黃、霧藍色場；沒有 CMS 自動取色 |
| G 照片接棒 | [Join Talent](https://jointalent.net/) | 本次 Chrome 實際看到一張肖像展開成多人列，並有[製作團隊 KIJO 案例](https://kijo.co.uk/web-design/join-talent/) | 三張消息照片由聚合展開到各欄位，活動與文字接續出現；灰綠底 |

延伸來源：

- [Sweet Home Sweet 原製作團隊案例](https://bravenew.agency/case-study/sweet-home-sweet/)：用色彩、形狀、影像分章，縱向／橫向交接。僅依作者案例，未宣稱本次親自操作實站動畫。
- [Moooi Paper Play 原團隊訪談](https://www.webbyawards.com/crafted-with-code/moooi-paper-play/)：歷史活動以紙材與劇場逐幕作敘事。未宣稱歷史活動入口目前仍可互動。

同輪曾初查 Koto／Locomotive；沒有選入本次四個主要方向，也沒有以未確認效果做結論。

## 邊界與用法

- 所有新檔在此獨立目錄；沿用前一輪 `../news-transition-20260922/stage.css` 的 News 版面與控制列，沒有修改前輪三版、Nuxt／CMS／部署。
- `stage.html?direction=d|e|f|g` 為全螢幕互動；`p=0..1` 可指定起始進度；`motion=fallback` 可切到 JS 備援。
- 保留前輪 CSS 原生 scroll timeline／passive scroll+rAF 備援、重播與手動中止、拉桿、減少動態、高對比與 dialog。
- 原站截圖只做研究參考，不套用到常春藤正式內容。研究截圖位於 `references/`，來源與是否歷史案例在比較頁逐項標示。
- 常春藤動態示意皆使用現有校園照片與 News 範例。前段深綠為使用者截圖情境，沒有更改現行五校設計。
- 主要閱讀字體沿用前輪；新研究頁標題使用系統繁中字體，避免新增 LINE Seed 子集缺字。

## 驗證

自動檢查腳本：`node output/playwright/news-transition-explore/check.cjs`。檢查報告及桌機／手機截圖在 `output/playwright/news-transition-explore/`。

獨立 headless Chrome 驗證完成：四尺寸 320／390／768／1440px × 四方向 × 開始、半途、完成、反向四進度，共 64 狀態；JS 備援 12 狀態、比較頁 16 狀態及四版減少動態皆通過，無水平溢出、圖片載入問題或 JavaScript runtime error。原生 timeline 以進度到位後取樣，避免固定 100ms 等待造成偶發過早取樣。已檢視四版桌機轉場截圖、手機完成版與研究比較頁。

環境紀錄：共用 Chrome 背景分頁曾使 compositor 截圖逾時、原生 timeline 反向取樣暫停；切到前景即可恢復。正式驗證採獨立 headless Chrome，避免干擾其他使用者工作。

未做 Nuxt 主站整合、Safari／Firefox 或 iOS 實機驗收。
