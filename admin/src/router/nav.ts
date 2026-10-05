// 側欄導覽結構。路由的 meta.title 也從這裡取，兩邊不會漂移。
// 圖示名稱對應 @element-plus/icons-vue 的匯出名，只用線條圖示（不要 *Filled、Grid、List、
// TrendCharts 這類實心的）。Film 取它九宮格外框的樣子，不是影片的意思。

// 角色可見範圍（規格 7 權限表）。後端才是真正的權限檢查，這裡只是不讓人
// 點進一定會被拒絕的頁面。
const MANAGE = ['super_admin', 'campus_admin']
const VISITS = ['super_admin', 'campus_admin', 'reception']
const CONTENT = ['super_admin', 'campus_admin', 'editor', 'readonly']

/** 共用內容（首頁、頁尾、網站設定…）：總管理者，或被授予「全站共用內容」
 * 的分校管理者與內容編輯（規格 7 明確授權）。後端 can_edit_shared_content 同一條規則。 */
export function canEditSharedContent(user: { role: string; capabilities?: string[] } | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return true
  return (user.capabilities ?? []).includes('content.shared') && ['campus_admin', 'editor'].includes(user.role)
}

/** 發布共用內容：總管理者，或有授權的分校管理者（內容編輯只能送審）。 */
export function canPublishSharedContent(user: { role: string; capabilities?: string[] } | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'super_admin') return true
  return (user.capabilities ?? []).includes('content.shared') && user.role === 'campus_admin'
}

