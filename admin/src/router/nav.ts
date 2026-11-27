import { hasCapability } from '../composables/usePermissions'

// 側欄導覽結構。路由的 meta.title 也從這裡取，兩邊不會漂移。
// 圖示名稱對應 @element-plus/icons-vue 的匯出名，只用線條圖示（不要 *Filled、Grid、List、
// TrendCharts 這類實心的）。Film 取它九宮格外框的樣子，不是影片的意思。

// 誰看得到哪一項：一律看後端算好的 effective_capabilities（backend/app/auth/permissions.py 的
// 同一張表加逐人授權），這裡不再另抄角色清單——後端放寬或授權某一項，入口就跟著出現。
// 後端才是真正的權限檢查，這裡只是不讓人點進一定會被拒絕的頁面。
type NavUser = { effective_capabilities?: readonly string[] } | null | undefined

const VISITS = 'booking.read'
// 官網內容各頁、素材庫、發布紀錄：接待有 content.read 但不進內容頁，所以看 content.browse。
const CONTENT = 'content.browse'
// 共用內容（首頁、頁尾、網站設定…）：總管理者，或被授予「全站共用內容」的分校管理者與內容編輯。
const SHARED = 'content.shared'

/** 共用內容（首頁、頁尾、網站設定…）能不能編：後端 can_edit_shared_content 算好放在 effective_capabilities。 */
export function canEditSharedContent(user: NavUser): boolean {
  return hasCapability(user, SHARED)
}

/** 發布共用內容：總管理者，或有授權的分校管理者（內容編輯只能送審）。後端 can_publish_shared_content。 */
export function canPublishSharedContent(user: NavUser): boolean {
  return hasCapability(user, 'content.shared_publish')
}

export interface NavItem {
  name: string
  path: string
  title: string
  icon?: string
  /** 要有這項權限才看得到（effective_capabilities）；未設定代表所有登入者 */
  capability?: string
  /** 共用內容頁（capability 是 content.shared）：使用小技巧等地方用來標示「全站共用」 */
  shared?: boolean
  /** 部署開關：後端 /auth/me 的 features 為關閉時，側欄與側欄搜尋不列出這項。
   * 只管「列不列出」，路由守衛不擋——直接開網址仍到該頁（招生頁顯示「尚未啟用」）。 */
  feature?: 'admissions'
  /** 側欄搜尋另外比對的說法：員工找功能用的是自己的話（「照片」「名額」「密碼」），
   * 不一定是功能名。不要放「素材」「分校頁」「使用者」：搜這幾個字時功能名與分組名
   * 已經給了對的結果，再加會把別組的項目也帶出來。 */
  keywords?: string[]
}

