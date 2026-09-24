# 官網後台 LINE 登入

此功能用於本 repo 的五校官網後台，與園務系統帳號／租戶、各校 LINE 官方帳號（OA）都無關。LINE 登入只接受**已在後台內自行綁定 LINE**、且仍啟用的管理員，沿用角色、分校範圍、session 與 CSRF；帳密登入與 Google 登入照常可用。

## 與 Google 登入的差異

LINE 的 ID token 沒有 `email_verified`，要取得 email 還得另外向 LINE 申請權限。後台因此**不拿 email 當身分依據**：

- 授權只要 `openid`，不申請 email、不讀暱稱或大頭貼；後台只存 LINE 的 `sub`（`users.line_sub`）。
- 首次 LINE 登入**不會**自動綁定。管理員先用帳密或 Google 登入，到側欄底部進入「我的帳號」按「綁定 LINE」，完成 LINE 授權後就能用 LINE 登入。
- 綁定只能由本人在有效的後台 session 內發起；callback 回來時會再確認 session 仍是發起的那一位，且帳號還在啟用中。同一個 LINE 帳號只能綁一個後台帳號，已綁定的帳號要先解除才能換綁。
- 「我的帳號」可以隨時解除綁定；LINE 設定關閉後也能解除。帳密不受影響，不會因此被鎖在門外。
- 綁定與解除都會寫進操作紀錄（`user.link_line`／`user.unlink_line`）。

## LINE Developers Console 設定

1. 選定一個長期使用的 **Provider**。同一位 LINE 使用者在不同 Provider 下的 user ID（`sub`）不同；之後若改用其他 Provider 底下的 channel，所有綁定都會失效，要請管理員重新綁定。
2. 在該 Provider 建立 **LINE Login** channel，App types 勾選 **Web app**。
3. 在 channel 的 **LINE Login** 分頁設定 Callback URL：公開官網網址加上 `/api/website/v1/auth/line/callback`，例如 `https://官網網域/api/website/v1/auth/line/callback`。必須與後端設定完全相同，並走公開 Nuxt 入口，不要用 Railway API 的私有網址。
4. **不需要**申請 OpenID Connect 的 email 權限。
5. Channel 在 **Developing** 狀態時，只有 channel **Roles** 裡具 Admin 或 Tester 角色的 LINE 帳號能登入，適合先驗收。要給所有管理員使用前，按頁面上方的狀態改成 **Published**（改了就不能改回）。
6. 本機開發建議在**同一個 Provider** 下另建開發用 channel，Callback URL 設 `http://localhost:5173/api/website/v1/auth/line/callback`，瀏覽器也要從同一個 localhost origin 開後台。同一個 Provider 的 `sub` 相同，但 Channel ID 與 secret 各自獨立。

參考：[LINE Login 整合流程](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[ID token 驗證](https://developers.line.biz/en/docs/line-login/verify-id-token/)、[Channel 建立與狀態](https://developers.line.biz/en/docs/line-login/getting-started/)。

## 後端環境變數

| 變數 | 用途 |
| --- | --- |
| `WEBSITE_LINE_CHANNEL_ID` | channel 的 **Basic settings → Channel ID** |
| `WEBSITE_LINE_CHANNEL_SECRET` | 同頁的 **Channel secret**；用來換 token，也用來驗 web login 的 HS256 ID token。只在 API 服務端注入 |
| `WEBSITE_LINE_REDIRECT_URI` | 與 Console 完全相同的公開 callback URL |
| `WEBSITE_ADMIN_ORIGIN` | 公開官網 origin，必須與 callback 同源 |
| `WEBSITE_SESSION_SECRET` | 既有的隨機 secret，用來簽 10 分鐘的 LINE 握手 cookie |

前三項要一起設定；三項都留空就停用 LINE 登入，登入頁和「我的帳號」不會出現綁定入口。只設定一部分、正式環境不是 HTTPS、路徑不是上面那一條、或與 admin origin 不同源時，服務會拒絕啟動。Secret 不放進 `VITE_*`、`NUXT_PUBLIC_*`、版控、指令參數或對話；部署平台用受保護的變數介面注入。

在 Console 重新發行 Channel secret 後，要同步更新 `WEBSITE_LINE_CHANNEL_SECRET`；已綁定的 `sub` 不受影響。

## 資料庫與上線順序

新增 migration `d41e6c2a9f58`，接在 `b6d1f8e3a524`（使用者明確授權）後面：只新增 nullable、unique 的 `users.line_sub`，不建立管理員，也不調整密碼或角色。只加欄位，跟上一版程式相容。

正式環境不用手動執行：API 容器啟動時會自動 `alembic upgrade head` 再核對 schema（見 [CICD.md](CICD.md)），所以合併進 `main` 就會套到正式 DB。LINE 三個環境變數可以在部署後再設；沒設之前 LINE 入口不會出現，其他登入方式照常。

## 安全設計

- 授權請求帶 `state`、`nonce` 與 PKCE（S256）。握手資料放在簽章 cookie `ivy_line_oauth`（HttpOnly、SameSite=Lax、Path 限定 `/api/website/v1/auth/line`、10 分鐘有效，正式環境加 Secure），callback 完成後立即刪除。沒有另外掛 `SessionMiddleware`，避免與 Google 的握手互相覆寫。
- ID token：HS256 用 Channel secret 驗；若 LINE 改發 ES256，就用 `https://api.line.me/oauth2/v2.1/certs` 依 `kid` 驗。金鑰種類跟著演算法走，其他演算法（含 `none`）一律拒絕。另外檢查 `iss=https://access.line.me`、`aud`（Channel ID）、`exp`、`iat` 與 `nonce`。
- 以登入模式開始的握手不會完成綁定；綁定模式的錯誤導回「我的帳號」，不影響既有 session。
- 登入起點沿用帳密登入的來源限流。LINE 的 access／refresh／ID token 都不存資料庫、不傳給 SPA、不放進任何 URL；錯誤訊息只回固定代碼，不回顯 LINE 的 `error_description`。
- 登入成功會撤銷同一瀏覽器的舊 session、建立新的，之後由既有 `/auth/me` 恢復 session 與 CSRF token。

## 登入按鈕

登入頁的 LINE 按鈕依 [LINE Login 按鈕規範](https://developers.line.biz/en/docs/line-login/login-button/) 製作：底色 `#06C755`、白色圖示與文字、8% 黑分隔線，hover／press 疊 10%／30% 黑。圖示 `admin/public/line-icon.png` 是官方素材包裡的 `images/DeskTop/2x/44dp/line_88.png`，原檔直接使用，不改比例。

## 驗收

- 自動測試：用獨立 PostgreSQL（名稱含 `test`），只模擬 LINE 的網路，實際驗 HS256／ES256 簽章與 iss、aud、exp、nonce、state、PKCE、`alg` 混淆、握手竄改與逾時、重放、取消、綁定的 session 檢查、重複綁定、解除綁定、停權與分校權限（`backend/tests/test_line_oauth.py`、`admin/src/__tests__/lineLogin.test.ts`）。
- 瀏覽器檢查：真的 API 經 Vite 代理，只攔截 `access.line.me`（腳本在本機 `output/playwright/line-oauth-20260924/check.cjs`，不進版控）。
- **待實際 channel 建好後驗收**：本人 LINE 帳號完整走一次綁定 → 登出 → LINE 登入；取消授權；用另一個未綁定的 LINE 登入要被拒絕；手機瀏覽器與 LINE 內建瀏覽器各一次。