export interface NavItem {
  name: string
  path: string
  title: string
  icon?: string
  /** 只有這些角色看得到；未設定代表所有登入者 */
  roles?: string[]
  /** 共用內容頁：除了 roles，有「全站共用內容」授權的人也看得到 */
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
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: '總覽',
    items: [{ name: 'dashboard', path: '/', title: '營運總覽', icon: 'House', roles: VISITS, keywords: ['總覽', '待辦', '今日參觀', '摘要'] }],
  },
  {
    key: 'visits',
    label: '參觀預約',
    items: [
      { name: 'visit-requests', path: '/visit-requests', title: '參觀案件', icon: 'Tickets', roles: VISITS, keywords: ['預約', '家長', '報名', '電話', '聯絡紀錄', '匯出'] },
      { name: 'visit-calendar', path: '/visit-calendar', title: '參觀場次', icon: 'Calendar', roles: VISITS, keywords: ['預約', '行事曆', '日曆', '接待月曆', '當天參觀', '場次', '時段', '名額', '參觀時間', '每週規則', '固定場次', '休假', '停止申請', '加開'] },
      { name: 'admissions', path: '/admissions', title: '招生入學', icon: 'PieChart', roles: VISITS, feature: 'admissions', keywords: ['招生', '漏斗', '預繳', '註冊', '退預繳', '訪視明細', '轉換率'] },
      { name: 'booking', path: '/booking', title: '各校預約方式', icon: 'Switch', roles: MANAGE, keywords: ['暫停預約', '開放預約', '外部表單'] },
      { name: 'notifications', path: '/notifications', title: '站內通知', icon: 'Bell', roles: VISITS, keywords: ['改期', '提醒', '核准'] },
    ],
  },
  // 共用內容（campus_key 為 NULL）後端只允許 super_admin 編輯
  // （app/content/routes.py 的 _require_shared_or_scope），所以這九項
  // 一律標 roles: ['super_admin']——否則分校管理者看得到、改得動，
  // 但按儲存永遠是 403。分校自有內容（五校介紹／常見問題／校園探索）
  // 不限制。
  // 官網內容原本是一個 11 項的大組，「首頁五校區塊／五校介紹／校園探索」
  // 三個名字都帶校區，攤在一起很難認。拆成三個各 3～4 項的子組，共用
  // 「官網內容」區段標題。
  {
    key: 'home',
    label: '首頁',
    section: '官網內容',
    items: [
      { name: 'home-hero', path: '/content/home-hero', title: '首頁大圖標語', icon: 'Picture', roles: ['super_admin'], shared: true, keywords: ['橫幅', '主視覺', '大標'] },
      { name: 'home-about', path: '/content/home-about', title: '關於常春藤', icon: 'Document', roles: ['super_admin'], shared: true, keywords: ['理念', '介紹'] },
      { name: 'home-campus-board', path: '/content/home-campus-board', title: '首頁五校區塊', icon: 'Film', roles: ['super_admin'], shared: true, keywords: ['五校', '校區卡片'] },
      { name: 'day-experience', path: '/content/day-experience', title: '孩子的一天', icon: 'Sunny', roles: ['super_admin'], shared: true, keywords: ['作息', '拍立得'] },
      { name: 'home-news', path: '/content/home-news', title: '最新消息與活動', icon: 'Notification', roles: ['super_admin'], shared: true, keywords: ['消息', '活動', '公告'] },
    ],
  },
  {
    key: 'campus',
    label: '各校',
    section: '官網內容',
    items: [
      { name: 'campus-profile', path: '/content/campus-profile', title: '五校介紹', icon: 'School', roles: CONTENT, keywords: ['分校介紹', '地址', '電話', '臉書', 'Facebook', '社群'] },
      // 各校自己的消息與活動：分校人員只編本校（全站消息在「首頁 → 最新消息與活動」）。
      { name: 'campus-news', path: '/content/campus-news', title: '各校消息與活動', icon: 'Postcard', roles: CONTENT, keywords: ['消息', '活動', '公告'] },
      { name: 'campus-tour', path: '/content/campus-tour', title: '校園探索', icon: 'Location', roles: CONTENT, keywords: ['環境照片', '環境頁', '導覽'] },
    ],
  },
  {
    key: 'site',
    label: '全站與素材',
    section: '官網內容',
    items: [
      { name: 'admission-content', path: '/content/admission', title: '入學資訊頁', icon: 'Reading', roles: ['super_admin'], shared: true, keywords: ['招生', '入學', '學費'] },
      { name: 'curriculum-page', path: '/content/curriculum-page', title: '特色教學頁', icon: 'Brush', roles: ['super_admin'], shared: true, keywords: ['課程', '教學特色', '美術館', '五件事', '教學理念'] },
      { name: 'about-page', path: '/content/about-page', title: '關於常春藤頁', icon: 'Notebook', roles: ['super_admin'], shared: true, keywords: ['沿革', '創校', '全人教育', '期許', '立體書'] },
      { name: 'booking-content', path: '/content/booking-content', title: '預約文案', icon: 'EditPen', roles: ['super_admin'], shared: true, keywords: ['預約頁', '表單說明', '同意'] },
      { name: 'privacy-policy', path: '/content/privacy-policy', title: '隱私權政策', icon: 'Lock', roles: ['super_admin'], shared: true, keywords: ['個資', '隱私', 'Cookie', '政策'] },
      { name: 'site-footer', path: '/content/site-footer', title: '頁尾文字', icon: 'Bottom', roles: ['super_admin'], shared: true, keywords: ['版權', '底部'] },
      { name: 'site-meta', path: '/content/site-meta', title: '網站標題與電話', icon: 'Phone', roles: ['super_admin'], shared: true, keywords: ['SEO', '搜尋引擎', '網站名稱', '分享'] },
      { name: 'media', path: '/media', title: '素材庫', icon: 'Files', roles: CONTENT, keywords: ['照片', '圖片', '影片', '相片', '上傳', '檔案'] },
      // 全站發布紀錄、排程發布與給自己的內容通知（送審、核准或退回、排程沒執行）。
      // 看得到內容的人都能進（分校帳號只看自己校與共用內容）；整站還原限總管理者。
      { name: 'releases', path: '/releases', title: '發布紀錄', icon: 'Clock', roles: CONTENT, keywords: ['發布', '排程', '送審', '審核', '還原', '內容通知'] },
    ],
  },
  {
    key: 'system',
    label: '系統',
    items: [
      { name: 'analytics', path: '/analytics', title: '成效統計', icon: 'DataLine', keywords: ['統計', '流量', '報表', '數據', '瀏覽'] },
      { name: 'audit', path: '/audit', title: '操作紀錄', icon: 'Memo', roles: MANAGE, keywords: ['紀錄', '誰改的', '稽核'] },
      { name: 'users', path: '/users', title: '使用者', icon: 'User', roles: ['super_admin'], keywords: ['帳號', '權限', '角色', '重設密碼', '停用', '新增人員'] },
      // 2026-09-29 由「全站設定」改名（內容主要是個資保存，另列官網搜尋與分享的設定）；
      // 舊名留在關鍵字，習慣搜「全站設定」的人還找得到。
      { name: 'policies', path: '/policies', title: '個資與搜尋設定', icon: 'Setting', roles: ['super_admin'], keywords: ['全站設定', '個資', '保存期限', '清理'] },
      { name: 'line-notifications', path: '/line-notifications', title: 'LINE 通知', icon: 'ChatDotRound', roles: ['super_admin'], keywords: ['群組', '推播'] },
    ],
  },
]

