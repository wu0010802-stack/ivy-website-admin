# 網域移轉 checklist：ivykidschool.com（Wix → Cloudflare，網站在 Railway）

建立：2026-11-11。目標：

- 正式主網址 `https://www.ivykidschool.com/`；`https://ivykidschool.com/` 301 到 www。
- 網域註冊、續費、DNS 從 Wix 移到 Cloudflare（Registrar＋DNS）；新網站繼續放 Railway。
- 本輪只做準備：**沒有**改 DNS／nameserver、沒有發起轉移、沒有付款或取消訂閱、沒有部署或重啟正式服務。

標記：✅ 程式碼已完成（在分支 `feature/domain-migration-20261111`，未 commit、未部署）｜⬜ 後台待操作｜❓ 待提供資料或決定。
密碼、API 金鑰、網域授權碼（EPP）**一律不寫進本檔或任何 repo 檔案**。

---

## 0. 現況（2026-11-11 唯讀查得）

| 項目 | 現況 | 來源 |
| --- | --- | --- |
| 註冊商 | Network Solutions（Wix 代售），WHOIS `Registrar: Network Solutions, LLC` | `whois ivykidschool.com` |
| 建立／到期 | 2015-10-30 建立；**2027-10-30 到期** | 同上 |
| 鎖定 | `clientTransferProhibited`（已鎖，轉出前要解鎖） | 同上 |
| Nameserver | `ns0.wixdns.net`、`ns1.wixdns.net` | `dig NS` |
| DNSSEC | **unsigned**（沒開；`dig DS` 無紀錄） | `whois`、`dig DS` |
| apex A | `185.230.63.186`、`.171`、`.107`（Wix） | `dig A` |
| www | CNAME `cdn3.wixdns.net`（Wix） | `dig CNAME www` |
| MX | Google Workspace：`aspmx.l.google.com`(10)、`alt1`(20)、`alt2`(30)、`alt3`(40)、`alt4`(50) `.aspmx.l.google.com` | `dig MX` |
| TXT（apex） | 只有 `google-site-verification=JxE-…`（Search Console／Workspace 驗證） | `dig TXT` |
| SPF／DKIM／DMARC | **公開查不到**：apex 沒有 `v=spf1`；`_dmarc`、`google._domainkey` 都沒有紀錄 | `dig TXT _dmarc…`、`google._domainkey…` |
| CAA | 沒有 | `dig CAA` |
| Railway web 服務 | 只有 `web-production-04caa.up.railway.app`（target port 3000），**沒有自訂網域** | `railway status --json`（唯讀） |
| Railway 變數（web） | `NUXT_PUBLIC_SITE_ORIGIN=https://web-production-04caa.up.railway.app`、`NUXT_PUBLIC_INDEXING_ENABLED=false` | `railway variables`（只看網址類值） |
| Railway 變數（api） | `WEBSITE_ADMIN_ORIGIN`、`WEBSITE_GOOGLE_REDIRECT_URI`、`WEBSITE_LINE_REDIRECT_URI`、`WEBSITE_VAPID_SUBJECT` 都是 Railway 網址 | 同上 |

> 公開 DNS 只查得到常見名稱。其他子網域（例如 Workspace 的 `mail`、自訂 DKIM selector、第三方驗證）**必須到 Wix 後台逐筆抄**，見第 3 節。

---

## 1. 程式碼已完成（✅）

| 項目 | 檔案 | 說明 |
| --- | --- | --- |
| ✅ 正式網址集中管理 | 既有：`web/nuxt.config.ts` 的 `NUXT_PUBLIC_SITE_ORIGIN`；canonical、Open Graph、JSON-LD、sitemap、robots 都從它組（`web/app/utils/seo.ts`），不讀 Host | 這輪查過：程式碼裡沒有寫死的 Railway 網址會出現在頁面上。剩下的寫死處都是維運腳本預設值（見下表），網址不影響使用者。 |
| ✅ 舊 Wix 網址 301 | `web/server/utils/site-redirects.ts`（對照表）、`web/server/middleware/00.site-redirects.ts` | 只轉 GET／HEAD；保留查詢字串（目標自帶參數優先）；百分比編碼、大小寫、結尾斜線都認得；沒有對應的照常 404，不會全部導回首頁。這組一部署就生效，只把原本會 404 的舊路徑改成 301。 |
| ✅ 主網域轉址開關 | 同上＋`web/nuxt.config.ts` `redirectHosts` | 新變數 `NUXT_REDIRECT_HOSTS`（web 服務，逗號分隔主機名）。**預設空白＝完全不轉**，Railway 網址照常可測。設了以後，列入的主機一律 301 到 `NUXT_PUBLIC_SITE_ORIGIN`、保留路徑與查詢字串；`/api/**` 與 `/release.json` 不轉（LINE webhook、CI 部署驗證照常）。命中舊網址時一次轉到底。 |
| ✅ robots.txt 只在正式主機開放 | `web/server/routes/robots.txt.get.ts` | 開放收錄後，Host 不是正式網址那台（Railway 網址、apex）一律 `Disallow: /`，避免同內容兩個網域被收錄。目前 `NUXT_PUBLIC_INDEXING_ENABLED=false`，行為不變。 |
| ✅ 過渡期兩個網域都能寫入後台 | `backend/app/config.py`（`admin_extra_origins`、`allowed_origins`、`origin_allowed`）、`backend/app/auth/deps.py`、`backend/app/auth/password_reset_routes.py`、`backend/app/booking/access_routes.py`、`backend/.env.example` | 新變數 `WEBSITE_ADMIN_EXTRA_ORIGINS`（api 服務）。原本後台寫入、家長修改頁、重設密碼只接受**一個** Origin（`WEBSITE_ADMIN_ORIGIN`），換網域當下另一邊所有寫入會 403。現在可列額外 origin；production 必須是 https、不含路徑。信件／LINE 連結、OAuth 同源檢查仍只用 `WEBSITE_ADMIN_ORIGIN`。不設＝與原本完全相同。 |
| ✅ 測試 | `web/tests/site-redirects.spec.ts`、`backend/tests/test_admin_extra_origins.py` | 見第 8 節。 |

