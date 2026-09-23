// 側欄導覽結構。路由的 meta.title 也從這裡取，兩邊不會漂移。
// 圖示名稱對應 @element-plus/icons-vue 的匯出名。

export interface NavItem {
  name: string
  path: string
  title: string
  icon?: string
  /** 只有這些角色看得到；未設定代表所有登入者 */
  roles?: string[]
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
    items: [{ name: 'dashboard', path: '/', title: '營運總覽', icon: 'HomeFilled' }],
  },
  {
    key: 'visits',
    label: '參觀預約',
    items: [
      { name: 'visit-requests', path: '/visit-requests', title: '參觀案件', icon: 'Tickets' },
      { name: 'slots', path: '/slots', title: '時段與容量', icon: 'Calendar' },
      { name: 'booking', path: '/booking', title: '各校預約方式', icon: 'Switch' },
      { name: 'notifications', path: '/notifications', title: '站內通知', icon: 'Bell' },
    ],
  },
  // 共用內容（campus_key 為 NULL）後端只允許 super_admin 編輯
  // （app/content/routes.py 的 _require_shared_or_scope），所以這七項
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
      { name: 'home-hero', path: '/content/home-hero', title: '首頁首屏文字', icon: 'Picture', roles: ['super_admin'] },
      { name: 'home-about', path: '/content/home-about', title: '關於常春藤', icon: 'Document', roles: ['super_admin'] },
      { name: 'home-campus-board', path: '/content/home-campus-board', title: '首頁五校區塊', icon: 'Grid', roles: ['super_admin'] },
      { name: 'day-experience', path: '/content/day-experience', title: '孩子的一天', icon: 'Sunny', roles: ['super_admin'] },
    ],
  },
  {
    key: 'campus',
    label: '分校頁',
    section: '官網內容',
    items: [
      { name: 'campus-profile', path: '/content/campus-profile', title: '五校介紹', icon: 'School' },
      { name: 'campus-faq', path: '/content/campus-faq', title: '各校常見問題', icon: 'ChatLineSquare' },
      { name: 'campus-tour', path: '/content/campus-tour', title: '校園探索', icon: 'Location' },
    ],
  },
  {
    key: 'site',
    label: '全站與素材',
    section: '官網內容',
    items: [
      { name: 'booking-content', path: '/content/booking-content', title: '預約文案', icon: 'EditPen', roles: ['super_admin'] },
      { name: 'site-footer', path: '/content/site-footer', title: '頁尾文字', icon: 'Bottom', roles: ['super_admin'] },
      { name: 'site-meta', path: '/content/site-meta', title: '網站標題與電話', icon: 'Phone', roles: ['super_admin'] },
      { name: 'media', path: '/media', title: '素材庫', icon: 'Files' },
    ],
  },
  {
    key: 'system',
    label: '系統',
    items: [
      { name: 'analytics', path: '/analytics', title: '成效統計', icon: 'DataLine' },
      { name: 'audit', path: '/audit', title: '操作紀錄', icon: 'List' },
      { name: 'users', path: '/users', title: '使用者', icon: 'User', roles: ['super_admin'] },
      { name: 'policies', path: '/policies', title: '全站設定', icon: 'Setting', roles: ['super_admin'] },
    ],
  },
]

const byName = new Map<string, NavItem>()
for (const group of NAV_GROUPS) for (const item of group.items) byName.set(item.name, item)

export function navItem(name: string): NavItem | undefined {
  return byName.get(name)
}