/** 不在側欄、只在搜尋結果出現的入口。我的帳號平常從側欄底部的使用者區塊進去，
 * 但想改密碼的人會直接搜「密碼」。不放進 byName／byPath：路由標題另外寫，
 * 也不限角色。 */
export const SEARCH_ONLY_GROUP: NavGroup = {
  key: 'personal',
  label: '個人',
  items: [
    { name: 'account', path: '/account', title: '我的帳號', icon: 'Avatar', keywords: ['密碼', '更改密碼', '登入方式', 'Google', 'LINE 綁定', 'Email', '顯示名稱', '名字', '名稱'] },
  ],
}

/** 搜尋比對前先正規化：全形轉半形（NFKC）、不分大小寫。手機鍵盤預設打小寫，
 * 「line」也要找得到「LINE 通知」。 */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim()
}

/** 這個功能的名稱或關鍵字跟搜尋字（q 已經正規化過）有多接近：2＝完全相同、
 * 1＝包含、0＝對不上。完全相同的排前面：搜「密碼」時第一筆（按 Enter 開的那筆）
 * 要是自己的「我的帳號」，不是關鍵字「重設密碼」的「使用者」。 */
export function navItemMatchScore(item: NavItem, q: string): number {
  const texts = [item.title, ...(item.keywords ?? [])].map(normalizeSearch)
  if (texts.includes(q)) return 2
  return texts.some(text => text.includes(q)) ? 1 : 0
}

const byName = new Map<string, NavItem>()
const byPath = new Map<string, NavItem>()
for (const group of NAV_GROUPS) {
  for (const item of group.items) {
    byName.set(item.name, item)
    byPath.set(item.path, item)
  }
}

export function canSeeNavItem(item: NavItem, user: { role: string; capabilities?: string[] } | null | undefined): boolean {
  if (!item.roles) return true
  if (user && item.roles.includes(user.role)) return true
  return Boolean(item.shared && canEditSharedContent(user))
}

/** 側欄與搜尋用：角色看得到，而且（有掛 feature 的話）該功能開關是開的。 */
export function canListNavItem(
  item: NavItem,
  user: { role: string; capabilities?: string[] } | null | undefined,
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
export function canOpenPath(path: string, user: { role: string; capabilities?: string[] } | null | undefined): boolean {
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

/** 登入後的第一頁：該角色看得到的第一個側欄項目（編輯與唯讀沒有營運總覽）。 */
export function landingPath(role: string | undefined): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!item.roles || (role && item.roles.includes(role))) return item.path
    }
  }
  return '/'
}
