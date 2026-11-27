// 後台「使用小技巧」頁的內容（2026-11-10）：只收使用者不容易自己發現的功能——要按特定按鍵、
// 收在「更多」或篩選裡、只在某些狀態才出現、或螢幕夠寬才有的東西。一眼就看得到的主按鈕不寫。
// 一份通用版，每條標出哪些角色能用；頁面可以切成「只列我能用的」。
//
// 截圖由 tests/stack/admin-tips-shots.spec.ts 用 e2e 測試庫的假資料重拍，
// 再由 scripts/build-admin-tips-images.py 轉成 assets/tips/<image>.webp 與 manifest.json。
// 功能的畫面或文字改了，連同這裡的說明與截圖一起更新。
//
// steps 裡用反引號標按鍵：`mod+K` 在 Mac 顯示 ⌘K、其他系統顯示 Ctrl＋K。
//
// keywords（2026-11-26）：同事會打、但標題與步驟沒寫到的說法（「圖片」「颱風假」「改時間」），只給這一頁的搜尋用。
// 標題或步驟已經有的字不用再列（tips.test.ts 會擋）；有寫按鍵的條目自動多收「快捷鍵」「鍵盤」。

import type { Role } from '../api/types'

export type TipSectionKey = 'find' | 'account' | 'visits' | 'sessions' | 'admissions' | 'content' | 'system'

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
  /** 只給搜尋用、畫面上不顯示的說法：同事會打、但標題與步驟沒寫到的字（「圖片」「颱風假」「改時間」） */
  keywords?: string[]
}

