# Railway CI/CD Implementation Plan

**Goal:** GitHub Actions 驗證官網程式；推送 `production` 後部署同一個 commit 的 API 與 web。

**Architecture:** PR、開發分支和 production 共用 CI。部署 job 依賴所有檢查，使用 production environment secret、固定 Railway project/service ID、Git 允許路徑快照與 release hash。API 容器啟動前唯讀核對正式資料庫 revision，再依序等待 API/web 的指定 deployment SUCCESS，最後核對公開 release 與 health。

**Tech Stack:** GitHub Actions、Node 22.23.2、Python 3.12、uv 0.8.22、PostgreSQL 16、Railway CLI 5.45.10。

**Spec:** 本次使用者要求建立 CI/CD；部署範圍依 `deploy/README.md`。`production` 為未收到分支偏好回覆時的預設。

## Constraints

- 僅官網獨立 Railway project；API/web 既有設定與 DB 分離。
- FastAPI 維持 0.136.1；依 lockfile 安裝。
- 只上傳已提交的允許路徑，排除 `.env*`、依賴、建置產物及本機資料。
- 正式 migration、CMS 寫入、使用者初始化不放入 CD。
- 保留使用者所有未提交工作；本輪先建立可檢閱設定，不自動提交或發布。

## Tasks

- [x] 建立 `deploy/tests/test_railway_ci.py` 與 `test_schema_guard.py`：用暫存 Git repo 驗證快照隔離，用 stub 驗證 deployment ID、失敗停止與 schema 不一致阻擋。
- [x] 建立 `deploy/railway_ci.py`：`prepare` 產生快照，`deploy` 上傳／等待／公開 GET 驗證；只用 Python 標準函式庫。
- [x] 建立 `deploy/check_schema.py`，由 `api-start.py` 在降權後、uvicorn 啟動前執行；Dockerfile 納入工具。核對使用 read-only transaction，不需 CI SSH key。
- [x] 建立 `.github/workflows/website.yml`：web/admin 型別測試建置、真 PostgreSQL backend tests、contract check、production-only CD。
- [x] 建立 `deploy/CICD.md`，在 README 與部署入口加入連結，列出 secret 設定與 branch 啟用指令。
- [x] 執行 `python3 -m unittest discover -s deploy/tests -v`、actionlint、`node --check app.js`、`python3 package_preview.py`，檢查差異。
- [x] 整理本機驗證與尚待發布／token 設定；未實際 GitHub run 或 Railway deploy 不宣稱已啟用。

## 驗證紀錄

- 12 項部署／schema guard 測試通過，actionlint 1.7.12 通過；涵蓋暫時網路失敗重試與持續失敗中止。
- 實際 HEAD 快照 354 檔，hash 可重現，未納入環境檔。
- 對 `ivy_website_visit_details_test` 執行 guard，唯讀核對 `8cf3e2b5a641` 成功；未執行 migration／寫入。
- 原型語法與打包通過，`preview.html` 無差異。
- 公開正式站 smoke 通過：release、production/live health、已發布 CMS、首頁、五校頁、後台入口。首次 TLS handshake 逾時後增加有限重試，重跑通過；此為既有線上版本的工具驗證，沒有部署候選程式。
- GitHub 目前沒有 environment 或 repo secret，production branch 尚未建立；仍待發布設定與指定正式版基底。（2026-09-24 註：之後已啟用，部署分支改為 `main`，見 `deploy/CICD.md`。）
- 未執行 GitHub runner 上的完整 CI 或正式部署；本機 Docker 不可用，磁碟剩約 381 MiB，本輪未額外重建完整應用。
- 範圍限定的獨立 code review 未發現阻擋或重要缺陷；不取代 GitHub CI／Docker／首次自動部署驗證。
