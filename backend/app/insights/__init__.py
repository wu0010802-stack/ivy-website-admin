"""Google Search Console 與 CrUX 的後台唯讀查詢（docs/specs/2026-11-12-external-integrations-design.md §3、§4）。

不存資料庫：查到的結果只放程序記憶體（app/insights/cache.py）。外部請求的 User-Agent 只寫
`Mozilla/5.0 (compatible; ivy-website-<用途>/1.0)`，不帶帳號或信箱；金鑰與 Google 的回應內容不進網址、
log、例外訊息、API 回應。"""
