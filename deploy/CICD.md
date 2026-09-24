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

GitHub default branch 已於 2026-09-22 一併改為 `main`：PR 預設開向 `main`，Actions 的手動執行入口也以 `main` 上的 workflow 為準。`feature/website-admin` 保留為開發分支，未刪除。

## 第一次啟用

1. 檢閱並提交這次 CI/CD 檔案，先推到 `feature/website-admin`，確認 GitHub CI 全數成功。
2. 在 GitHub repo → Settings → Environments 建立 **production**（Railway 環境名，非分支名），Deployment branches 限制 **main**。
3. 在 Railway 官網 project → Settings → Tokens 建立 **production 環境專用 Project Token**。
4. 將 token 存入 GitHub **production environment secret**，名稱 **RAILWAY_TOKEN**。不要貼到聊天、repo、YAML 或 shell 命令參數。可使用 GitHub 網頁，或以下互動式命令（提示輸入時貼上）：

   ```sh
   gh secret set RAILWAY_TOKEN --repo wu0010802-stack/ivy-website-admin --env production
   ```

5. 核對目前 `main` 與線上的差異再啟用。**目前線上包含未提交快照；直接把 `main` 部署上去可能回退已上線的設計。** 先把要保留的正式內容整理成已核准的 commit，不要整批提交工作區。
6. 正式 DB 的 schema 由 API 啟動時自動 `alembic upgrade head`（2026-09-24 起，見下節）；CD 仍不會初始化 CMS 或建立帳號。
7. 確認 `main` 內容即為要上線的版本後推送（會觸發正式部署）：

   ```sh
   git push origin main
   ```

   啟用後每次 `git push origin main` 都會部署，沒有額外閘門。

這套流程使用 GitHub Actions 呼叫 Railway CLI，因此 Railway 服務不需另外綁 GitHub source；同時啟用原生 autodeploy 會造成重複部署。**2026-09-24 查到 api／web 仍綁著 GitHub repo**：`main` push 當下 Railway 就原生部署（不等 CI），CD 再部署一次。自動 migration 上線後，這代表 CI 還沒跑完，migration 就已套到正式 DB，需在 Railway 兩個服務的 Settings → Source 斷開 repo。

## 驗證與部署行為

- Node 22.23.2、Python 3.12、uv 0.8.22、Railway CLI 5.45.10；npm/uv 均遵循 lockfile，FastAPI 維持 0.136.1。
- CI 建立拋棄式 PostgreSQL 16 `ivy_website_test`，只在此 DB 執行 migration 與測試。YAML 的 `ci-only-*` 值僅用於此暫時環境。
- CD 使用 `git archive GITHUB_SHA`，只取 `web/ admin/ backend/ content/ contracts/ deploy/ .dockerignore`，排除 `.env*`、本機資料、依賴與建置產物。
- API/web 上傳同一份快照，`release.json` 記錄 `snapshot`、`base_commit`、`created_at`。hash 算法沿用原部署紀錄，排除 release 自己。
- API 容器降權後，啟動 uvicorn 前依序執行（`deploy/api-start.py`，手動 `railway up` 同樣適用）：
  1. `alembic upgrade head`：升到映像內的 migration head。所有待跑 revision 在**同一交易**，失敗或 90 秒逾時整批回滾；`backend/migrations/env.py` 先取 PostgreSQL advisory lock，重疊的部署排隊，後到者看到已是新版就不重跑。已在 head 時為 no-op，所以容器重啟也安全。
  2. `check_schema.py`：以 **read-only transaction** 核對 `alembic_version` 與映像內 head。DB 版本比映像新（回退舊版）、分歧或多 head 都會擋下。
  任一步失敗，候選 API 啟動失敗，CD 停止，web 不會接著部署。
- **api 掛著 `/data` volume，Railway 會先停舊容器再起新容器**：候選 API 啟動失敗時舊版不會留著服務，正式 API 直接停擺（2026-09-24 PR #9 實例：DB 未升級，19:23 起首頁 503）。所以 migration 本身出錯＝停站，務必先在 CI 與本機驗過。
- 每次只接受本次上傳回傳的 deployment ID 到達 `SUCCESS`；FAILED、CRASHED、SKIPPED、被移除或逾時皆使 job 失敗。
- `main` 同時只執行一條 pipeline，後續 push 不取消正在執行的部署。若 API 成功而 web 失敗，API 與 schema 都已更新，不能視為原子部署；發布版本需維持前後相容。
- 最後只用公開 GET 核對 release、production/live health、已發布 CMS、首頁、五校頁與後台登入入口。這不取代真實登入、預約、素材持久化或裝置驗收。

## 啟用後日常操作

在 `feature/**` 完成修改，開 PR 到 `main`；檢查通過且確認此次正式發布內容後合併。合併即部署，CD 會依序部署 API、web，Actions summary 記錄兩個 deployment ID。

失敗時先查看 Actions job 與 Railway API deploy logs（alembic 的 `Running upgrade` 與錯誤都在這裡）。migration 失敗時交易已回滾、DB 維持原版本，修正後以新 commit 推 `main`；上傳已發生時先核對 Railway 狀態，不要假設取消 job 已撤回部署。回退只能選**映像內認得目前 DB revision** 的版本（通常是往前修），不能退到 migration 之前的 commit——舊映像的 upgrade／核對會失敗而停站；不自動 downgrade。

### 撰寫 migration 的規則（自動套用後）

- 合併進 `main` 就會在正式 DB 執行，PR 審查要把 migration 當正式資料變更看。
- 與上一版程式相容（先加欄位／表、之後的版本再移除舊的），因為 API 成功 web 失敗、或回退時，新 schema 都已生效。
- 刪欄位、刪表、改寫或封存既有資料的 migration，合併前先手動備份正式 DB（Railway Postgres 的 PITR 目前**未開**，沒有自動備份）。
- 要在 90 秒內跑完（Railway healthcheck 120 秒）。大表回填、`CREATE INDEX CONCURRENTLY` 這類不能放進單一交易或會超時的，改用手動流程另外執行。

本機工具驗證：

```sh
python3 -m unittest discover -s deploy/tests -v
actionlint .github/workflows/website.yml
```

2026-09-24 自動 migration：本機 13 項工具測試通過；本機 PostgreSQL 14 拋棄式 DB 從 base 升到正式當時的 `c6e4a2b9d810` 後，兩個 `alembic upgrade head` 同時跑，一個執行 `d3a8f1c5b742`、一個排隊後 no-op；另以 psql 先占住 advisory lock，upgrade 等 8 秒釋放後才執行；`check_schema.py` 核對 `d3a8f1c5b742` 通過；在 head 重跑為 no-op。本機沒有 Docker，容器內實跑要看推上 `main` 後的 Railway API log。

2026-09-22 本機已通過 12 項工具測試、actionlint 1.7.12、實際 Git HEAD 快照雜湊核對、專用 PostgreSQL 測試庫的 read-only schema 查核、現有正式站公開 GET smoke。尚未發布 workflow，未執行 GitHub runner 的完整 CI，也未部署本次候選程式；本機沒有 Docker，未驗證容器建置與容器啟動。（2026-09-24 註：之後已啟用，部署分支改為 `main`，實際 CI 部署紀錄見 `deploy/README.md`。）

參考：[Railway CLI 部署與 Project Token](https://docs.railway.com/cli/deploying)。`railway up --detach` 僅代表上傳完成，所以工具另行輪詢精確 deployment ID。