export interface NavGroup {
  key: string
  label: string
  /** 相鄰且同名的分組在側欄裡共用一個區段標題，頁首麵包屑也顯示這個 */
  section?: string
  /** 不畫可收合的標題，項目直接列出（區段裡的工具類項目）。搜尋時照常顯示分組名。 */
  flat?: boolean
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: '總覽',
    items: [{ name: 'dashboard', path: '/', title: '營運總覽', icon: 'House', capability: VISITS, keywords: ['總覽', '待辦', '今日參觀', '摘要'] }],
  },
  {
    key: 'visits',
    label: '參觀預約',
    items: [
      { name: 'visit-requests', path: '/visit-requests', title: '參觀案件', icon: 'Tickets', capability: VISITS, keywords: ['預約', '家長', '報名', '電話', '聯絡紀錄', '匯出'] },
      { name: 'visit-calendar', path: '/visit-calendar', title: '參觀場次', icon: 'Calendar', capability: VISITS, keywords: ['預約', '行事曆', '日曆', '接待月曆', '當天參觀', '場次', '時段', '名額', '參觀時間', '每週規則', '固定場次', '休假', '停止申請', '加開'] },
      { name: 'admissions', path: '/admissions', title: '招生入學', icon: 'PieChart', capability: 'admissions.read', feature: 'admissions', keywords: ['招生', '漏斗', '預繳', '註冊', '退預繳', '訪視明細', '轉換率'] },
      // 招生統計（2026-10-16 業主裁定）：原本招生入學的「統計分析」分頁抽出來，限總管理者（後端 admissions.stats）；
      // 2026-11-27 起總管理者也可以逐人授權給分校管理者，只看負責的校區。
      // 招生開關關閉時同招生入學不列出。
      { name: 'admissions-stats', path: '/admissions-stats', title: '招生統計', icon: 'DataAnalysis', capability: 'admissions.stats', feature: 'admissions', keywords: ['統計分析', '轉換率', '預約統計', '到場率', '取消率', '五校比較', '班別', '來源分析', '區域分析', '未預繳', '預約全程', '招生潛力', '市佔率'] },
      // Meta 名單型廣告送進來的名單收件匣，挑要跟進的轉成參觀案件（2026-11-26）。排在招生統計後面：
      // 參觀案件→參觀場次→招生入學→招生統計 要一個接一個（receptionAndHistory、admissionsView、admissionsStatsView 測試）。
      { name: 'meta-leads', path: '/meta-leads', title: '廣告名單', icon: 'ChatDotSquare', capability: VISITS, keywords: ['Meta', 'Facebook', 'Instagram', '名單型廣告', '即時表單', '潛在顧客'] },
      { name: 'booking', path: '/booking', title: '各校預約方式', icon: 'Switch', capability: 'booking.manage', keywords: ['暫停預約', '開放預約', '外部表單'] },
      { name: 'notifications', path: '/notifications', title: '站內通知', icon: 'Bell', capability: VISITS, keywords: ['改期', '提醒', '核准'] },
    ],
  },
  // 共用內容（campus_key 為 NULL）後端只允許總管理者與有「全站共用內容」授權的人編輯
  // （app/content/routes.py 的 _require_shared_or_scope），所以這些項目
  // 一律要 content.shared——否則分校管理者看得到、改得動，
  // 但按儲存永遠是 403。校園探索雖然各校各一份，2026-10-05 起也由總部管理
  // （後端 registry 的 hq_managed），同樣標 shared。分校自有內容（五校介紹／
  // 各校消息）不限制。
  // 官網內容原本是一個 11 項的大組，「首頁五校區塊／五校介紹／校園探索」
  // 三個名字都帶校區，攤在一起很難認，先拆成首頁／各校／全站與素材三個子組。
  // 2026-11-16 再分一次：「全站與素材」長到 11 項，各分頁的編輯頁、每一頁共用的設定、
  // 素材庫與發布紀錄混在一起。現在照官網的結構排——首頁、各分頁（順序同官網主選單）、
  // 各校、全站共用——素材庫與發布紀錄是工具不是內容，直接列在區段最下面、不必展開。
  {
    key: 'home',
    label: '首頁',
    section: '官網內容',
    items: [
      { name: 'home-hero', path: '/content/home-hero', title: '首頁大圖標語', icon: 'Picture', capability: SHARED, shared: true, keywords: ['橫幅', '主視覺', '大標'] },
      { name: 'home-about', path: '/content/home-about', title: '關於常春藤', icon: 'Document', capability: SHARED, shared: true, keywords: ['理念', '介紹'] },
      { name: 'home-campus-board', path: '/content/home-campus-board', title: '首頁五校區塊', icon: 'Film', capability: SHARED, shared: true, keywords: ['五校', '校區卡片'] },
      { name: 'day-experience', path: '/content/day-experience', title: '孩子的一天', icon: 'Sunny', capability: SHARED, shared: true, keywords: ['作息', '拍立得'] },
      { name: 'home-news', path: '/content/home-news', title: '最新消息與活動', icon: 'Notification', capability: SHARED, shared: true, keywords: ['消息', '活動', '公告'] },
    ],
  },
  {
    key: 'pages',
    label: '各分頁',
    section: '官網內容',
    items: [
      { name: 'about-page', path: '/content/about-page', title: '關於常春藤頁', icon: 'Notebook', capability: SHARED, shared: true, keywords: ['沿革', '創校', '全人教育', '期許', '立體書'] },
      { name: 'curriculum-page', path: '/content/curriculum-page', title: '特色教學頁', icon: 'Brush', capability: SHARED, shared: true, keywords: ['課程', '教學特色', '美術館', '五件事', '教學理念'] },
      { name: 'environment-page', path: '/content/environment-page', title: '常春藤環境頁', icon: 'School', capability: SHARED, shared: true, keywords: ['環境', '餐點', '保育', '校園', '空間', '遊樂區', '五顆心'] },
      // 常春藤環境頁「五所校園」：五校各一份，由總部統一管理，所以跟著環境頁放在這裡、不在「各校」。
      { name: 'campus-tour', path: '/content/campus-tour', title: '校園探索', icon: 'Location', capability: SHARED, shared: true, keywords: ['環境照片', '環境頁', '五所校園', '導覽'] },
      { name: 'admission-content', path: '/content/admission', title: '入學資訊頁', icon: 'Reading', capability: SHARED, shared: true, keywords: ['招生', '入學', '學費'] },
      { name: 'booking-content', path: '/content/booking-content', title: '預約文案', icon: 'EditPen', capability: SHARED, shared: true, keywords: ['預約頁', '表單說明', '同意'] },
    ],
  },
  {
    key: 'campus',
    label: '各校',
    section: '官網內容',
    items: [
      { name: 'campus-profile', path: '/content/campus-profile', title: '五校介紹', icon: 'School', capability: CONTENT, keywords: ['分校介紹', '地址', '電話', '臉書', 'Facebook', '社群'] },
      // 各校自己的消息與活動：分校人員只編本校（全站消息在「首頁 → 最新消息與活動」）。
      { name: 'campus-news', path: '/content/campus-news', title: '各校消息與活動', icon: 'Postcard', capability: CONTENT, keywords: ['消息', '活動', '公告'] },
      // 粉專貼文同步進來的收件匣，挑幾則轉成各校消息草稿（2026-10-28）。
      { name: 'facebook-posts', path: '/content/facebook-posts', title: 'Facebook 貼文', icon: 'ChatLineSquare', capability: CONTENT, keywords: ['臉書', 'FB', '粉專', '貼文', '消息'] },
    ],
  },
  // 每一頁都看得到的東西：頁首的網站名稱與電話、頁尾，以及頁尾連過去的隱私權政策。
  {
    key: 'site',
    label: '全站共用',
    section: '官網內容',
    items: [
      { name: 'site-meta', path: '/content/site-meta', title: '網站標題與電話', icon: 'Phone', capability: SHARED, shared: true, keywords: ['SEO', '搜尋引擎', '網站名稱', '分享', '30 週年', '週年', '布幕', '隱藏最新消息', '關閉最新消息', '消息開關', '隱藏入學資訊', '隱藏分頁'] },
      { name: 'site-footer', path: '/content/site-footer', title: '頁尾文字', icon: 'Bottom', capability: SHARED, shared: true, keywords: ['版權', '底部'] },
      { name: 'privacy-policy', path: '/content/privacy-policy', title: '隱私權政策', icon: 'Lock', capability: SHARED, shared: true, keywords: ['個資', '隱私', 'Cookie', '政策'] },
    ],
  },
  // 素材庫與發布紀錄：編哪一頁都會用到，看得到內容的角色都能進。不畫可收合的標題，
  // 兩項直接列在「官網內容」最下面；分組名只在側欄搜尋的結果裡出現。
  {
    key: 'library',
    label: '素材與發布',
    section: '官網內容',
    flat: true,
    items: [
      { name: 'media', path: '/media', title: '素材庫', icon: 'Files', capability: CONTENT, keywords: ['照片', '圖片', '影片', '相片', '上傳', '檔案'] },
      // 全站發布紀錄、排程發布與給自己的內容通知（送審、核准或退回、排程沒執行）。
      // 看得到內容的人都能進（分校帳號只看自己校與共用內容）；整站還原限總管理者。
      { name: 'releases', path: '/releases', title: '發布紀錄', icon: 'Clock', capability: CONTENT, keywords: ['發布', '排程', '送審', '審核', '還原', '內容通知'] },
    ],
  },
  {
    key: 'system',
    label: '系統',
    items: [
      { name: 'analytics', path: '/analytics', title: '成效統計', icon: 'DataLine', keywords: ['統計', '流量', '報表', '數據', '瀏覽', '速度', '停留', '來源', '興趣'] },
      { name: 'audit', path: '/audit', title: '操作紀錄', icon: 'Memo', capability: 'audit.read', keywords: ['紀錄', '誰改的', '稽核'] },
      { name: 'users', path: '/users', title: '使用者', icon: 'User', capability: 'users.manage', keywords: ['帳號', '權限', '角色', '重設密碼', '停用', '新增人員'] },
      // 系統狀態（2026-10-15）：寄信、推播、背景排程、公開資料的設定現況與測試信，限總管理者（system.status）。
      { name: 'system-status', path: '/system-status', title: '系統狀態', icon: 'Monitor', capability: 'system.status', keywords: ['寄信', 'SMTP', 'Resend', '排程', '同步', '設定', '健康', '測試信'] },
      // 2026-09-29 由「全站設定」改名（內容主要是個資保存，另列官網搜尋與分享的設定）；
      // 舊名留在關鍵字，習慣搜「全站設定」的人還找得到。
      { name: 'policies', path: '/policies', title: '個資與搜尋設定', icon: 'Setting', capability: 'retention.manage', keywords: ['全站設定', '個資', '保存期限', '清理'] },
      { name: 'line-notifications', path: '/line-notifications', title: 'LINE 通知', icon: 'ChatDotRound', capability: 'notifications.manage', keywords: ['群組', '推播'] },
      // 全站一份、總管理者維護（contact_phrases.manage）；接待與招生只在聯絡紀錄輸入框上方用，不開頁面。
      { name: 'contact-phrases', path: '/contact-phrases', title: '聯絡片語', icon: 'ChatLineSquare', capability: 'contact_phrases.manage', keywords: ['範本', '片語', '聯絡', '常用語'] },
    ],
  },
]