export const TIP_SECTIONS: TipSection[] = [
  { key: 'find', title: '找功能與畫面' },
  { key: 'account', title: '帳號' },
  { key: 'visits', title: '參觀案件' },
  { key: 'sessions', title: '參觀場次' },
  { key: 'admissions', title: '招生入學' },
  { key: 'content', title: '官網內容' },
  { key: 'system', title: '統計與系統' },
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
    imageAlt: '側邊欄搜尋框輸入「名額」，列出參觀場次，旁邊標著 Enter 符號',
    keywords: ['找功能', '找頁面'],
  },
  {
    id: 'sidebar',
    section: 'find',
    title: '側邊欄可以收窄，分組可以收起來',
    steps: [
      '按側邊欄最上面 logo 右邊的收合鈕，側邊欄會縮成一排圖示，滑鼠停在圖示上看得到名稱；再按一次展開。',
      '「參觀預約」「首頁」「各分頁」「各校」「全站共用」「系統」這些分組，點標題就能展開或收起，下次打開會記得。',
    ],
    image: 'sidebar-rail',
    imageAlt: '收窄成一排圖示的側邊欄，滑鼠停在「參觀案件」圖示上顯示名稱',
    keywords: ['選單', '左邊', '摺疊'],
  },
  {
    id: 'share-link',
    section: 'find',
    title: '網址可以直接傳給同事',
    steps: [
      '參觀案件的分頁與篩選、招生統計的子分頁與區域分析看的地方、成效統計的分類與期間、通知的「未讀」，都會寫進網址。',
      '把網址傳給同事，對方打開就是同一份清單；重新整理或按上一頁，也會回到原本的篩選。',
      '搜尋框打的姓名、電話不會寫進網址，傳出去不會帶到家長資料。',
    ],
    keywords: ['分享', '連結', '書籤', '複製'],
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
      '開好後按「傳送測試通知」試一次。「我的裝置」列出開過通知的每一台，換手機後把舊的「移除」。',
    ],
    roleNote: '手機通知只有處理參觀案件的帳號有',
    to: { path: '/account', label: '我的帳號' },
    image: 'account-entry',
    imageAlt: '側邊欄最下面的使用者區塊，顯示名字與角色',
    keywords: ['推播', '個人資料', '改名字'],
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
    keywords: ['忘記密碼', '離職', '刪除帳號', '鎖定'],
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
    keywords: ['快速查看', '新視窗'],
  },
  {
    id: 'filters',
    section: 'visits',
    title: '更多條件都在「更多篩選」裡',
    steps: [
      '排序、來源、送出日期，以及「只看尚未確認到場」「到期待追蹤」「隱藏已排除」等條件，都收在搜尋框旁的「更多篩選」。',
      '收起後，套用中的條件會排成一列標籤，按標籤上的 × 可以單獨拿掉。',
    ],
    roles: HANDLE,
    to: { path: '/visit-requests', label: '參觀案件' },
    image: 'visit-filters',
    imageAlt: '參觀案件搜尋框下方的條件標籤列，每個標籤都有移除按鈕',
    keywords: ['過濾', '找不到案件'],
  },
  {
    id: 'batch-attend',
    section: 'visits',
    title: '一次標記好幾組到場或沒來',
    steps: [
      '在「更多篩選」勾「只看尚未確認到場」，每一列前面才會出現勾選框。',
      '勾好後按上方的「○ 位標記已到場」或「標記沒來」，會一筆一筆送出，沒成功的會列在上面。',
      '總覽的「參觀時間過了，還沒標記到場」點進來，也是這個畫面。',
    ],
    roles: HANDLE,
    to: { path: '/visit-requests', query: { group: 'past', status: 'confirmed' }, label: '時間已過、還沒標記的案件' },
    image: 'visit-batch',
    imageAlt: '參觀案件列表勾選兩筆，上方出現「2 位標記已到場」與「標記沒來」按鈕',
    keywords: ['批次', '多選', '全選', '報到', '出席'],
  },
  {
    id: 'attend-inline',
    section: 'visits',
    title: '不用點進案件，列表和總覽就能按「到了」「沒來」',
    steps: [
      '場次開始後，參觀案件列表和營運總覽「今天的參觀」的每一列，都會出現「到了」「沒來」。場次還沒開始時不會出現。',
      { text: '按「到了」之後會直接打開招生資料表單，可以當場填，也可以按「之後再填」。參觀案件列表裡已到場的列，會多一顆「填招生資料」。', feature: 'admissions' },
    ],
    roles: HANDLE,
    to: { path: '/', label: '營運總覽' },
    image: 'dashboard-today',
    imageAlt: '營運總覽「今天的參觀」名單，進行中的一列旁邊有「到了」「沒來」按鈕',
    keywords: ['報到', '出席', '簽到', '未到'],
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
    keywords: ['提前'],
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
    keywords: ['備註', '追蹤', '草稿', '提醒'],
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
    keywords: ['下一個', '連續處理'],
  },
  {
    id: 'slot-card',
    section: 'visits',
    title: '改場次、取消預約、家長連結，都在案件頁右邊',
    steps: [
      '預約正常的案件，案件頁右邊有「改到其他場次…」小字連結；改好後原本那場的名額會空出來。',
      '同一區可以產生或重寄家長自己改期、取消用的連結。',
      '「取消預約」在這一區最下面。家長沒來請用「標記未到場」，不要用取消。',
      '已取消或沒來的案件，上方會換成「重新預約（另建新案）」。',
    ],
    roles: HANDLE,
    image: 'visit-slot-card',
    imageAlt: '案件頁右側的改場次、家長管理連結與取消預約',
    keywords: ['改時間', '換時間', '改約', '重約'],
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
    keywords: ['刪除案件', '不計入', '假資料'],
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
    keywords: ['鈴鐺', '未讀', '提醒'],
  },
  {
    id: 'export',
    section: 'visits',
    title: '「匯出 CSV」匯出的是篩選後的全部結果',
    steps: [
      '參觀案件、訪視明細、操作紀錄的「匯出 CSV」，匯出的是目前篩選條件下的全部資料，不只畫面上這一頁。',
      '用 Excel 直接打開不會亂碼，手機號碼前面的 0 也會保留。',
      '參觀案件、訪視明細看不到這顆按鈕，代表帳號還沒有匯出個資的權限，請總管理者在「使用者」開。操作紀錄要先選一個校區才能匯出。',
    ],
    roles: HANDLE,
    roleNote: '總管理者以外要另外授權',
    to: { path: '/visit-requests', label: '參觀案件' },
    image: 'visit-export',
    imageAlt: '參觀案件頁首的「匯出 CSV」按鈕與匯出範圍說明',
    keywords: ['下載', '報表', '名單', '試算表'],
  },

  {
    id: 'meta-leads',
    section: 'visits',
    title: '廣告名單：略過的可以放回，轉成案件後要到案件頁看',
    steps: [
      '名單分成「新名單」「已轉案件」「已略過」三疊，預設只看新名單；按錯「略過」，到「已略過」那一疊按「放回」。',
      '「轉成參觀案件」之後，家長的姓名、電話搬到案件裡，這裡不再保留，只留「到案件頁」連結。',
      '名單會定時自動同步；剛投的廣告想馬上看，按右上角的「立即同步」。這顆只有該校接上 Meta 廣告後才有。',
    ],
    roles: HANDLE,
    to: { path: '/meta-leads', label: '廣告名單' },
    keywords: ['Facebook', 'Instagram', '名單型廣告', '潛在顧客', '表單'],
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
    keywords: ['請假', '放假', '人數', '額滿', '關閉場次'],
  },
  {
    id: 'closure',
    section: 'sessions',
    title: '颱風停課、國定假日一次處理',
    steps: [
      '月曆上方的「停班停課」選好日期與校區，會一次關掉那天的場次，並寄信請已約的家長改約。',
      '「匯入國定假日」從政府資料開放平台抓今年的假日，勾選後一次設成休假。',
      '「每週固定場次」卡按「修改場次」，再展開「進階設定」，可以改「每場參觀約多久」「家長最晚何時預約」「最多可預約多久以後」。',
    ],
    roles: MANAGE,
    to: { path: '/visit-calendar', label: '參觀場次' },
    image: 'calendar-tools',
    imageAlt: '接待月曆上方的「停班停課」與「匯入國定假日」按鈕',
    keywords: ['颱風假', '放假', '連假', '天災'],
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
    keywords: ['統計', '熱門'],
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
    keywords: ['階段', '拖曳', '拖拉'],
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
    keywords: ['追蹤'],
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
    keywords: ['退款', '修改', '保留名額'],
  },
  {
    id: 'stats-drill',
    section: 'admissions',
    title: '招生統計的數字可以點進明細',
    steps: [
      '「未預繳與退出原因」的原因表、區域分析的行政區與各里表，最後一欄有「查看明細」，會帶著原因或區域打開招生入學的訪視明細。',
      '每張表右上角有「匯出 CSV」；展開「這些數字怎麼算」可以看算法。',
    ],
    roles: [SA],
    feature: 'admissions',
    to: { path: '/admissions-stats', label: '招生統計' },
    keywords: ['報表', '下載'],
  },

  {
    id: 'roster-drag',
    section: 'admissions',
    title: '編班表：姓名直接拖到別班，拖錯了按「復原」',
    steps: [
      '招生入學的「編班與缺額」分頁，姓名可以拖到別班，或在同一班上下拖動調整順序。',
      '放開後會出現「已移動　復原」，幾秒內按「復原」就回到原本的位置。',
      '在籍的幼生不能拖回「還沒編班」；要離園，點姓名選「離園」。',
    ],
    roles: HANDLE,
    feature: 'admissions',
    to: { path: '/admissions', query: { tab: 'roster' }, label: '編班與缺額' },
    keywords: ['拖曳', '拖拉', '換班', '分班', '排班'],
  },
  {
    id: 'roster-cells',
    section: 'admissions',
    title: '編班表：點姓名有更多操作，空白格可以一次貼上整欄姓名',
    steps: [
      '點姓名會打開這位幼生的選單：「已入園」「編輯資料」「移到其他班級」「放回還沒編班」，以及紅字的「退預繳」或「離園」。不方便拖拉的裝置用「移到其他班級」。',
      '點每一班最後一格空白，輸入姓名按 `Enter` 就新增一位，接著停在下一格；從 Excel 複製一整欄姓名貼上，會一次新增好幾位。',
      '缺額統計的「統計日期」旁有「9/15 結算日」「3/15 結算日」可以直接跳過去；「存成結算紀錄」會把當下的數字留一份，之後改名單不會改到它。',
    ],
    roles: HANDLE,
    feature: 'admissions',
    to: { path: '/admissions', query: { tab: 'roster' }, label: '編班與缺額' },
    keywords: ['新生', '轉班', '快照', '批次'],
  },
  {
    id: 'no-deposit',
    section: 'admissions',
    title: '未預繳名單預設只列高潛力；上面的三個數字可以點',
    steps: [
      '招生統計「未預繳與退出原因」下方的名單，「轉換潛力」預設是高潛力，所以名單人數會比上面的原因表少。要看全部，把「轉換潛力」改成「全部潛力」，或在空白時按「改看全部潛力」。',
      '上方「高潛力未預繳」「逾 14 天待追」「冷名單」三個數字可以點，會把名單篩成那一批並捲過去。',
    ],
    roles: [SA],
    feature: 'admissions',
    to: { path: '/admissions-stats', query: { sub: 'nodeposit' }, label: '未預繳與退出原因' },
    keywords: ['沒預繳', '追蹤', '數字對不起來'],
  },
  {
    id: 'area-map',
    section: 'admissions',
    title: '區域分析：點地圖上的里看細節，手機要先按「移動地圖」',
    steps: [
      '工具列「看什麼」切換地圖上色的依據；灰掉不能選的，原因寫在工具列下一行。',
      '點地圖上的一個里，右邊會打開那個里的資料；桌機滑鼠停在里上會顯示里名。',
      '地圖下方有「幼兒園」「托嬰中心」兩個開關，可以把附近的園所標在地圖上。',
      '手機上地圖平常不會被手指拖走，要先按地圖上的「移動地圖」才能拖曳、縮放，看完按「完成」。',
      '看的校區、模式、選的里都寫在網址裡，傳給同事打開就是同一個畫面。',
    ],
    roles: [SA],
    feature: 'admissions',
    to: { path: '/admissions-stats', query: { sub: 'area' }, label: '區域分析' },
    keywords: ['同業', '人口', '建案', '學區', '周邊'],
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
    keywords: ['手機版', '電腦版'],
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
    keywords: ['復原', '回復', '救回', '舊版', '上一版'],
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
    keywords: ['預約發布'],
  },
  {
    id: 'review',
    section: 'content',
    title: '內容編輯改好送審，校區管理者核准才上線',
    steps: [
      '內容編輯的帳號沒有「發布」，只有「送審」（改了還沒存時是「儲存並送審」）。送出後，校區管理者與總管理者會在總覽的「內容等你審核」看到。',
      '校區管理者打開同一頁，按鈕會換成「退回」（要寫原因）和「核准並發布」。',
      '退回或核准後，送審的人頁首會出現「內容通知未讀」，點進去是發布紀錄。',
    ],
    roles: EDIT,
    image: 'review',
    imageAlt: '校區管理者打開待審內容，動作列有「退回」與「核准並發布」',
    keywords: ['審稿', '駁回', '通過'],
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
    keywords: ['公告', '置頂', '過期', '定時'],
  },
  {
    id: 'custom',
    section: 'content',
    title: '找不到欄位？先按「改成自訂」',
    steps: [
      '五校介紹的「家長分享影片」預設用官網內建的影片，要先按「改成自訂」，才會出現可以改的欄位；「恢復內建」會清掉自訂的內容，按之前會再確認一次。',
      '總管理者另有兩處同樣的設計：「網站標題與電話」的機構社群連結（「改成自訂（帶入內建）」），以及「首頁 → 最新消息與活動」的手機活動影片（打開「自訂影片清單」）。',
    ],
    roles: EDIT,
    to: { path: '/content/campus-profile', label: '五校介紹' },
    image: 'custom',
    imageAlt: '五校介紹的家長影片區塊，寫著目前用官網內建影片，旁邊有「改成自訂」按鈕',
    keywords: ['FB', 'IG', '臉書', 'YouTube'],
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
    keywords: ['圖片', '相片', '裁剪', '構圖'],
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
    keywords: ['圖片', '相片', '新增照片'],
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
    keywords: ['圖片', '相片', '換圖', '垃圾桶'],
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
    keywords: ['斷行', '分行', '折行'],
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
    keywords: ['復原', '回復', '救回', '版本'],
  },
  {
    id: 'facebook-posts',
    section: 'content',
    title: 'Facebook 貼文轉成消息後，官網還看不到',
    steps: [
      '「轉成消息草稿」只會在「各校消息與活動」加一則草稿；上方綠色提示的「去檢查並發布」帶你過去，看過再發布（內容編輯是送審）。',
      '貼文有影片時，影片轉檔要幾分鐘，轉好才能發布；沒帶進來的會寫原因。沒有照片的貼文不能轉。',
      '按錯「略過」的，到「已略過」那一疊按「放回未處理」。',
    ],
    roles: EDIT,
    to: { path: '/content/facebook-posts', label: 'Facebook 貼文' },
    keywords: ['FB', '粉專', 'IG', 'Instagram', '匯入'],
  },
  {
    id: 'site-switches',
    section: 'content',
    title: '最新消息、入學資訊分頁、30 週年的開關，發布後才生效',
    steps: [
      '「網站標題與電話」裡的「在官網顯示最新消息」「在官網顯示入學資訊分頁」「在官網顯示 30 週年內容」，切了之後要按發布，官網才會變。',
      '關掉時連主選單、頁尾的連結一起拿掉；後台照常可以編輯那幾頁的內容，再打開並發布就回來。',
    ],
    roles: [SA],
    shared: true,
    roleNote: '或有全站共用內容授權的帳號',
    to: { path: '/content/site-meta', label: '網站標題與電話' },
    image: 'site-switches',
    imageAlt: '網站標題與電話的三個開關：在官網顯示 30 週年內容、最新消息、入學資訊分頁，下面都寫著發布後生效',
    keywords: ['隱藏', '關閉', '下架', '不顯示'],
  },

  // ── 統計與系統 ──
  {
    id: 'analytics-detail',
    section: 'system',
    title: '成效統計：每張表都能看算法、逐日數字與匯出',
    steps: [
      '每張表下面的「這些數字怎麼算」點開，寫著怎麼算、哪些不算進去。',
      '長條圖下面的「每日數字」點開是逐日的表，旁邊有「匯出 CSV」；長清單先列前幾項，按「顯示全部」看完整的。',
      '「怎麼來、怎麼逛」「走到預約」「每月比較」三類可以切「只看手機」「只看電腦」。分類、期間、裝置都寫在網址，傳給同事是同一個畫面。',
    ],
    roleNote: 'Google 搜尋、商家檔案、LINE 這幾張只有總管理者看得到',
    to: { path: '/analytics', label: '成效統計' },
    keywords: ['流量', '報表', '下載', '瀏覽', '來源'],
  },
  {
    id: 'audit-more',
    section: 'system',
    title: '操作紀錄：滑鼠停在名字上看 Email，點連結直接開案件',
    steps: [
      '滑鼠停在操作者的名字上會顯示 Email，停在後面的裝置上會顯示完整的瀏覽器資訊。',
      '跟案件有關的紀錄有「查看案件」，跟官網內容有關的有「開啟內容」，點了直接打開。',
      '只想看改了什麼，勾「不列登入登出」；操作者選「系統（排程、自動清理）」看系統自己做的事。最下面「載入更早的紀錄」再往前看。',
    ],
    roles: MANAGE,
    to: { path: '/audit', label: '操作紀錄' },
    image: 'audit-more',
    imageAlt: '操作紀錄的一列：操作者林主任與「查看案件」連結被框起來',
    keywords: ['誰改的', '稽核', '登入紀錄'],
  },
  {
    id: 'line-groups',
    section: 'system',
    title: 'LINE 群組要先貼驗證碼，才會出現通知開關',
    steps: [
      '把官方帳號拉進群組後，在「LINE 通知」按「產生驗證碼」，把驗證碼貼到那個群組（10 分鐘內有效、只能用一次），再按「重新整理」。',
      '群組標成「已驗證」後，下面才會出現「新的參觀預約」「每日摘要」這些開關，也才能選為各校的通知群組。',
      '打開「設為總部群組」會收到所有校區的通知，另外多一個「官網統計異常」可以開。',
    ],
    roles: [SA],
    to: { path: '/line-notifications', label: 'LINE 通知' },
    keywords: ['綁定', '推播'],
  },
  {
    id: 'system-status',
    section: 'system',
    title: '系統狀態：要注意的那一列有連結帶你去處理',
    steps: [
      '有問題的項目右邊會出現「前往 LINE 通知」「前往素材庫」「重新寄送」「看錯誤」這類連結，點了直接到能處理的地方。',
      '「錯誤回報」每一筆可以「展開堆疊」看細節，看過按「標為已處理」；同一種錯誤再發生，會自己回到「未處理」。',
    ],
    roles: [SA],
    to: { path: '/system-status', label: '系統狀態' },
    keywords: ['當機', 'bug', '寄信', '排程', '異常'],
  },
]

