# 給 Claude：官網招生分析實作交接

日期：2026-09-30（2026-10-01 更新：原階段 2 改由入學規格處理；配合家長自選場次上線調整規則）  
需求報告：[官網招生分析擴充報告與實作需求](../analysis/2026-09-30-enrollment-analytics-report.md)

將下面內容貼給 Claude。報告已包含現況、資料口徑、階段 1 與階段 3 的任務、檔案定位與驗收矩陣；不必重做一般性的功能提案。

```text
請在 /Users/yilunwu/Desktop/ivy-website-admin 實作官網招生分析擴充。

先完整閱讀：
1. CLAUDE.md 及相關子目錄規則。
2. docs/analysis/2026-09-30-enrollment-analytics-report.md。

目標：讓 /admin/analytics 能支援五校招生判斷：五校預約比較、待處理、需求年齡／班別、流量趨勢，之後再補 UTM 與表單成效。入學結果、名額與流失原因不在本任務，改由 docs/specs/2026-09-30-website-admissions-design.md（招生入學頁）處理。

依報告階段 1 → 3 執行（原階段 2 已由入學規格取代，不做）。本 session 先完成階段 1 的程式、相關測試與桌機／手機驗證；若先前已有已驗收的階段，從最早尚未完成的階段接續。一次 session 只執行一個階段。驗收結果記在 docs/website-admin/acceptance.md 的「招生分析階段 1」一節。請直接進行已界定工作的實作，不要只回覆提案或反覆詢問是否要開始；只有實際影響指標含義且報告無法決定的業務規則，才集中提出具體問題。

開工先確認 git status、HEAD、最新 origin/main 與線上 /release.json。feature/website-admin 工作樹較舊，且有大量使用者未提交修改；不可依它重做已上線的日期、來源或流量功能。從 origin/main 開新 worktree（磁碟小，用 sparse checkout），保留其他工作。

實作不可違反：
- completed 只代表已到場，不代表入學。
- 2026-10-01 起官網送單即 confirmed，並同時記 request_created 與 visit_confirmed：確認率恆為 100%，跨 10-01 的期間不可混算（報告 2.3、3.2）。
- 沒有「待聯絡」階段；待處理只有報告 3.4 的三種，定義與 status_groups／總覽共用，不另抄。
- 參觀 capacity 是接待家庭組數，不是招生名額。
- admission-classes.ts 的 ClassStatus=enrolled 是年齡分類，不是真實入學。
- 事件發生期的量與同批建立案件的轉換率分開計算。
- 不假造入學結果、招生目標或個別訪客數。
- 所有報表在後端落實 capability 與校區 scope；analytics.read 不等於可讀個資或匯出。
- 不把電話相同的兄弟姊妹自動去重，不把取消或未到自動判成流失。
- 不連園務系統 DB，不改凍結原型，不升級已釘版 FastAPI。

依報告第 7 節完成當階段驗收，第 8 節執行適合變更的實際驗證。Node 用 22；機器只有 8GB，測試序列執行。用合成資料與隔離測試 DB，不送正式表單、不發真實通知。API 變更需同步 OpenAPI／產生型別與 contract check。

完成後回報：
1. 本階段完成範圍與新增畫面。
2. 指標公式、篩選口徑與未知資料如何呈現。
3. 修改檔案與本機預覽方式。
4. 實際跑過的測試／建置／桌機手機驗證及結果。
5. 尚未驗證或未完成事項、下一階段入口。

先停在可本機驗收的成果。未另獲我要求，不 commit、push、部署、執行正式 migration 或修改正式資料；main 的 push 會觸發正式部署。
```

後續 session 的接續語句：

```text
繼續依 docs/analysis/2026-09-30-enrollment-analytics-report.md 實作下一個尚未完成的階段。先讀上一階段的驗收與 Git 現況，保留已完成成果及他人變更。仍只做本機實作與驗證，不 commit／push／部署或執行正式 migration。
```