### 不需要改、但切換時要知道的寫死網址

| 位置 | 用途 | 切換後 |
| --- | --- | --- |
| `deploy/railway_ci.py` `ORIGIN` | CI 部署後讀 `/release.json`、`/api/website/v1/health`、`/api/public-site` | 都在轉址豁免路徑，Railway 網址會一直可用，**不用改**。 |
| `deploy/uptime_check.py`、`.github/workflows/uptime.yml` | 每日巡檢，已支援 repo 變數 `UPTIME_BASE_URL` | ⬜ 切換後在 GitHub repo Variables 設 `UPTIME_BASE_URL=https://www.ivykidschool.com`。 |
| `.github/workflows/website.yml` `environment.url` | GitHub 部署頁顯示的連結 | 只是顯示，切換穩定後順手改。 |
| `scripts/audit-public-site.mjs`、`scripts/page-font-chars.cjs` | 本機稽核腳本預設值，可用參數覆寫 | 不影響正式站。 |
| `web/server/utils/security-headers.ts` HSTS | `max-age=31536000`，沒有 `includeSubDomains`／`preload` | 切換穩定一段時間後再評估 preload（preload 很難撤回，**不要在切換當天開**）。 |

---

## 2. 舊網址 → 新網址對照表

來源：舊站 `https://www.ivykidschool.com/sitemap.xml` → `pages-sitemap.xml`（2026-11-11 抓取，30 個網址；首頁選單 16 個連結都在其中）。「標題」是舊頁 `<title>`。Wix 複製頁（`副本-*`）的網址和標題不一致，以標題判斷內容。

