# 各校 Facebook 粉專貼文 → 消息草稿（設計）

- 日期：2026-10-28
- 狀態：使用者 10-28 同意「同步→草稿→發布」做法；10-29 決定先只接義華；11-10 用義華粉專的長效 Page token 連真 Graph API v27.0 實測通過（見 §7），正式站設定待部署
- 基準：`origin/main` `14b37f38`

## 1. 為什麼要做

園方平常把活動照片發在各校 FB 粉專，官網的最新消息要另外打一次。目標是讓各校人員直接從粉專貼文挑幾則，一鍵變成官網消息草稿，不用重打字、重傳照片。

## 2. 目標、非目標、反目標

**目標**
- 後端每小時抓各校粉專最近 25 則貼文，存進收件匣（`facebook_page_posts`）。
- 後台「各校」→「Facebook 貼文」：選校、看貼文（照片、日期、內文），按「轉成消息草稿」或「略過」。
- 轉成草稿時：照片下載進該校素材庫（去 EXIF、產縮圖，同一般上傳），在該校 `campus_news` 草稿最上面加一則，標題取第一行、內文照段落、最後附「在 Facebook 看原文」連結。之後照原本送審與發布流程。

**非目標**
- 自動發布到官網（FB 貼文沒有標題，照片可能有孩子正臉，要人看過）。
- 多張照片的貼文全部搬（只取封面 `full_picture`；其他照片要另外在消息編輯器加）。
- 全站 `home_news`（只進各校消息）。
- 讀別人的粉專（只讀 Business Manager 裡五校自己的粉專，不需要 Page Public Content Access）。

**反目標**
- token 出現在 repo、日誌、錯誤訊息、操作紀錄、API 回應或前端。
- 後台使用者的瀏覽器直接向 Meta 載圖（會把員工 IP 交給 Meta，也要放寬後台 CSP）：縮圖一律經 API 代理。
- 引用 FB CDN 圖片網址當官網圖片（網址帶簽章，幾天後失效）。

## 3. 設定（環境變數，Railway Secrets）

| 變數 | 說明 |
|---|---|
| `WEBSITE_FACEBOOK_ACCESS_TOKEN` | Business Manager「系統使用者」token，權限 `pages_show_list`、`pages_read_engagement`、`pages_read_user_content`，指派到五校粉專。也接受單一粉專的長效 Page token（只設一校時；義華 11-10 起用這個，因為粉專不在任何 Business Manager 裡）。 |
| `WEBSITE_FACEBOOK_PAGES` | `校區=粉專ID` 逗號分隔，例 `yihua=1234567890,minghua=2345678901`。 |
| `WEBSITE_FACEBOOK_APP_SECRET` | 選填。App 開了「Require App Secret」時要設，請求會帶 `appsecret_proof`。 |
| `WEBSITE_FACEBOOK_GRAPH_VERSION` | 預設 `v27.0`（11-10 實測）。 |
| `WEBSITE_FACEBOOK_SYNC_SECONDS` | 預設 3600（600–86400）。 |

token 與粉專清單要一起設；只設一個拒絕啟動。都沒設＝功能關閉，後台頁面顯示「還沒接上」。

## 4. 同步

- `FacebookSyncLoop`（`app/workers/facebook_loop.py`）：API 程序內 asyncio task，比照 `GeoSyncLoop`，啟動 60 秒後第一輪，之後每 `facebook_sync_seconds`。CLI：`python -m app.cli facebook-sync [校區]`。後台可按「立即同步」（只同步該校）。
- 每校：先用系統使用者 token 換 Page token（`GET /{page}?fields=access_token`；設定的本來就是 Page token 時會回同一個，沒回就直接用設定的 token），再 `GET /{page}/published_posts?fields=id,message,created_time,permalink_url,full_picture&limit=25`。
- token 一律放 `Authorization: Bearer` header，不放網址：httpx 的 INFO 紀錄會印完整請求網址（11-10 實測抓到 token 因此進 log）。`appsecret_proof` 推不回 token，可以留在網址。
- 寫入用 `INSERT … ON CONFLICT (post_id) DO UPDATE`，只更新內文、照片網址、連結、抓取時間，不動處理狀態；同時跑兩次也不會出錯，所以不另外加鎖。
- 每校狀態記在 `facebook_page_sync`（最後嘗試、最後成功、最後錯誤）。錯誤只記 HTTP 狀態與 Meta 的錯誤代碼，不記回應內容。
- FB 上刪掉的貼文不會從收件匣消失（收件匣只是候選清單；已轉成的消息由人決定留不留）。