/** `mod+K` → ⌘K（Mac）或 Ctrl＋K；單獨的 `mod`（按住再點）→ ⌘ 或 Ctrl。只換 mod，其他按鍵照寫。 */
export function formatKey(key: string, apple: boolean): string {
  return key.replace(/mod(\+?)/g, (_match, plus: string) => (apple ? '⌘' : plus ? 'Ctrl＋' : 'Ctrl'))
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

/** 有寫按鍵（反引號）的條目，搜「快捷鍵」「鍵盤」也要找得到：側欄搜尋就是用「快捷鍵」把人帶來這一頁的。 */
export const KEY_TIP_KEYWORDS = ['快捷鍵', '鍵盤', '按鍵', '熱鍵']

/** 一條小技巧裡搜得到的字（還沒正規化）：標題、步驟、keywords；按鍵 ⌘K 與 Ctrl＋K 兩種寫法都收。 */
export function tipSearchParts(tip: Tip): string[] {
  const texts = [tip.title, ...tip.steps.map(stepText)]
  const plain = (text: string) => [true, false].map(apple => splitKeys(text, apple).map(part => part.value).join('')).join(' ')
  return [...texts.map(plain), ...(tip.keywords ?? []), ...(texts.some(text => text.includes('`')) ? KEY_TIP_KEYWORDS : [])]
}

export type MatchPart = { value: string; hit: boolean }

/**
 * 把一段字裡符合搜尋字的地方拆出來（畫成 <mark>）。terms 是正規化過的搜尋字（NFKC、小寫）；
 * 原文逐字正規化後比對，所以全形的「＋」「／」、大小寫不同也標得到，標的仍是原文的字。
 */
export function splitMatches(text: string, terms: readonly string[]): MatchPart[] {
  if (!text) return []
  const chars = Array.from(text)
  const hit = new Array<boolean>(chars.length).fill(false)
  if (terms.length) {
    let normalized = ''
    const owner: number[] = []
    chars.forEach((char, index) => {
      const folded = char.normalize('NFKC').toLowerCase()
      normalized += folded
      for (let i = 0; i < folded.length; i += 1) owner.push(index)
    })
    for (const term of terms) {
      if (!term) continue
      for (let at = normalized.indexOf(term); at >= 0; at = normalized.indexOf(term, at + term.length)) {
        for (let i = at; i < at + term.length; i += 1) hit[owner[i]!] = true
      }
    }
  }
  const parts: MatchPart[] = []
  chars.forEach((char, index) => {
    const last = parts[parts.length - 1]
    if (last && last.hit === hit[index]) last.value += char
    else parts.push({ value: char, hit: hit[index]! })
  })
  return parts
}

/**
 * 搜尋字只出現在步驟裡時，列在標題下面的那一句（以「。」分句，取第一句有搜尋字的）。
 * 標題已經有全部搜尋字、或只對到 keywords／誰能用的，回 null。
 */
export function matchSnippet(title: string, steps: readonly string[], terms: readonly string[], apple: boolean): string | null {
  if (!terms.length) return null
  const fold = (text: string) => splitKeys(text, apple).map(part => part.value).join('').normalize('NFKC').toLowerCase()
  const foldedTitle = fold(title)
  const missing = terms.filter(term => !foldedTitle.includes(term))
  if (!missing.length) return null
  for (const step of steps) {
    // 不用 lookbehind 分句：舊版 Safari 看到 (?<=) 整個檔會解析失敗。
    for (const sentence of step.match(/[^。]+。?/g) ?? []) {
      const folded = fold(sentence)
      if (missing.some(term => folded.includes(term))) return sentence.trim()
    }
  }
  return null
}

export const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** 角色顯示順序：由權限大到小。 */
export const TIP_ROLE_ORDER: Role[] = [SA, CA, ED, RC, RO]
