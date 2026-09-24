# 官網後台 Google OAuth

此功能用於本 repo 的五校官網後台，與園務系統帳號／租戶無關。Google 登入只接受已在後台建立且啟用的管理員，沿用角色與分校範圍，不開放註冊、不依網域自動授權；帳密登入繼續可用。

## Google Cloud 設定

1. 在 Google Cloud 的 Google Auth Platform 設定 Branding、Audience 和支援聯絡資訊；只需 `openid`、`email`，不要求 Gmail／Drive API 權限。
2. 建立 OAuth Client，Application type 選 **Web application**。
3. Authorized redirect URIs 加入實際公開官網網址加上 `/api/website/v1/auth/google/callback`，例如 `https://官網網域/api/website/v1/auth/google/callback`。必須完全相同，且使用公開 Nuxt 入口，不使用 Railway API 私有網址。
4. 若處於 Testing，將預定使用的 Google 帳號加入 Test users；若選 Internal，只有該 Google Workspace 組織能通過 Google 驗證。這不會取代後台管理員權限檢查。
5. 本機以 Vite 開發時，可另加 `http://localhost:5173/api/website/v1/auth/google/callback`，瀏覽器亦須從同一個 localhost origin 開啟後台。若改埠號或使用 `127.0.0.1`，OAuth Client 與環境設定需一起改。

參考：[Google OpenID Connect 設定](https://developers.google.com/identity/openid-connect/openid-connect)。

登入圖示 `admin/public/google-g.png` 取自 [Google 官方品牌資產](https://developers.google.com/static/identity/images/g-logo.png)，依 [登入按鈕指引](https://developers.google.com/identity/branding-guidelines) 保留彩色與比例，採本機靜態檔供應。

## 後端環境變數

| 變數 | 用途 |
| --- | --- |
| `WEBSITE_GOOGLE_CLIENT_ID` | 上述 Web application 的 Client ID |
| `WEBSITE_GOOGLE_CLIENT_SECRET` | 對應的 Secret，只在 API 服務端注入 |
| `WEBSITE_GOOGLE_REDIRECT_URI` | 與 Google Cloud 完全相同的公開 callback URL |
| `WEBSITE_ADMIN_ORIGIN` | 公開官網 origin，須與 callback 同源 |
| `WEBSITE_SESSION_SECRET` | 既有隨機 secret，用於簽署 10 分鐘的 OAuth 握手 cookie |

前三項必須一起設定；皆空則停用 Google 登入、登入頁隱藏入口。部分設定缺漏、正式環境非 HTTPS 或與 admin origin 不同時拒絕啟動。Secret 不放進 `VITE_*`、`NUXT_PUBLIC_*`、版控、指令參數或對話。部署平台用受保護的變數介面注入；本機只引用既有安全環境變數。

## 資料庫與上線順序

Google migration `b7930d2f6a10`（接在 `8cf3e2b5a641`）僅新增 nullable、unique 的 `users.google_sub`，不建立管理員、不調整密碼或角色。另以無 schema 操作的 merge revision `c6e4a2b9d810` 合併它與 main 的流量 migration `b7d2e4f1a903`，保留兩條既有歷史；整合後唯一 head 必須為 `c6e4a2b9d810`。

`main` push 在 CI 通過後會自動先部署 API、再部署包含 admin 的 web。2026-09-24 起 API 啟動時會自動 `alembic upgrade head`（見 [CICD.md](./CICD.md)）；下方手動步驟是當時的上線紀錄，正式 DB 已在 `c6e4a2b9d810`。

上線前重新確認正式 release、DB revision 與目標候選 commit，依正式部署程序備份並核准 migration，套用後再部署 API／web：

```sh
cd backend
uv run --frozen alembic upgrade head
```

此指令必須在確認目標 DB 的部署環境執行；不能只更新程式而跳過 migration，因為原有帳密登入也會讀取 User model。Nuxt API 代理已明確設定 `redirect: 'manual'`，讓瀏覽器接收 OAuth 302/303 和多個 Set-Cookie。

升級完成後須確認 DB revision 為 `c6e4a2b9d810`、`users.google_sub` 與 unique constraint 存在，再切換 API／web。舊 API 的 schema guard 不接受新 revision，因此升級至切換完成期間不要重啟舊 API。若需回復版本，應以相容新 schema 的候選程式處理；不得直接 downgrade 或刪除已綁定的 Google 身分資料。

## 管理員與綁定

- 先由總管理者在「使用者」建立管理員，Email 使用本人 Google 帳號的信箱並給予正確分校範圍。仍依既有規則設定密碼，可作備援。
- 首次 Google 登入只有 **已驗證的 Gmail** 或 **帶 `hd` 的已驗證 Google Workspace** 信箱能自動綁定；不忽略 Gmail 的句點或 `+suffix`。其他第三方信箱型 Google 帳號請使用帳密登入，尚未提供手動綁定 UI。
- 首次綁定後以 Google `sub` 識別帳號，Google 信箱日後改名不會把權限移交給另一個 Google 帳號。綁定不更新後台 Email、角色或分校。
- 停權立即撤銷既有 session，後續 Google 登入也會被拒絕；登出使用原有後台登出功能，不會登出 Google。
- Google access／refresh／ID token 不存資料庫、不傳給 SPA、不放進登入結果 URL。成功後由既有 `/auth/me` 恢復 session 與 CSRF token。

信箱與 `sub` 的依據：[Google ID token claims](https://developers.google.com/identity/openid-connect/reference)、[第三方信箱的 ownership 限制](https://developers.google.com/identity/sign-in/web/backend-auth)。

## 驗收

自動測試以獨立 PostgreSQL 與模擬 Google HTTP 端點執行，實際驗證 RSA 簽章、issuer、audience、expiry、nonce、state、PKCE、cookie、帳號資格、分校權限、CSRF、停權及登出。Google Cloud 設定完成後仍須用本人帳號做實際往返驗收，含取消授權、無權限帳號與手機瀏覽器。

可用 `WEBSITE_TEST_DATABASE_URL` 指向獨立且名稱含 `test` 的測試庫；pytest 會清空測試表，切勿指向其他資料庫。