## 5. 轉成消息草稿

`POST /admin/facebook-posts/{id}/import`，權限 `content.manage`＋`media.manage`（該校）。

1. 貼文要是「未處理」或「略過」，沒有照片回 422（消息規定要有照片）。
2. 下載照片：只收 https、主機是 `fbcdn.net` 底下、不跟隨轉址、上限同圖片上傳（15 MB）。過期（403/404/410）回 409，請先「立即同步」。
3. 建素材（該校、`source_attribution="Facebook 粉專貼文"`）；同一張圖已在素材庫就沿用。
4. 該校 `campus_news` 最新一版加一則在最上面，走跟後台存草稿一樣的驗證（`content.routes._save_draft`）。消息已滿 12 則回 409。
5. 貼文標成「已轉成消息」，記下消息 id、素材 id、處理人；操作紀錄 `facebook_post.import`。

消息內容對照：

| 消息欄位 | 來源 |
|---|---|
| `id` | `fb-<貼文ID>` |
| `date` | 發文時間（台北日期） |
| `title` | 第一個去掉 emoji 與 hashtag 後還有字的行；拿掉 emoji，整行被【】包住就去掉外層括號；超過 40 字截斷加「…」（完整那行放回內文開頭）；沒有字就「粉專貼文」 |
| `description` | 其餘文字壓成一行，取前 120 字 |
| `body` | 其餘文字依空行分段（最多 38 段）＋「在 Facebook 看原文」連結。整行都是 hashtag（可夾 emoji）的行與行尾那串 hashtag 拿掉，句中的 hashtag 只去 `#` 留字；emoji 保留給人決定 |
| `image` | 新素材 id；`alt` 留空給人填 |

另有 `POST …/dismiss`、`POST …/restore`（略過／放回未處理），`GET /admin/facebook-posts?campus_key=&status=`（清單＋同步狀態），`GET …/{id}/picture`（縮圖代理，`content.read`）、`POST /admin/facebook-posts/sync?campus_key=`。

## 6. 上線前要做

1. 使用者在 Business Manager 建 App（類型「商家」）、系統使用者，把五校粉專指派給系統使用者，產生 token（勾 `pages_show_list`、`pages_read_engagement`，到期日選「永不」）。
2. 查五校粉專 ID。
3. 在 Railway 設好 §3 的變數再部署；部署後到後台按「立即同步」實測。

## 7. 2026-11-10 義華實測

- Meta 端：義華粉專（`ivy.kids.fb`，ID `146366255237690`）不在任何 Business Manager 裡，所以不能用系統使用者；改用 App「常春藤義華校」（開發模式）＋ Graph API Explorer → 延長成 60 天用戶權杖 → 換成「到期：永不」的 Page token。Meta 標「資料存取到期 2027-02-08」，到期前要重新授權（步驟在 `deploy/README.md`）。
- 真實資料：最近 25 則有 Reel（`added_video`，`full_picture` 是影片某一格）、相簿、6 則沒寫字的單張照片；文字幾乎都是「emoji＋【標題】＋emoji」開頭、結尾一整段 hashtag，所以改了 §5 的標題與內文規則。
- 本機獨立庫跑通：CLI 同步、後台「立即同步」、背景迴圈、轉成消息草稿（照片下載進素材庫）、已轉換狀態不被同步覆蓋；log 不含 token。
