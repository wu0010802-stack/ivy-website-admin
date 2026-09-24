# AGENTS.md

> **本檔不承載規則，單一權威來源是同目錄的 [`CLAUDE.md`](./CLAUDE.md)。** 任何 agent（Codex、Claude Code、其他 AI 工具）在本 repo 工作前，請完整讀取並遵循 `CLAUDE.md`；全域規則見 `~/.claude/CLAUDE.md`。

三件開工前一定要看的事（細節都在 `CLAUDE.md`）：

1. 本 repo 有大量**未提交的設計修改，全部是使用者工作**——不 reset／stash／clean，不 `git add .`。
2. 根目錄 vanilla 原型已凍結，設計迭代在 `web/`；改完要跑的驗證見 `CLAUDE.md`「每次改版必做的流程」。
3. 官網後台（web/ admin/ backend/）已上線 Railway，`main` 的 push 會觸發正式部署，未經要求不 push；進度見 `docs/website-admin/acceptance.md`。

本 repo 與園務系統三個 repo（ivy-backend／ivy-frontend／ivyManageSystem）無程式關聯，勿混用其規則。