/** 不在側欄、只在搜尋結果出現的入口，各有別的固定入口：我的帳號是側欄底部的使用者區塊
 * （想改密碼的人會直接搜「密碼」），使用小技巧是頁首「查看官網」左邊那顆（2026-11-20 從
 * 側欄最後一項搬過去）。不放進 byName／byPath：路由標題另外寫，也不限角色。
 * 分組名同時是頁首的麵包屑。 */
export const SEARCH_ONLY_GROUPS: NavGroup[] = [
  {
    key: 'personal',
    label: '個人',
    items: [
      { name: 'account', path: '/account', title: '我的帳號', icon: 'Avatar', keywords: ['密碼', '更改密碼', '登入方式', 'Google', 'LINE 綁定', 'Email', '顯示名稱', '名字', '名稱'] },
    ],
  },
  {
    key: 'help',
    label: '說明',
    items: [
      { name: 'tips', path: '/tips', title: '使用小技巧', icon: 'Opportunity', keywords: ['教學', '說明', '怎麼用', '快捷鍵', '技巧', '新手', '操作'] },
    ],
  },
]

/** 搜尋比對前先正規化：全形轉半形（NFKC）、不分大小寫。手機鍵盤預設打小寫，
 * 「line」也要找得到「LINE 通知」。 */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim()
}