| # | 舊網址（解碼後） | 舊頁標題 | 新網址 | 狀態 |
| --- | --- | --- | --- | --- |
| 1 | `/` | 高雄市｜常春藤教育機構 | `/` | 原路徑保留 |
| 2 | `/about` | 關於常春藤 About | `/about` | 原路徑保留 |
| 3 | `/常春藤入學-admission` | 常春藤入學 Admission | `/admission` | ✅ 301 |
| 4 | `/寶貝入學流程` | 寶貝入學流程 | `/admission#process` | ✅ 301 |
| 5 | `/分班表` | 分班表 | `/admission#classes` | ✅ 301 |
| 6 | `/新生入園須知` | 新生入園須知 | `/admission#newcomer` | ✅ 301 |
| 7 | `/收退費辦法` | 收退費辦法 | `/admission#fees`（常見問題「費用與補助」） | ✅ 301 |
| 8 | `/常春藤環境-environment` | 一日常春藤 Environment | `/environment` | ✅ 301 |
| 9 | `/副本-幼兒保育` | 幼兒保育 | `/environment#care` | ✅ 301 |
| 10 | `/校園環境` | 校園環境 | `/environment#spaces` | ✅ 301 |
| 11 | `/幼兒餐點` | 幼兒餐點 | `/environment#meals` | ✅ 301 |
| 12 | `/一日流程` | 一日流程 | `/#life`（首頁「孩子的一天」） | ✅ 301 |
| 13 | `/教學特色-course` | 特色教學 Course | `/curriculum` | ✅ 301 |
| 14 | `/副本-快樂的孩子` | 教學理念 | `/curriculum#belief` | ✅ 301 |
| 15 | `/分校資訊-campuses` | 各校資訊 Campuses | `/#campuses` | ✅ 301 |
| 16 | `/義華校介紹` | 義華校介紹 | `/?campus=yihua#campuses` | ✅ 301 |
| 17 | `/明華校介紹` | 明華校介紹 | `/?campus=minghua#campuses` | ✅ 301 |
| 18 | `/崇德校介紹` | 崇德校介紹 | `/?campus=chongde#campuses` | ✅ 301 |
| 19 | `/國際校介紹` | 高雄市｜常春藤教育機構（實為國際校介紹） | `/?campus=international#campuses` | ✅ 301 |
| 20 | `/仁武校介紹` | 仁武校介紹 | `/?campus=renwu#campuses` | ✅ 301 |
| 21 | `/副本-仁武校介紹-2` | 仁武校校園環境 | `/environment#campuses`（校園探索，含仁武分頁） | ✅ 301 |
| 22 | `/活動分享` | 校園生活 Features | `/news` | ✅ 301，❓ 請確認（新站消息目前只有義華的粉專貼文） |
| 23 | `/作品照片分享` | 常春藤兒童美術館 Art Gallery | — | ❓ 待確認：新站沒有作品相簿；可考慮 `/curriculum#gallery`（「每一件作品，都從動手做開始」） |
| 24 | `/副本-2025冬令營` | 114下.115招生說明會 | — | ❓ 待確認：一次性活動頁；可考慮 `/admission` 或不轉（404） |
| 25 | `/副本-教學理念` | 2025冬令營 | — | ❓ 待確認：已過期活動；建議不轉或 `/news` |
| 26 | `/副本-特色課程` | 生活影片 | — | ❓ 待確認：新站沒有影片集頁 |
| 27 | `/副本-仁武校介紹` | 快樂的孩子（仁武子站） | — | ❓ 待確認：可考慮 `/?campus=renwu#campuses` |
| 28 | `/副本-仁武校介紹-1` | 特色課程（仁武子站） | — | ❓ 待確認：可考慮 `/curriculum` |
| 29 | `/副本-仁武校介紹-3` | 寶貝生活（仁武子站） | — | ❓ 待確認 |
| 30 | `/副本-仁武校介紹-5` | 親子活動（仁武子站） | — | ❓ 待確認 |

- 要加或改對應：只改 `web/server/utils/site-redirects.ts` 的 `LEGACY_REDIRECTS`（鍵寫解碼後的小寫路徑），測試會檢查格式。
- 舊站另有：`/sitemap.xml`、`/robots.txt` 由新站自己的路由取代；Wix 的 `?lightbox=` 等參數會原樣帶到新網址，不影響頁面。
- 錨點（`#process` 等）會跟著 301 的 Location 帶給瀏覽器；搜尋引擎忽略錨點，只看到頁面本身。
- Google Search Console 目前看得到的舊網址可能比 sitemap 多（例如更早刪掉的頁面、`?lang=` 版本）。❓ 若有 Search Console 存取權，匯出「網頁」報表與「連結」報表的熱門網址再補對照。

### Wix 資源依賴

- 新站正式頁面（`/`、`/about`、`/admission`、`/environment`、`/curriculum`、`/news`、`/visit`、`/anniversary`、`/privacy`）的 HTML 與公開 API **都沒有載入** `wixstatic.com`／`parastorage.com`／`wix.com` 的資源；圖片都在 repo 的 `web/public/assets` 或後台素材庫（Railway volume）。
- `web/public/assets/sources.json` 列了 4 張 `static.wixstatic.com` 原圖網址，只是素材出處紀錄，程式沒有讀它。
- 已發布內容 `day_experience.source_note` 寫著舊網址「一日流程」，是內部出處註記，`public-copy.ts` 不輸出到頁面；切換後該網址也會 301。
- 新站表單（預約參觀）走自己的 API，不依賴 Wix 表單。
- **尚未搬的舊站內容**（網域一切換，Wix 頁面就從這個網域消失；Wix 網站本身在方案期間仍可從 Wix 後台存取）：
  - ❓ 兒童美術館相簿（#23）、冬令營／招生說明會（#24、#25）、生活影片（#26）、仁武子站 4 頁（#27–#30）的照片與影片。要保留的話，切換前從 Wix 後台下載原檔（Wix 媒體管理員可下載原始檔），交給我放進後台素材庫或 `web/public/assets`。
  - ❓ 舊站有沒有 Wix 表單、Wix 會員、Wix 部落格或 Wix 預約：從公開頁面只看到 Facebook 連結（`facebook.com/ivykid`），請在 Wix 後台「應用程式」確認，有的話匯出資料。

---

## 3. Wix DNS 紀錄備份與核對（改 nameserver 前一定要做）

