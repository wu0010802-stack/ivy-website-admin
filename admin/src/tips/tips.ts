// 後台「使用小技巧」頁的內容（2026-11-10）：只收使用者不容易自己發現的功能——要按特定按鍵、
// 收在「更多」或篩選裡、只在某些狀態才出現、或螢幕夠寬才有的東西。一眼就看得到的主按鈕不寫。
// 一份通用版，每條標出哪些角色能用；頁面可以切成「只列我能用的」。
//
// 截圖由 tests/stack/admin-tips-shots.spec.ts 用 e2e 測試庫的假資料重拍，
// 再由 scripts/build-admin-tips-images.py 轉成 assets/tips/<image>.webp 與 manifest.json。
// 功能的畫面或文字改了，連同這裡的說明與截圖一起更新。
//
// steps 裡用反引號標按鍵：`mod+K` 在 Mac 顯示 ⌘K、其他系統顯示 Ctrl＋K。

import type { Role } from '../api/types'

export type TipSectionKey = 'find' | 'account' | 'visits' | 'sessions' | 'admissions' | 'content'

export interface TipSection {
  key: TipSectionKey
  title: string
}

export interface TipStep {
  text: string
  /** 只在這個部署開關打開時顯示這一句 */
  feature?: 'admissions'
}

export interface Tip {
  /** 也是頁內錨點（#tip-<id>） */
  id: string
  section: TipSectionKey
  title: string
  steps: (string | TipStep)[]
  /** 能用的角色；不寫代表所有登入者 */
  roles?: Role[]
  /** 共用內容：除了 roles，有「全站共用內容」授權的分校管理者與內容編輯也能用 */
  shared?: boolean
  /** 角色以外的條件或差別，接在角色後面顯示 */
  roleNote?: string
  /** 部署開關關閉時整條不列 */
  feature?: 'admissions'
  /** 「前往」連結；看不到那一頁的人不顯示 */
  to?: { path: string; query?: Record<string, string>; label: string }
  /** assets/tips/ 底下的截圖檔名（不含副檔名） */
  image?: string
  imageAlt?: string
}

export const TIP_SECTIONS: TipSection[] = [
  { key: 'find', title: '找功能與畫面' },
  { key: 'account', title: '帳號' },
  { key: 'visits', title: '參觀案件' },
  { key: 'sessions', title: '參觀場次' },
  { key: 'admissions', title: '招生入學' },
  { key: 'content', title: '官網內容' },
]

const SA: Role = 'super_admin'
const CA: Role = 'campus_admin'
const ED: Role = 'editor'
const RC: Role = 'reception'
const RO: Role = 'readonly'
const HANDLE: Role[] = [SA, CA, RC]
const MANAGE: Role[] = [SA, CA]
const EDIT: Role[] = [SA, CA, ED]

