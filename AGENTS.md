# AGENTS.md

> **本檔不承載規則，單一權威來源是同目錄的 [`CLAUDE.md`](./CLAUDE.md)。** 任何 agent（Codex、Claude Code、其他 AI 工具）在本 repo 工作前，請完整讀取並遵循 `CLAUDE.md`；全域規則見 `~/.claude/CLAUDE.md`。

三件開工前一定要看的事（細節都在 `CLAUDE.md`）：

1. 本 repo 有大量**未提交的設計修改，全部是使用者工作**——不 reset／stash／clean，不 `git add .`。
2. 改任何原始檔後必跑 `node --check app.js` → `python3 package_preview.py`，`preview.html` 刻意進版控。
3. 官網後台任務（web/ admin/ backend/）尚未開工，技術棧以 `docs/specs/2026-09-19-website-admin.md`（v2、Nuxt 前台）為準，計畫與 handoff 已同步 v2。

本 repo 與園務系統三個 repo（ivy-backend／ivy-frontend／ivyManageSystem）無程式關聯，勿混用其規則。