Wix 官方沒有 DNS 匯出功能，要人工抄（[Managing DNS records](https://support.wix.com/en/article/managing-dns-records-in-your-wix-account)）。

1. ⬜ Wix 後台 → **Domains** → `ivykidschool.com` 旁 **Domain Actions** → **Manage DNS Records**。
2. ⬜ 每個區塊（A、CNAME、MX、TXT、SRV、NS…）**整頁截圖**，並把每筆抄進下表（名稱、類型、值、TTL）。檔案存在專案外（例如雲端硬碟），不要 commit。
3. ⬜ 特別確認以下是否存在，存在就原樣搬到 Cloudflare：
   - MX（目前公開看到 Google Workspace 5 筆）
   - SPF：TXT `@` 開頭 `v=spf1`（公開查不到，Wix 後台若也沒有，代表目前沒有 SPF）
   - DKIM：TXT `google._domainkey` 或其他 `*._domainkey`（公開查不到）
   - DMARC：TXT `_dmarc`（公開查不到）
   - 其他 TXT：`google-site-verification=…`（**要保留**，Search Console／Workspace 驗證靠它）、Facebook／Meta 網域驗證、Apple、Microsoft 等
   - 其他子網域 CNAME／A：`mail`、`calendar`、`drive`、`ftp`、行銷工具、舊系統
   - SRV（若有視訊或 IM 服務）
4. ⬜ 核對方式：Cloudflare 匯入後、**改 nameserver 之前**，對每一筆用 Cloudflare 指派的 nameserver 直接查，結果要和 Wix 現在的一樣：

   ```sh
   # 現況（Wix）
   dig +short MX ivykidschool.com @ns0.wixdns.net
   dig +short TXT ivykidschool.com @ns0.wixdns.net
   # Cloudflare（把 xxx 換成 Cloudflare 給的 nameserver）
   dig +short MX ivykidschool.com @xxx.ns.cloudflare.com
   dig +short TXT ivykidschool.com @xxx.ns.cloudflare.com
   # 子網域逐一比對
   dig +short TXT _dmarc.ivykidschool.com @xxx.ns.cloudflare.com
   ```

### 信箱建議（❓ 不在本輪範圍，但切換時順便決定）

目前公開查不到 SPF、DKIM、DMARC，代表 Gmail 寄出去的信容易被判為垃圾信，也可能被偽冒。建議搬到 Cloudflare 後，由 Workspace 管理員：

- 加 SPF：TXT `@` `v=spf1 include:_spf.google.com ~all`（若還有其他寄信服務要一併列入）
- 在 Google 管理控制台產生 DKIM，加 TXT `google._domainkey`
- 加 DMARC：TXT `_dmarc` 先用 `v=DMARC1; p=none; rua=mailto:<收報告信箱>` 觀察

這些是新增紀錄，**不要和 nameserver 切換同一天做**，避免出問題時分不清原因。

---

## 4. Railway 設定（⬜ 後台）

依 [Railway: Working with Domains](https://docs.railway.com/networking/domains/working-with-domains)、[SSL troubleshooting](https://docs.railway.com/networking/troubleshooting/ssl)。

- **加在哪個服務**：project `ivy-website-admin` → environment `production` → **web** 服務（`e0851ec5-…`，`deploy/web.Dockerfile`）。**不是 api**：api 沒有公開網域，由 web 經 `api.railway.internal:8000` 轉送。
- **連接埠**：target port **3000**（和現有 `web-production-04caa.up.railway.app` 相同，web 的 `PORT=3000`）。
- **步驟**：web → Settings → Public Networking → **+ Custom Domain** → 輸入 `www.ivykidschool.com` → port 選 3000。Railway 會給 **一筆 CNAME（例如 `xxxxxx.up.railway.app`）＋一筆 TXT（驗證）**，兩筆都要加，只有 CNAME 會 404。
- **apex**：兩種做法擇一（建議 A）：
  - **A（建議）**：Railway 只加 www；apex 交給 Cloudflare Redirect Rule 301 到 www（見第 5 節）。Railway 只占 1 個自訂網域。
  - **B**：Railway 也加 `ivykidschool.com`（apex 在 Cloudflare 用 CNAME flattening），由新站設定 `NUXT_REDIRECT_HOSTS=ivykidschool.com` 轉到 www。要占 2 個自訂網域。
- **方案限制**（官方）：Trial 每服務 1 個自訂網域（apex 與 www 算兩個）；**Hobby 每服務 2 個**；Pro 每服務 20 個。❓ 請確認目前 Railway 方案（我沒有讀到方案資訊）。
- **憑證**：Let's Encrypt 自動簽發，通常 DNS 生效後一小時內，最長可到 72 小時；有 CAA 紀錄時要允許 `letsencrypt.org`（目前沒有 CAA）。
- **實際的 CNAME／TXT 值：待填**。要在 Railway 按下「+ Custom Domain」後才看得到；按下去本身不影響現有網址，但屬於正式環境設定變更，本輪沒有操作。

| 用途 | 類型 | 名稱 | 內容 | 來源 |
| --- | --- | --- | --- | --- |
| www 指向 Railway | CNAME | `www` | `＿＿＿＿.up.railway.app`（待填） | Railway web → Custom Domain |
| Railway 驗證 | TXT | `＿＿＿＿`（待填，照 Railway 顯示） | `＿＿＿＿`（待填） | 同上 |
| （做法 B 才要）apex | CNAME | `@` | `＿＿＿＿.up.railway.app`（待填） | 同上 |
| （做法 B 才要）apex 驗證 | TXT | 待填 | 待填 | 同上 |

---

## 5. Cloudflare DNS 紀錄表（⬜ 後台）

依 [Cloudflare full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)、[DNS quick scan](https://developers.cloudflare.com/dns/zone-setups/reference/dns-quick-scan/)、[Redirect root to www](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-root-to-www/)。

Cloudflare 新增網站時的自動掃描**不保證抓到全部紀錄**（特別是自訂子網域、DKIM selector），一定要用第 3 節的 Wix 備份逐筆核對。

| 類型 | 名稱 | 內容 | Proxy | 用途 | 內容來源 |
| --- | --- | --- | --- | --- | --- |
| CNAME | `www` | Railway 給的 `＿＿＿＿.up.railway.app` | **DNS only（灰雲）** | 新網站 | Railway（待填） |
| TXT | Railway 指定名稱 | Railway 指定值 | — | Railway 網域驗證 | Railway（待填） |
| A | `@` | `192.0.2.1`（Cloudflare 文件的保留位址，只為了讓 apex 經過代理） | **Proxied（橘雲）** | apex → www 轉址（做法 A） | Cloudflare 官方範例 |
| MX | `@` | `aspmx.l.google.com` 優先 10；`alt1.aspmx.l.google.com` 20；`alt2…` 30；`alt3…` 40；`alt4…` 50 | — | Google Workspace 收信 | 目前公開 DNS＋Wix 備份核對 |
| TXT | `@` | `google-site-verification=…`（照 Wix 原值） | — | Search Console／Workspace 驗證 | Wix 備份 |
| TXT／CNAME | 其他 | 照 Wix 備份 | 照原設定（預設灰雲） | 其他服務 | Wix 備份 |

- **www 為什麼用灰雲**：新站用 `X-Forwarded-For` 由右往左數 1 層（Railway edge）取訪客 IP（`web/server/utils/client-ip.ts`、`NUXT_TRUSTED_PROXY_HOPS=1`），用在限流與操作紀錄 IP。www 若開橘雲，取到的會變成 Cloudflare 節點 IP，所有訪客共用限流額度。要開橘雲之前必須先改取 IP 的方式（例如改信任 `CF-Connecting-IP` 且只接受 Cloudflare IP 來源），屬於另一個工作。灰雲也讓 Railway 能直接簽 Let's Encrypt 憑證。
- 若之後仍要 www 開橘雲：SSL/TLS 模式**必須是 Full**（Railway 文件明說 Full (Strict) 不適用、Flexible 會轉址迴圈），Edge Certificates 要開 Universal SSL。
- **apex → www 轉址規則**（做法 A）：Cloudflare → Rules → Redirect Rules → 新增：條件 `(http.host eq "ivykidschool.com")`，動作 Dynamic，表達式 `concat("https://www.ivykidschool.com", http.request.uri.path)`，狀態 **301**，勾選 **Preserve query string**。舊網址（例如 `ivykidschool.com/分班表`）會先到 `www.ivykidschool.com/分班表`，再由新站轉到 `/admission#classes`（兩跳，都 301）。
- 若選做法 B：apex 改成 CNAME `@` → Railway 目標（灰雲），web 設 `NUXT_REDIRECT_HOSTS=ivykidschool.com`，一跳到底。

---

## 6. 網域轉出前置確認（Wix → Cloudflare Registrar）

依 [Wix: Transferring away](https://support.wix.com/en/article/transferring-your-wix-domain-away-from-wix-2477749)、[Wix: 60-day lock](https://support.wix.com/en/article/icanns-60-day-lock-policy)、[Cloudflare: Transfer to Cloudflare](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/)、[Cloudflare Registrar FAQ](https://developers.cloudflare.com/registrar/faq/)。

| 項目 | 怎麼確認 | 現況 |
| --- | --- | --- |
| ❓ 登記（註冊人）信箱 | Wix → Domains → Domain Actions → Edit contact info。授權碼會寄到這個信箱，**一定要收得到**。 | 待確認 |
| 到期日 | WHOIS `2027-10-30` | 還有約 11 個月，不急 |
| 60 天限制 | 註冊、改註冊人資料、換註冊商後 60 天內不能轉 | 註冊 2015 年；**這段期間不要改註冊人資料**（Wix 建議先轉、再改資料） |
| Wix 自動續約時間 | Wix 在到期前 30 天自動續約；Cloudflare 說剛續約後 45 天內轉入不會再加一年 | 在 2027-09 之前完成轉入，避免重複付錢 |
| 轉移鎖定 | WHOIS 目前 `clientTransferProhibited` | 轉出前要解鎖；Wix 文件只說「必須先解鎖」，沒寫操作位置。❓ 在 Domain Actions 找不到時聯絡 Wix 客服 |
| 隱私保護 | Wix 建議轉出前關閉 Private Registration，以免收不到轉移信 | ❓ 待確認有沒有開 |
| 授權碼（EPP） | Wix → Domains → Domain Actions → **Transfer away from Wix** → Transfer Domain → I Still Want to Transfer → 寄到註冊人信箱 | 拿到後直接貼進 Cloudflare，**不要存檔、不要貼進對話或文件** |
| Cloudflare 轉入條件 | Cloudflare 帳號 email 已驗證、有付款方式；網域已在 Cloudflare 以 full setup 加入並 **Active**（nameserver 先改成 Cloudflare）；轉入要付一年費用（到期日順延一年） | ❓ 誰的 Cloudflare 帳號（建議用機構共用信箱，不用個人信箱） |
| 時間 | Cloudflare 最長 10 天、多數 5 個工作日；Wix 說最長約 7 天 | — |
| 轉入後 | Cloudflare Registrar 只能用 Cloudflare nameserver | 本案就是要用 Cloudflare DNS，沒有影響 |
| Google Workspace | 若 Workspace 是**透過 Wix 購買**，它是獨立訂閱，轉出網域不會自動取消；但要在 Cloudflare 有正確 MX 才收得到信。Wix 可協助把 Workspace 帳務轉給 Google（不可逆）。 | ❓ Workspace 是在 Wix 買的還是直接向 Google 買的 |
| Wix 網站方案 | 網站方案與網域是兩個獨立訂閱；取消一個不會取消另一個 | ❓ 方案到期日；新站穩定前**不要取消**（舊站是回復手段） |
| 網域自動續約 | 轉入完成後，Wix → Premium Subscriptions → 網域 → Cancel auto renew（轉出成功後 Wix 端通常就沒有網域了，保險起見確認一次） | 轉入完成後做 |

### DNSSEC

目前 **DNSSEC 沒開**（WHOIS `unsigned`、沒有 DS），所以**不用先在 Wix 關 DNSSEC**。Wix 的 DNSSEC 跟「Private registration」綁在一起；若 Wix 後台顯示有開：

1. Wix → Domains → Domain Actions → Edit contact info → Privacy and DNSSEC protection → 關閉（❓ Wix 沒寫這是否算「改註冊人資料」而觸發 60 天鎖；目前沒開就不要動它）。
2. 等舊 DS 過期：`dig +short DS ivykidschool.com` 查不到才繼續（至少 24 小時，常見 24–48 小時）。
3. 改 nameserver 到 Cloudflare。
4. 等舊 NS 的 TTL 過期（通常 1 小時內）。
5. 網域轉入 Cloudflare 完成後，Cloudflare → DNS → Settings → Enable DNSSEC（Registrar 會自動送 DS，約 1–2 天生效）。

DNSSEC 是選配，建議等網站與信箱都穩定一週後再開。

---

## 7. 正式切換步驟（每步的成功判斷與回復方式）

整體順序：**先 DNS（nameserver 換到 Cloudflare），網站切到新站，穩定後才轉移註冊商**。每一段都可以獨立回復，轉移註冊商放最後，因為那一步最慢且最難回頭。

### 階段 A：準備（不影響任何線上服務）

| 步驟 | 操作 | 成功判斷 | 失敗時 |
| --- | --- | --- | --- |
| A1 | 把本分支合併、部署（只會多出舊網址 301；`NUXT_REDIRECT_HOSTS`、`WEBSITE_ADMIN_EXTRA_ORIGINS` 不設，行為不變） | CI 全綠；`curl -sI https://web-production-04caa.up.railway.app/%E5%88%86%E7%8F%AD%E8%A1%A8` 回 `301`、`location: /admission#classes`；`/about` 仍 200 | 回滾到上一個部署 |
| A2 | 第 3 節：Wix DNS 全部抄錄、截圖 | 每筆都有紀錄 | — |
| A3 | 下載要保留的舊站內容（第 2 節「尚未搬的舊站內容」） | 原檔在手上 | — |
| A4 | Cloudflare 新增網站（Free 方案即可，full setup），**先不要改 nameserver**；照第 3 節補齊信箱與驗證類紀錄 | 第 3 節的 `dig @Cloudflare-NS` 結果與 Wix 完全相同 | 刪掉 Cloudflare 網站即可，沒有影響 |
| A6 | Google Cloud Console（OAuth 用戶端）在「已授權的重新導向 URI」**新增** `https://www.ivykidschool.com/api/website/v1/auth/google/callback`（舊的保留）；LINE Developers（Login channel）Callback URL **新增**同路徑的 LINE 版本 `…/auth/line/callback` | 兩個主控台都同時列新舊兩個 | 刪掉新增的那筆 |

### 階段 B：先在 Railway 加網域、把紀錄放進 Cloudflare（仍不影響線上）

Wix 文件寫明：改用外部 nameserver 前要先把網域從 Wix 網站取消指派，換完以後 Wix 也不再替這個網域簽 SSL。也就是說**改 nameserver 那一刻舊站就離開這個網域**，不能先換 nameserver、再慢慢切網站；所以新站的紀錄要在換之前先在 Cloudflare 擺好。

| 步驟 | 操作 | 成功判斷 | 失敗時 |
| --- | --- | --- | --- |
| B1 | Railway web → + Custom Domain `www.ivykidschool.com`（port 3000）。此時 Railway 會顯示「等待 DNS」，不影響現有 Railway 網址 | Railway 列出 CNAME＋TXT 的值（填進第 4 節表格） | 刪掉這個自訂網域 |
| B2 | Cloudflare（尚未生效的 zone）：`www` 改成 Railway 的 CNAME（灰雲），加 Railway 的 TXT；apex 照第 5 節做法 A（A `@` 192.0.2.1 橘雲＋Redirect Rule）；MX／TXT 等照 Wix 備份 | 用 `dig @<Cloudflare NS>` 逐筆查到預期值 | 修正紀錄 |

### 階段 C：切換（建議選在平日上午、園方有人可以收信測試的時段）

| 步驟 | 操作 | 成功判斷 | 失敗時 |
| --- | --- | --- | --- |
| C1 | Wix → Domains → Domain Actions → Manage DNS Records → Nameservers → **Use custom nameservers**，填 Cloudflare 給的兩個（依 Wix 提示先取消網域與 Wix 網站的指派） | `dig NS ivykidschool.com` 變成 Cloudflare、Cloudflare 顯示 Active；Railway 網域驗證通過、憑證簽好（通常一小時內）；`curl -sI https://www.ivykidschool.com/` 200 且 `curl -s https://www.ivykidschool.com/release.json` 有 `base_commit`；從外部信箱寄信到園方 Gmail 收得到 | Wix 同一頁 **Reset to Wix** 並把網域重新指派給 Wix 網站（Wix 說 nameserver 生效最長 48 小時，回復期間網站與信可能不穩） |
| C2 | 確認 apex 轉址 | `curl -sI https://ivykidschool.com/about` → `301` `location: https://www.ivykidschool.com/about` | 檢查 Redirect Rule 與 apex 是否橘雲 |
| C3 | Railway **api** 變數一次改好（會重新部署 api）：`WEBSITE_ADMIN_ORIGIN=https://www.ivykidschool.com`、`WEBSITE_ADMIN_EXTRA_ORIGINS=https://web-production-04caa.up.railway.app`、`WEBSITE_GOOGLE_REDIRECT_URI=https://www.ivykidschool.com/api/website/v1/auth/google/callback`、`WEBSITE_LINE_REDIRECT_URI=https://www.ivykidschool.com/api/website/v1/auth/line/callback`、`WEBSITE_VAPID_SUBJECT=https://www.ivykidschool.com` | api health 200；在 www 登入後台、改一筆資料成功；Google／LINE 登入可回到 www；在 Railway 網址也能改資料（過渡期） | 五個變數改回 Railway 網址、刪掉 EXTRA_ORIGINS |
| C4 | Railway **web** 變數：`NUXT_PUBLIC_SITE_ORIGIN=https://www.ivykidschool.com`（會重新部署 web） | `curl -s https://www.ivykidschool.com/ | grep canonical` 是 www；OG `og:url`、`og:image` 是 www | 改回 Railway 網址 |
| C5 | 抽查舊網址：`curl -sI https://www.ivykidschool.com/%E6%94%B6%E9%80%80%E8%B2%BB%E8%BE%A6%E6%B3%95` → 301 `/admission#fees`；第 2 節 22 條 ✅ 全測 | 都是 301 到對的頁 | 改 `LEGACY_REDIRECTS` 重新部署 |
| C6 | 預約表單：在 www 用**測試校區或測試資料**走一次預約流程，再到後台取消（❓ 或用 stack e2e 對拋棄式測試庫跑，不對正式站送） | 預約成功頁、後台看得到、通知照常 | 照 C3 回復 |
| C7 | 觀察 1–3 天：Railway log 有無 403「Origin 不符」、5xx；Workspace 收發信正常 | 無異常 | — |

### 階段 D：開放收錄與收尾

| 步驟 | 操作 | 成功判斷 | 失敗時 |
| --- | --- | --- | --- |
| D1 | web：`NUXT_PUBLIC_INDEXING_ENABLED=true`、`NUXT_REDIRECT_HOSTS=web-production-04caa.up.railway.app`（Railway 網址也 301 到 www；`/api/**`、`/release.json` 例外） | `https://www.ivykidschool.com/robots.txt` 有 `Sitemap:`；Railway 網址 robots 仍 `Disallow: /`、首頁 301 到 www；`node scripts/check-public-seo.mjs` 照 `docs/website-admin/seo-performance.md` 通過 | 兩個變數拿掉 |
| D2 | Search Console：確認網域資源仍驗證（靠 `google-site-verification` TXT），提交 `https://www.ivykidschool.com/sitemap.xml`；抽查舊網址的「網址檢查」 | 提交成功 | — |
| D3 | 確認沒人再用 Railway 網址寫入（log 沒有 Railway Origin 的寫入）後，api 拿掉 `WEBSITE_ADMIN_EXTRA_ORIGINS` | Railway 網址的後台寫入回 403（預期） | 加回去 |
| D4 | GitHub repo Variables：`UPTIME_BASE_URL=https://www.ivykidschool.com`；LINE Developers（Messaging API）Webhook URL 改成 `https://www.ivykidschool.com/api/website/v1/line/webhook`（Railway 網址的 `/api/**` 不轉址，不改也能用）；OAuth 主控台的舊 Railway callback 可移除 | 每日巡檢綠燈；LINE webhook Verify 成功 | 改回 |
| D5 | 依第 6 節轉移註冊商到 Cloudflare | Cloudflare Registrar 顯示網域；WHOIS 註冊商變 Cloudflare | 轉移中不影響解析（nameserver 早已是 Cloudflare）；轉失敗可重試 |
| D6 | 轉入完成且新站穩定一段時間後，再決定 Wix 網站方案是否續約、DNSSEC 是否開啟、HSTS preload | — | — |

> 回復原則：C1 之後網站有問題，優先「Railway 變數改回 Railway 網址」（C3／C4），新站本身仍可從 Railway 網址使用；要整個回到舊 Wix 站才用 Wix 的 Reset to Wix（較慢，且信箱 MX 會跟著回到 Wix DNS，Wix 那邊的 MX 原本就在，不受影響）。網域轉入 Cloudflare（D5）之後就不能 Reset to Wix，所以 D5 一定放在全部穩定之後。

---

## 8. 本輪驗證紀錄（2026-11-11，本機，Node 22）

| 檢查 | 結果 |
| --- | --- |
| `npm --prefix web run typecheck` | 通過 |
| `npm run test:website` | 134 檔全過（含新增 `site-redirects.spec.ts` 14 項） |
| 後端全套 pytest（獨立測試庫） | 5010 過、1 略過（含新增 `test_admin_extra_origins.py`） |
| 正式建置（`nuxt build`，fixture 內容）＋`curl` 帶 Host | `NUXT_REDIRECT_HOSTS` 空白：Railway 主機與 apex 的 `/about` 都 200（不轉）；設了以後 apex、Railway 主機 301 到 www 並保留查詢字串，舊網址一跳到底，`/release.json`、`/api/**` 不轉，www 本身與未列入主機不轉；robots.txt 在 www 開放、其他主機 `Disallow: /`；canonical／`og:url` 為 `NUXT_PUBLIC_SITE_ORIGIN` |
| 舊網址 30 條（帶 `?lang=zh`） | 22 條 301 到對照表的網址且保留參數；8 條待確認的照常 404；`/`、`/about` 200 |
| Playwright 1440×900 與 390×844 | `/`、`/about`、`/admission`、`/environment`、`/curriculum`、`/news`、`/visit`、`/anniversary` 都 200、無頁面錯誤、無橫向溢出、無破圖；頁面上 29 個站內連結都 2xx／3xx |

**沒驗（需要正式網域或本人帳號）**：Railway 憑證簽發、Cloudflare Redirect Rule、真實 DNS、OAuth 回呼（Google／LINE）、預約表單實際送出（本輪沒對任何環境送出表單）、Search Console、Workspace 收發信、iOS／Android 實機。`/privacy` 在 fixture 內容下是 404（沒有已發布的隱私權政策時本來就不顯示），不是本輪造成。

## 9. 待提供資料／決定（一次列出）

1. Railway 目前方案（Trial／Hobby／Pro）→ 決定 apex 走做法 A 或 B。
2. Wix 網域註冊人信箱是誰、收不收得到；有沒有開隱私保護／DNSSEC。
3. Wix 後台 DNS 全部紀錄（截圖或抄錄，第 3 節）。
4. Google Workspace 是在 Wix 買的還是直接向 Google 買；誰是 Workspace 管理員（SPF／DKIM／DMARC 要他處理）。
5. 要用哪個 Cloudflare 帳號（建議機構共用信箱、開兩步驟驗證）與付款方式。
6. 對照表 #22–#30 的處理方式（第 2 節 ❓）。
7. 要保留的舊站相簿／影片原檔（第 2 節）。
8. Wix 網站方案到期日、新站上線後舊站要保留多久。
9. 舊站是否用了 Wix 表單、會員、部落格、預約等應用程式。
10. Search Console 存取權（要補舊網址對照時用）。