export const TIPS: Tip[] = [
  // ── 找功能與畫面 ──
  {
    id: 'search',
    section: 'find',
    title: '按 `mod+K` 直接搜尋功能',
    steps: [
      '在任何一頁按 `mod+K`，游標會跳到左上角的「搜尋功能」框。',
      '可以用自己的話搜，例如「密碼」「名額」「照片」「匯出」。按 `Enter` 直接打開第一筆。',
      '按 `↓` 到選單裡逐項挑，按 `Esc` 清掉搜尋字。',
    ],
    image: 'search',
    imageAlt: '側邊欄搜尋框輸入「名額」，列出參觀場次等結果，第一筆旁邊標著 Enter 符號',
  },
  {
    id: 'sidebar',
    section: 'find',
    title: '側邊欄可以收窄，分組可以收起來',
    steps: [
      '按側邊欄最上面 logo 右邊的收合鈕，側邊欄會縮成一排圖示，滑鼠停在圖示上看得到名稱；再按一次展開。',
      '「官網內容」「系統」這些分組，點標題就能展開或收起，下次打開會記得。',
    ],
    image: 'sidebar-rail',
    imageAlt: '收窄成一排圖示的側邊欄，滑鼠停在「參觀案件」圖示上顯示名稱',
  },
  {
    id: 'share-link',
    section: 'find',
    title: '網址可以直接傳給同事',
    steps: [
      '參觀案件的分頁與篩選、招生統計的子分頁、通知的「未讀」，都會寫進網址。',
      '把網址傳給同事，對方打開就是同一份清單；重新整理或按上一頁，也會回到原本的篩選。',
      '搜尋框打的姓名、電話不會寫進網址，傳出去不會帶到家長資料。',
    ],
  },

  // ── 帳號 ──
  {
    id: 'account',
    section: 'account',
    title: '改密碼、綁 Google／LINE、開手機通知：點側邊欄最下面的名字',
    steps: [
      '側邊欄最下面顯示你名字的地方可以點，會打開「我的帳號」。',
      '在那裡可以改顯示名稱和密碼、綁定 Google 或 LINE（之後在登入頁按一下就能登入），以及開啟手機通知。',
      'iPhone 要先在 Safari 按「分享」→「加入主畫面」，從主畫面打開後台，才能開手機通知。',
    ],
    roleNote: '手機通知只有處理參觀案件的帳號有',
    to: { path: '/account', label: '我的帳號' },
    image: 'account-entry',
    imageAlt: '側邊欄最下面的使用者區塊，顯示名字與角色',
  },
  {
    id: 'users-more',
    section: 'account',
    title: '幫同事重設密碼、停用帳號',
    steps: [
      '「使用者」頁每一位右邊有「重設密碼」：可以寄重設連結到對方信箱，或直接設定新密碼給對方。重設後，對方所有裝置都會登出。',
      '「停用帳號」「解除綁定並登出」收在「更多」裡。停用的帳號旁邊會出現「恢復」。',
    ],
    roles: [SA],
    to: { path: '/users', label: '使用者' },
    image: 'users-more',
    imageAlt: '使用者列表一列的「更多」選單展開，列出解除綁定並登出、停用帳號',
  },

  // ── 參觀案件 ──
  {
    id: 'preview',
    section: 'visits',
    title: '寬螢幕點案件，右邊直接預覽',
    steps: [
      '螢幕夠寬時（約 1280 像素以上），在參觀案件點一列，右邊會出現預覽，可以直接記聯絡紀錄、標記到場、按「下一筆」。',
      '想開完整的案件頁：按住 `mod` 再點，或用滑鼠中鍵點，會在新分頁打開。',
      '筆電螢幕比較窄時，點一列會直接換到案件頁。',
    ],
    roles: HANDLE,
    to: { path: '/visit-requests', label: '參觀案件' },
    image: 'visit-preview',
    imageAlt: '參觀案件列表點選一列後，右側出現該案件的預覽面板',
  },
  {
    id: 'filters',
    section: 'visits',
    title: '更多條件都在「更多篩選」裡',
    steps: [
      '排序、預約來源、送出日期，以及「只看尚未確認到場」「到期待追蹤」「隱藏已排除」等條件，都收在搜尋框旁的「更多篩選」。',
      '收起後，套用中的條件會排成一列標籤，按標籤上的 × 可以單獨拿掉。',
    ],
    roles: HANDLE,
    to: { path: '/visit-requests', label: '參觀案件' },
    image: 'visit-filters',
    imageAlt: '參觀案件搜尋框下方的條件標籤列，每個標籤都有移除按鈕',
  },
  {
    id: 'batch-attend',
    section: 'visits',
    title: '一次標記好幾組到場或沒來',
    steps: [
      '在「更多篩選」勾「只看尚未確認到場」，每一列前面才會出現勾選框。',
      '勾好後按「標記已到場」或「標記沒來」，會一筆一筆送出，沒成功的會列在上面。',
      '總覽的「參觀時間過了，還沒標記到場」點進來，也是這個畫面。',
    ],
    roles: HANDLE,
    to: { path: '/visit-requests', query: { group: 'past', status: 'confirmed' }, label: '時間已過、還沒標記的案件' },
    image: 'visit-batch',
    imageAlt: '參觀案件列表勾選兩筆，上方出現「2 位標記已到場」與「標記沒來」按鈕',
  },
  {
    id: 'attend-inline',
    section: 'visits',
    title: '不用點進案件，列表和總覽就能按「到了」「沒來」',
    steps: [
      '場次開始後，參觀案件列表和營運總覽「今天的參觀」的每一列，都會出現「到了」「沒來」。場次還沒開始時不會出現。',
      { text: '按「到了」之後會直接打開招生資料表單，可以當場填，也可以按「之後再填」。已到場的列會多一顆「填招生資料」。', feature: 'admissions' },
    ],
    roles: HANDLE,
    to: { path: '/', label: '營運總覽' },
    image: 'dashboard-today',
    imageAlt: '營運總覽「今天的參觀」名單，進行中的一列旁邊有「到了」「沒來」按鈕',
  },
  {
    id: 'early',
    section: 'visits',
    title: '家長比預約時間早到：按「家長提早到了」',
    steps: [
      '場次還沒開始時，案件頁上方不會有「到了」，只有一顆淡色的「家長提早到了」。',
      '按下去就記成今天已到場；原本約在之後日子的，那一場的名額會空出來給別人約。',
    ],
    roles: HANDLE,
    image: 'visit-early',
    imageAlt: '案件頁上方的「家長提早到了」按鈕',
  },
  {
    id: 'notes',
    section: 'visits',
    title: '記聯絡紀錄更快的幾個方法',
    steps: [
      '輸入框上方的片語點一下，就會接在內容後面。片語由總管理者在「聯絡片語」設定。',
      '打完按 `mod+Enter` 直接送出。',
      '「下次聯絡」的日期選單左邊有「明天 10:00」「3 天後」「下週一」可以直接點。',
      '還沒送出就離開，回到同一筆案件時內容還在（只留在這個瀏覽器分頁）。',
    ],
    roles: HANDLE,
    image: 'visit-notes',
    imageAlt: '聯絡紀錄輸入框，上方一排片語按鈕，下方提示可按 Command 加 Enter 送出',
  },
  {
    id: 'next',
    section: 'visits',
    title: '處理完一筆，按「下一筆」接著做',
    steps: [
      '案件頁右上角的「下一筆」會照你剛才那份列表的篩選和順序往下，旁邊寫著還剩幾件。',
      '從總覽直接點進來時，會先排待標記到場的，再排到期要追蹤的。',
    ],
    roles: HANDLE,
    image: 'visit-next',
    imageAlt: '案件頁右上角的「下一筆」按鈕與剩餘件數',
  },
  {
    id: 'slot-card',
    section: 'visits',
    title: '改場次、取消預約、家長連結，都在「場次」卡裡',
    steps: [
      '預約正常的案件，右邊「場次」卡有「改到其他場次…」小字連結；改好後原本那場的名額會空出來。',
      '同一張卡可以產生或重寄家長自己改期、取消用的連結。',
      '「取消預約」在卡片最下面。家長沒來請用「標記未到場」，不要用取消。',
      '已取消或沒來的案件，上方會換成「重新預約（另建新案）」。',
    ],
    roles: HANDLE,
    image: 'visit-slot-card',
    imageAlt: '案件頁右側的場次卡，有改到其他場次、家長管理連結與取消預約',
  },
  {
    id: 'exclude',
    section: 'visits',
    title: '測試或重複的案件可以排除，不算進統計',
    steps: [
      '案件頁右邊最下面有「標記為排除（測試或重複）…」小字連結，選原因後送出。',
      '排除的案件不算進總覽與統計，也不會寄提醒；案件頁上方的橫幅可以「取消排除」。',
      '列表的「更多篩選」可以勾「隱藏已排除」。',
    ],
    roles: MANAGE,
    image: 'visit-exclude',
    imageAlt: '案件頁右側最下方的「標記為排除（測試或重複）…」連結',
  },
  {
    id: 'notifications',
    section: 'visits',
    title: '站內通知點一下就打開案件',
    steps: [
      '點通知那一列會直接打開案件，同時標成已讀。',
      '已讀是同一校共用的：校區管理者以上點開、或按「標記已讀」才算數；櫃台點開不會改變已讀狀態。',
    ],
    roles: HANDLE,
    to: { path: '/notifications', label: '站內通知' },
    image: 'notifications',
    imageAlt: '站內通知清單，未讀的通知前面有圓點，每列右邊有標記已讀',
  },
  {
    id: 'export',
    section: 'visits',
    title: '「匯出 CSV」匯出的是篩選後的全部結果',
    steps: [
      '參觀案件、訪視明細、操作紀錄的「匯出 CSV」，匯出的是目前篩選條件下的全部資料，不只畫面上這一頁。',
      '用 Excel 直接打開不會亂碼，手機號碼前面的 0 也會保留。',
      '看不到這顆按鈕，代表帳號還沒有匯出個資的權限，請總管理者在「使用者」開。',
    ],
    roles: HANDLE,
    roleNote: '總管理者以外要另外授權',
    to: { path: '/visit-requests', label: '參觀案件' },
    image: 'visit-export',
    imageAlt: '參觀案件頁首的「匯出 CSV」按鈕與匯出範圍說明',
  },

  // ── 參觀場次 ──
  {
    id: 'calendar-day',
    section: 'sessions',
    title: '接待月曆要先點日期，才會出現休假、名額、加開',
    steps: [
      '在參觀場次的月曆點某一天，下面才會出現那天的操作：整天休假、每場名額、停止申請、恢復開放、＋加開一場。',
      '休假那天如果已經有家長約了，會多一顆「寄停課通知」。',
      '櫃台點日期，看得到當天有誰要來。',
    ],
    roles: HANDLE,
    roleNote: '休假、名額、加開只有總管理者與校區管理者能改',
    to: { path: '/visit-calendar', label: '參觀場次' },
    image: 'calendar-day',
    imageAlt: '接待月曆點選某一天後，下方出現當天每一場的名額、停止申請與加開一場',
  },
  {
    id: 'closure',
    section: 'sessions',
    title: '颱風停課、國定假日一次處理',
    steps: [
      '月曆上方的「停班停課」選好日期與校區，會一次關掉那天的場次，並寄信請已約的家長改約。',
      '「匯入國定假日」從政府資料開放平台抓今年的假日，勾選後一次設成休假。',
      '「每週固定場次」卡裡展開「進階設定」，可以改每場多長、家長最晚多久前要約、最遠能約多久以後。',
    ],
    roles: MANAGE,
    to: { path: '/visit-calendar', label: '參觀場次' },
    image: 'calendar-tools',
    imageAlt: '接待月曆上方的「停班停課」與「匯入國定假日」按鈕',
  },
  {
    id: 'slot-usage',
    section: 'sessions',
    title: '看哪些時段常額滿：「場次使用情況」',
    steps: [
      '參觀場次頁上方第二個分頁「場次使用情況」，列出家長最早能約到哪天、每個時段平均坐了幾成。',
      '常額滿或很少人約的時段會標出來，可以拿來決定要不要加開或減少。',
    ],
    roles: HANDLE,
    to: { path: '/visit-calendar', query: { tab: 'usage' }, label: '場次使用情況' },
    image: 'slot-usage',
    imageAlt: '參觀場次頁上方的「接待月曆」「場次使用情況」兩個分頁',
  },

  // ── 招生入學 ──
  {
    id: 'funnel-move',
    section: 'admissions',
    title: '看板卡片可以拖到別欄，或用「移到…」',
    steps: [
      '在漏斗看板把滑鼠移到卡片上，右上角會出現「移到…」；也可以直接把卡片拖到另一欄，放開後會再確認一次。',
      '看板上方的預繳率、註冊率，滑鼠停在上面會顯示怎麼算的。',
    ],
    roles: HANDLE,
    roleNote: '註冊與退註冊只有總管理者與校區管理者能做',
    feature: 'admissions',
    to: { path: '/admissions', label: '招生入學' },
    image: 'funnel-move',
    imageAlt: '漏斗看板的一張卡片，滑鼠移上去後右上角出現「移到…」',
  },
  {
    id: 'journey',
    section: 'admissions',
    title: '點卡片或孩子姓名，看從參觀到入學的經過',
    steps: [
      '看板上的卡片、訪視明細裡的孩子姓名都可以點：從官網預約來的，會打開那筆預約的案件頁；其他的在右邊打開歷程。',
      '兩個地方都可以直接記錄聯絡、排下次聯絡、換負責人。',
    ],
    roles: HANDLE,
    feature: 'admissions',
    to: { path: '/admissions', label: '招生入學' },
    image: 'journey',
    imageAlt: '右側打開的「參觀到入學」歷程，上方有記錄聯絡與排下次聯絡',
  },
  {
    id: 'records-more',
    section: 'admissions',
    title: '訪視明細：展開看地址與備註，「更多」裡有編輯與退費',
    steps: [
      '表格最左邊的 ▶ 可以展開，看到地址、家長介紹、備註；手機版是「其他資料」。',
      '每一列只放一顆主要按鈕；「編輯」「保留座位」「退預繳」「退註冊」「刪除」都在「更多」裡，依這筆資料的階段出現。',
    ],
    roles: HANDLE,
    feature: 'admissions',
    to: { path: '/admissions', query: { tab: 'records' }, label: '訪視明細' },
    image: 'records-more',
    imageAlt: '訪視明細一列的「更多」選單展開，列出編輯、保留座位、退預繳',
  },
  {
    id: 'stats-drill',
    section: 'admissions',
    title: '招生統計的數字可以點進明細',
    steps: [
      '招生統計各表最後一欄的「查看明細」，會帶著月份、區域或原因，打開招生入學的訪視明細。',
      '每張表右上角有「匯出 CSV」；展開「這些數字怎麼算」可以看算法。',
    ],
    roles: [SA],
    feature: 'admissions',
    to: { path: '/admissions-stats', label: '招生統計' },
  },

  // ── 官網內容 ──
  {
    id: 'live-preview',
    section: 'content',
    title: '寬螢幕編輯：左邊段落目錄，右邊即時預覽',
    steps: [
      '螢幕約 1280 像素以上時，內容編輯頁右邊會出現官網預覽，還沒存的修改也會馬上反映。預覽上方可以切換手機或桌機寬度。',
      '長頁面左邊有段落目錄，點一下跳到那一段；改過的段落旁邊會有圓點。',
      '螢幕比較窄時，用狀態列的「存草稿並預覽 ↗」在新分頁看。',
    ],
    roles: [SA, CA, ED, RO],
    roleNote: '唯讀帳號只能看',
    to: { path: '/content/campus-news', label: '各校消息與活動' },
    image: 'live-preview',
    imageAlt: '內容編輯頁三欄：左邊段落目錄、中間表單、右邊官網手機版預覽',
  },
  {
    id: 'history',
    section: 'content',
    title: '改錯了？用「版本紀錄」還原',
    steps: [
      '編輯頁狀態列的「版本紀錄」列出每一次儲存；點一版，會先列出還原後哪些欄位會變。',
      '可以「還原成草稿」再檢查，或直接「還原並發布」。還原會新增一版，原本的紀錄都還在。',
    ],
    roles: EDIT,
    roleNote: '還原並發布只有總管理者與校區管理者能做',
    image: 'history',
    imageAlt: '版本紀錄抽屜，選一版後列出還原後會改變的欄位，下方有還原成草稿與還原並發布',
  },
  {
    id: 'schedule',
    section: 'content',
    title: '排程發布：指定時間自動上線',
    steps: [
      '動作列「發布」左邊的「排程發布」，選好時間，到時候會自動發布。',
      '排好後編輯頁上方會寫什麼時候發布，可以「取消排程」；全站的排程在「發布紀錄」的「排程發布」看得到。',
    ],
    roles: MANAGE,
    image: 'schedule',
    imageAlt: '編輯頁上方的排程提示「已排定自動發布」與「取消排程」',
  },
  {
    id: 'review',
    section: 'content',
    title: '內容編輯改好送審，校區管理者核准才上線',
    steps: [
      '內容編輯的帳號只有「儲存並送審」。送出後，校區管理者與總管理者會在總覽的「內容等你審核」看到。',
      '校區管理者打開同一頁，按鈕會換成「退回」（要寫原因）和「核准並發布」。',
      '退回或核准後，送審的人頁首會出現「內容通知未讀」，點進去是發布紀錄。',
    ],
    roles: EDIT,
    image: 'review',
    imageAlt: '校區管理者打開待審內容，動作列有「退回」與「核准並發布」',
  },
  {
    id: 'news-dates',
    section: 'content',
    title: '消息可以先排好上架、下架日期',
    steps: [
      '最新消息與活動、各校消息每一則展開後，最下面有「上架日期」「下架日期」；時間到會自動出現或隱藏，不用再按發布。',
      '全站消息勾「首頁推薦」的才會放首頁，照清單順序排；一則都沒勾就照日期放。',
      '清單上方的「全部展開」「全部收合」可以一次打開或收起所有消息。',
    ],
    roles: EDIT,
    to: { path: '/content/campus-news', label: '各校消息與活動' },
    image: 'news-dates',
    imageAlt: '一則消息展開後最下方的上架日期與下架日期欄位',
  },
  {
    id: 'custom',
    section: 'content',
    title: '找不到欄位？先按「改成自訂」',
    steps: [
      '家長影片、首頁手機活動影片、機構社群連結這幾處，預設用官網內建的內容，要先按「改成自訂」，才會出現可以改的欄位。',
      '「恢復內建」會清掉自訂的內容，按之前會再確認一次。',
    ],
    roles: EDIT,
    to: { path: '/content/campus-profile', label: '五校介紹' },
    image: 'custom',
    imageAlt: '五校介紹的家長影片區塊，寫著目前用官網內建影片，旁邊有「改成自訂」按鈕',
  },
  {
    id: 'focus',
    section: 'content',
    title: '照片要保留哪裡，點一下或用方向鍵調',
    steps: [
      '素材庫的「編輯」和各頁的照片欄位都有「裁切焦點」方塊，點照片上要保留的位置就好。',
      '點一下方塊後，可以用方向鍵微調，按住 `Shift` 一次移 10%。',
    ],
    roles: EDIT,
    to: { path: '/media', label: '素材庫' },
    image: 'focus',
    imageAlt: '素材編輯視窗裡的裁切焦點方塊，照片上有一個十字焦點',
  },
  {
    id: 'picker-upload',
    section: 'content',
    title: '選照片時可以直接上傳新的',
    steps: [
      '編輯頁按「從素材庫選照片」，視窗右上角有「上傳新照片」，不用先跑去素材庫。',
      '在這裡上傳的照片，會自動標成這一校（或全站共用）。',
    ],
    roles: EDIT,
    image: 'picker-upload',
    imageAlt: '選照片視窗右上角的「上傳新照片」按鈕',
  },
  {
    id: 'media-more',
    section: 'content',
    title: '替換、封存、刪除照片在「更多」裡',
    steps: [
      '素材庫每張卡片的「更多」裡有替換、封存、刪除。',
      '替換時可以勾要換掉哪些地方，換好只會變成草稿，確認後再發布。',
      '還在使用的照片不能刪，會直接列出用在哪裡；刪掉的照片在上方「待清理」裡，保留期間內可以復原。',
    ],
    roles: EDIT,
    to: { path: '/media', label: '素材庫' },
    image: 'media-more',
    imageAlt: '素材卡片的「更多」選單展開，列出替換、封存、刪除',
  },
  {
    id: 'title-break',
    section: 'content',
    title: '標題要在哪裡換行，直接按 `Enter`',
    steps: [
      '特色教學頁、關於常春藤頁、常春藤環境頁的標題欄位，按 `Enter` 會在官網上的同一個位置換行，最多三行。',
    ],
    roles: [SA],
    shared: true,
    roleNote: '或有全站共用內容授權的帳號',
    to: { path: '/content/curriculum-page', label: '特色教學頁' },
    image: 'title-break',
    imageAlt: '特色教學頁的標題欄位，文字分成兩行',
  },
  {
    id: 'release-restore',
    section: 'content',
    title: '整個官網退回某一次發布',
    steps: [
      '發布紀錄每一筆右下角有灰色的「整站還原到這次」。按下去會先列出哪些內容會換回去，確認後才執行。',
    ],
    roles: [SA],
    to: { path: '/releases', label: '發布紀錄' },
    image: 'release-restore',
    imageAlt: '發布紀錄一筆紀錄右下角的「整站還原到這次」',
  },
]

/** `mod+K` → ⌘K（Mac）或 Ctrl＋K。只換 mod，其他按鍵照寫。 */
export function formatKey(key: string, apple: boolean): string {
  return key.replace(/mod\+?/g, apple ? '⌘' : 'Ctrl＋')
}

export type TextPart = { kind: 'text' | 'key'; value: string }

/** 把反引號包住的按鍵拆出來，畫成 <kbd>；不用 v-html。 */
export function splitKeys(text: string, apple: boolean): TextPart[] {
  return text.split('`').map((value, index) =>
    index % 2 === 1 ? { kind: 'key' as const, value: formatKey(value, apple) } : { kind: 'text' as const, value },
  ).filter(part => part.value !== '')
}

export function stepText(step: string | TipStep): string {
  return typeof step === 'string' ? step : step.text
}

export const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** 角色顯示順序：由權限大到小。 */
export const TIP_ROLE_ORDER: Role[] = [SA, CA, ED, RC, RO]
