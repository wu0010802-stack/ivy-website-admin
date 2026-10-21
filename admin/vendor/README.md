# admin/vendor

## xlsx-0.20.3.tgz（SheetJS Community Edition）

後台「匯入歷年註冊」在瀏覽器讀園方的 `.xls`（BIFF8）統計表，用的是 SheetJS。

| 項目 | 內容 |
|---|---|
| 來源 | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| 版本 | 0.20.3 |
| SHA-256 | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` |
| 安裝 | `admin/package.json` 的 `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`；`package-lock.json` 的 `integrity` 另記 sha512 |

### 為什麼不用 npm 上的 `xlsx`

SheetJS 不再更新 npm registry，registry 上最新是 0.18.5，有已公開的弱點：
CVE-2023-30533（原型污染）、CVE-2024-22363（ReDoS）。修正版只放在 SheetJS 自己的 CDN，
所以把官方 tarball 放進 repo、由 `package.json` 指向它。

### 更新或重放

1. 從來源網址下載（需要瀏覽器 User-Agent：`curl -sS -A 'Mozilla/5.0' -o admin/vendor/xlsx-<版本>.tgz <網址>`）。
2. `shasum -a 256` 對照 SheetJS 公布的雜湊或兩次獨立下載比對，再更新上表。
3. 在 `admin/` 跑 `npm install --save ./vendor/xlsx-<版本>.tgz`，刪掉舊的 tgz。
4. `deploy/web.Dockerfile` 在 `npm ci` 之前先 `COPY admin/vendor ./admin/vendor`（`file:` 相依要在 `npm ci` 時就讀得到檔案）。

### 只能用套件入口 `xlsx.mjs`

程式一律 `import('xlsx')`（套件入口 `xlsx.mjs`），不要改成 `dist/` 底下的獨立檔。
2026-10-21 實測：`dist/xlsx.mini.min.js` 讀不了 XLS（`parse_xlscfb is not defined`），
`dist/xlsx.core.min.js` 在 Node 載入就失敗，只有套件入口讀得到 xlwt／SheetJS 寫出的 BIFF8。
實作在 `admin/src/admissions/imports/historyWorkbook.ts`，用動態 import，
所以 SheetJS 在獨立的 chunk（約 490 kB、gzip 約 160 kB），只有進入匯入頁才會下載。