/** 園方的口語說法（2026-11-27 後台 QA／TA）：功能藏在某一頁裡、名稱和關鍵字都沒有的講法，
 * 例如颱風停課在「參觀場次」、取消預約在「參觀案件」。和 keywords 一樣參與比對；另外放一份，
 * 是為了不動每個選單項目那一行。 */
const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'visit-calendar': ['停班停課', '颱風', '放假', '國定假日', '寒假', '暑假'],
  'visit-requests': ['取消預約', '未到場', '已到場', '補登', '改場次', '重寄確認信', '家長管理連結', '排除'],
  account: ['手機通知', '手機推播'],
}

/** 這個功能的名稱、關鍵字或口語說法跟搜尋字（q 已經正規化過）有多接近：2＝完全相同、
 * 1＝包含搜尋字、0.5＝反過來，兩個字以上的關鍵字出現在搜尋字裡（「上傳照片」裡有「照片」）、
 * 0＝對不上。完全相同的排前面：搜「密碼」時第一筆（按 Enter 開的那筆）要是自己的「我的帳號」，
 * 不是關鍵字「重設密碼」的「使用者」。 */
export function navItemMatchScore(item: NavItem, q: string): number {
  const texts = [item.title, ...(item.keywords ?? []), ...(SEARCH_ALIASES[item.name] ?? [])].map(normalizeSearch)
  if (texts.includes(q)) return 2
  if (texts.some(text => text.includes(q))) return 1
  return texts.some(text => text.length >= 2 && q.includes(text)) ? 0.5 : 0
}

