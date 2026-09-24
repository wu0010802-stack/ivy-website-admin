# Google OAuth 合併整合計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將既有 Google OAuth 工作整合至最新 main，完成可審查的獨立提交及部署前驗證。

**Architecture:** 保留 main 的安全修正，僅移入 OAuth 所需後端、admin、代理、契約與文件。保留已存在的兩條 migration 歷史，以無 schema 操作的 merge revision 收斂為唯一 head。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy、Alembic、PostgreSQL、Authlib；Vue 3 admin、Nuxt web；Node 22。

**Spec:** `deploy/google-oauth.md` 及使用者核准的 2026-09-24 合併前置清單。

## Global Constraints

- 使用隔離 checkout；不修改來源工作樹、其他設計修改或正式 DB。
- 只允許已啟用的既有管理員；Google 登入不註冊、不改角色、校區或密碼。
- Secret 只由 API 環境變數注入；未設定 Google 時帳密登入正常。
- 正式 migration 需另行核准；main push 會自動部署，完成候選前不 push main。
- 同時僅跑一組重型測試；pytest 指向本次專用且名稱含 test 的 PostgreSQL。

## Review Focus

- 合併 migration 後必須只有一個 head；既有流量資料表保留。
- Google OAuth 的 302/303、多個 Set-Cookie 不被代理吞掉；來源 IP 與 request body 防護保留。
- 無 Google 設定、取消、失敗或無權限帳號仍能回到帳密登入。
- 登入表單保留 main 的 Email 驗證；Enter／連續提交只發一次請求。
- Google claims、既有權限、session/CSRF 和停權行為須通過整合測試。

## Task 1: 整合與回歸

- [x] 將 OAuth 測試及原始 migration 移至隔離 main；驗證雙 head 與代理 OAuth 回歸為紅。
- [x] 以 main 為基底三方套用 OAuth 變更；保留 `BodySizeLimitMiddleware`、`trustedClientIp`、`streamRequest`、Email 格式檢查。
- [x] 新增 merge revision，`down_revision = ("b7d2e4f1a903", "b7930d2f6a10")`；upgrade/downgrade 無 schema 操作。
- [x] 更新代理測試以使用 main 的真實 IP helper，補上登入單次提交及 Email 驗證。
- [x] 更新設定／部署文件並由整合後的 app 重新產生 OpenAPI 與 TypeScript contract。

## Task 2: 候選驗證

- [x] 建立本次獨立 PostgreSQL；驗證 migration、schema guard、backend 全套測試。
- [x] Node 22 執行 admin/web 的 typecheck、unit tests、build；執行 contract check 與 deploy tests。
- [x] 執行 `node --check app.js`、`python3 package_preview.py`、`git diff --check`。
- [x] 瀏覽器驗證正式 build 的 admin 登入備援、Google 入口及錯誤提示。
- [x] 完成獨立程式審查、確認來源工作樹雜湊未變，僅提交本次精確路徑。

## Task 3: 正式切換準備

- [x] 記錄候選 commit、migration head、測試證據與可執行的正式 DB 備份／migration／部署順序。
- [ ] 正式 DB migration、push main 與真人 Google 登入由後續明確授權／Google Client 設定決定。

## Decisions

- 使用獨立 clone，避免既有 linked worktree 的未提交工作與其他 agent 工作互相影響。
- 保留 OAuth migration revision，不重寫已可能用於本機測試庫的歷史；以 merge revision 解決雙 head。
