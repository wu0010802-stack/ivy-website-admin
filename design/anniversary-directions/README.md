# 頁首品牌 30 週年版：三個方向（2026-09-18）— 待拍板

1997 年創校，2027 滿 30 年。校徽是 PNG，週年記號只能掛在字標旁邊。三個方向都直接跑在主站真實頁首上，用 `index.html?anni=a|b|c#/home` 切換；改動收在 `studio.css` 末段的比稿區塊與 `app.js` 開頭的 `?anni=` 區塊，**預設行為沒有改**。

## 開啟

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

- 比較頁：<http://127.0.0.1:8770/design/anniversary-directions/>
- 單版：`index.html?anni=a#/home`（a／b／c；不帶參數是現況）
- 截圖：`node shoot.cjs`（用 npx 快取的 playwright-core＋系統 Chrome，輸出 `shots/`）

## 共同規則

- 金色只用站內既有的 `--gold`；壓在首屏影片上走鏤空描邊，捲動後與分校頁的淺底改實心金＋深綠字。
- 「30」用 LINE Seed Bold（`--font-head`，ASCII 在 `chars-bd.txt` 子集裡），「週年」用 Noto Sans TC 600；後者不在品牌子集裡，另切 `assets/fonts/noto-sans-tc-600-anni.woff`（1.8 KB，`unicode-range:U+5E74,U+9031`），`package_preview.py` 已一併內嵌。
- 收合後的膠囊三版共用：白圓徽章右下角一顆金色「30」小點（`.anni-dot`）。手機頁首 a／c 放不下，也退成同一顆小點；b 保留「30 週年」。
- `.brand` 的 aria-label 加上「創校 30 週年」，記號本身 `aria-hidden`。

## 三個方向

| | 做法 | 取捨 |
|---|---|---|
| **a** | 印章：校徽等高的圓，「30」大字＋「週年」小字，掛在字標右側 | ＋最像紀念章、30 是主角<br>−品牌區 280→350px，變成三件東西並排；手機退成小點 |
| **b** | 第三行：英文行底下「30 週年 ── 1997–2027」，與上兩行同欄 | ＋最安靜、唯一寫出年份、寬度不變、手機留得住<br>−字標 60→77px 高，三行密；金色細字在影片亮幀上弱 |
| **c** | 上標小籤：掛在中文校名右上角（® 的位置），實心金底 | ＋最省空間、字標不動、活動結束撕掉最不痛<br>−最不慶祝、遠看只是小黃點；900px 以下退成小點 |

定案後把選中的那組併進 `studio.css` 的 header 段落，DOM 改寫進 `index.html`，其餘連同 `?anni=` 參數一起刪掉。
