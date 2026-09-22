# GitHub Actions → Railway

此設定僅用於 `wu0010802-stack/ivy-website-admin` 與官網的獨立 Railway production，服務 ID 固定在 `deploy/railway_ci.py`。

## 分支與觸發

| 事件 | CI | 正式部署 |
| --- | --- | --- |
| 任意 PR | web/admin 型別、測試、建置；backend 真 PostgreSQL 測試；API 契約檢查 | 不部署 |
| push `feature/**`、`production` | 同上 | 不部署 |
| push `main` | 同上 | 全部成功才部署 |
| 手動 Run workflow | 同上 | 只在選擇 `main` 時部署 |

Workflow：`.github/workflows/website.yml`。**部署分支為 `main`（2026-09-22 起，原為 `production`）**：每次成功推上 `main` 都會在 CI 全綠後部署正式站，`main` 不再是單純的整合分支。不想立即上線的工作留在 `feature/**`，確認要發布時才併進 `main`。

目前 GitHub default branch 仍為 `feature/website-admin`；workflow 要先存在於該分支，Actions 才會顯示手動執行入口。

## 第一次啟用

1. 檢閱並提交這次 CI/CD 檔案，先推到 `feature/website-admin`，確認 GitHub CI 全數成功。
2. 在 GitHub repo → Settings → Environments 建立 **production**（Railway 環境名，非分支名），Deployment branches 限制 **main**。
3. 在 Railway 官網 project → Settings → Tokens 建立 **production 環境專用 Project Token**。
4. 將 token 存入 GitHub **production environment secret**，名稱 **RAILWAY_TOKEN**。不要貼到聊天、repo、YAML 或 shell 命令參數。可使用 GitHub 網頁，或以下互動式命令（提示輸入時貼上）：

   ```sh
   gh secret set RAILWAY_TOKEN --repo wu0010802-stack/ivy-website-admin --env production
   ```

5. 核對目前 `main` 與線上的差異再啟用。**目前線上包含未提交快照；直接把 `main` 部署上去可能回退已上線的設計。** 先把要保留的正式內容整理成已核准的 commit，不要整批提交工作區。
6. 正式 DB 必須已完成該版本需要的 migration。由已核准的 migration 工作另行執行；CD 不會自動 upgrade、初始化 CMS 或建立帳號。
7. 確認 `main` 內容即為要上線的版本後推送（會觸發正式部署）：

   ```sh
   git push origin main
   ```

   啟用後每次 `git push origin main` 都會部署，沒有額外閘門。

這套流程使用 GitHub Actions 呼叫 Railway CLI，因此 Railway 服務不需另外綁 GitHub source；同時啟用原生 autodeploy 會造成重複部署。

## 驗證與部署行為

- Node 22.23.2、Python 3.12、uv 0.8.22、Railway CLI 5.45.10；npm/uv 均遵循 lockfile，FastAPI 維持 0.136.1。
- CI 建立拋棄式 PostgreSQL 16 `ivy_website_test`，只在此 DB 執行 migration 與測試。YAML 的 `ci-only-*` 值僅用於此暫時環境。
- CD 使用 `git archive GITHUB_SHA`，只取 `web/ admin/ backend/ content/ contracts/ deploy/ .dockerignore`，排除 `.env*`、本機資料、依賴與建置產物。
- API/web 上傳同一份快照，`release.json` 記錄 `snapshot`、`base_commit`、`created_at`。hash 算法沿用原部署紀錄，排除 release 自己。
- API 容器降權後，在啟動 uvicorn 前以 **read-only transaction** 核對 `alembic_version` 與映像內 migration head。不同、未初始化或多 head 會使候選 API 啟動失敗，CD 停止，web 不會接著部署。此檢查不執行 migration；日後手動部署同樣適用。
- 每次只接受本次上傳回傳的 deployment ID 到達 `SUCCESS`；FAILED、CRASHED、SKIPPED、被移除或逾時皆使 job 失敗。
- `main` 同時只執行一條 pipeline，後續 push 不取消正在執行的部署。若 API 成功而 web 失敗，API 已更新，不能視為原子部署；發布版本需維持前後相容。
- 最後只用公開 GET 核對 release、production/live health、已發布 CMS、首頁、五校頁與後台登入入口。這不取代真實登入、預約、素材持久化或裝置驗收。

## 啟用後日常操作

在 `feature/**` 完成修改，開 PR 到 `main`；檢查通過且確認此次正式發布內容後合併。合併即部署，CD 會依序部署 API、web，Actions summary 記錄兩個 deployment ID。

失敗時先查看 Actions job 與 Railway logs。schema 不一致需先完成已核准 migration 再重跑；上傳已發生時先核對 Railway 狀態，不要假設取消 job 已撤回部署。回退需選擇與目前 DB 相容的既有版本，核准後以新 commit 推送 `main`。

本機工具驗證：

```sh
python3 -m unittest discover -s deploy/tests -v
actionlint .github/workflows/website.yml
```

2026-09-22 本機已通過 12 項工具測試、actionlint 1.7.12、實際 Git HEAD 快照雜湊核對、專用 PostgreSQL 測試庫的 read-only schema 查核、現有正式站公開 GET smoke。尚未發布 workflow，未執行 GitHub runner 的完整 CI，也未部署本次候選程式；本機沒有 Docker，未驗證容器建置與容器啟動。

參考：[Railway CLI 部署與 Project Token](https://docs.railway.com/cli/deploying)。`railway up --detach` 僅代表上傳完成，所以工具另行輪詢精確 deployment ID。