/** 這些功能裡跟搜尋字對得上的，分數高的在前（同分維持原本順序）。反過來命中（0.5）只在沒有
 * 任何功能直接命中時才列：搜「全站設定」只給個資與搜尋設定，不會因為關鍵字「設定」多出系統狀態。
 * 側欄要分組顯示，可以先用整份清單算一次，再拿 floor 過濾各組。 */
export function navSearchHits(items: readonly NavItem[], q: string): { item: NavItem; score: number }[] {
  const scored = items.map(item => ({ item, score: navItemMatchScore(item, q) })).filter(hit => hit.score > 0)
  const floor = scored.some(hit => hit.score >= 1) ? 1 : 0.5
  return scored.filter(hit => hit.score >= floor).sort((a, b) => b.score - a.score)
}

const byName = new Map<string, NavItem>()
const byPath = new Map<string, NavItem>()
for (const group of NAV_GROUPS) {
  for (const item of group.items) {
    byName.set(item.name, item)
    byPath.set(item.path, item)
  }
}

export function canSeeNavItem(item: Pick<NavItem, 'capability'>, user: NavUser): boolean {
  return !item.capability || hasCapability(user, item.capability)
}

/** 側欄與搜尋用：角色看得到，而且（有掛 feature 的話）該功能開關是開的。 */
export function canListNavItem(
  item: NavItem,
  user: NavUser,
  features: Partial<Record<NonNullable<NavItem['feature']>, boolean>> | null | undefined,
): boolean {
  if (item.feature && !features?.[item.feature]) return false
  return canSeeNavItem(item, user)
}

export function navItem(name: string): NavItem | undefined {
  return byName.get(name)
}

/** 連結點下去進得了嗎（可以帶 query）。跟 router.beforeEach 同一條規則：
 * 進不去的頁面會被導回登入後第一頁，看起來像按了沒反應，所以總覽這類
 * 連到別頁的入口先用它過濾。不在側欄的頁面（案件明細、我的帳號）不限制。 */
export function canOpenPath(path: string, user: NavUser): boolean {
  const item = byPath.get(path.split(/[?#]/)[0] || '/')
  return item ? canSeeNavItem(item, user) : true
}

/** 登入頁 ?redirect= 的目的頁：只接受站內的 router 路徑，其他一律回 null
 * （由呼叫端改用起始頁）。後端的 OAuth 入口也會各自再驗一次。 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  const pathname = value.split(/[?#]/)[0] ?? '/'
  if (
    /[\\\u0000-\u001f\u007f]/.test(value)
    || /%|(^|\/)\.{1,2}(\/|$)/.test(pathname)
    || pathname.replace(/\/+$/, '') === '/login'
  ) return null
  return value
}

/** 登入後的第一頁：這個人看得到的第一個側欄項目（編輯與唯讀沒有營運總覽）。 */
export function landingPath(user: NavUser): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (canSeeNavItem(item, user)) return item.path
    }
  }
  return '/'
}
