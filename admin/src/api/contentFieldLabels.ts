import { contentFieldLabel } from './labels'

// 差異清單（發布、核准、還原）的欄位名要和編輯頁的表單標籤一致，使用者才對得上
// 「改了哪裡」。同一個欄位鍵在不同內容種類的表單叫法不同（例如 intro 在分校
// 基本資料叫「一句話簡介」），所以依內容種類覆寫；沒列到的退回全站通用名稱。
const KIND_FIELD_LABELS: Record<string, Record<string, string>> = {
  home_hero: {
    eyebrow: '標語上方的小標',
    copy_lines: '標語',
    poster: '影片封面',
    poster_alt: '影片封面的圖片說明',
    fallback_image: '影片載入失敗時的替代圖',
  },
  home_about: {
    photo_alt: '圖片說明',
  },
  home_campus_board: {
    eyebrow: '小標',
    note: '說明文字',
    default_campus: '進首頁先顯示',
  },
  home_news: {
    sample_note: '示意說明',
    home_display_count: '首頁最多輪播幾則消息',
  },
  site_footer: {
    tagline: '標語',
    campus_list_label: '五校清單標題',
    copyright: '版權字樣',
  },
  site_meta: {
    title: '網站標題',
    description: '網站描述',
    header_phone_note: '電話備註',
    share_image: '社群分享預覽圖',
    share_image_alt: '分享圖說明',
    admission_title: '入學資訊頁的搜尋結果標題',
    admission_description: '入學資訊頁的搜尋結果描述',
    allow_indexing: '搜尋引擎收錄',
  },
  booking_content: {
    cta_label: '預約按鈕（中文）',
    cta_label_en: '預約按鈕英文副標',
    privacy_title: '說明標題',
    banner_title_template: '橫幅標題',
    banner_body: '橫幅內文',
    banner_button_label: '橫幅按鈕文字',
  },
  campus_profile: {
    name: '校名',
    district: '行政區',
    phone: '參觀專線',
    intro: '一句話簡介',
    description: '詳細介紹',
    map_url: '地圖連結',
    facebook: 'Facebook 粉絲專頁網址',
    line: 'LINE 官方帳號網址',
    instagram: 'Instagram 網址',
    youtube: 'YouTube 頻道網址',
    card_focus: '首頁五校卡片、預約頁的裁切焦點',
    hero_focus: '分校頁首屏的裁切焦點',
    line_art_colour: '建築線稿（上色版）',
  },
  day_experience: {
    eyebrow: '小標（中文）',
    eyebrow_en: '小標（英文）',
    note: '說明文字',
    source_note: '影片來源標註',
    film_poster: '影片封面',
    moments: '時刻卡',
  },
  privacy_policy: {
    title: '標題',
    updated_on: '最後更新日期',
    sections: '政策段落',
    heading: '段落小標',
    body: '段落內文',
  },
  admission_content: {
    notice: '頁面提醒',
    intro: '頁首介紹',
    steps: '入學流程',
    phases: '新生入園須知',
    uniform_note: '每天穿什麼的說明',
    uniform_week: '每天穿什麼',
    fee_intro: '收退費辦法的說明',
    allowance_title: '育兒津貼標題',
    allowance_note: '育兒津貼附註',
    refunds: '退費規定',
  },
}

export function contentFieldLabelFor(kind: string | undefined, key: string): string {
  return (kind && KIND_FIELD_LABELS[kind]?.[key]) || contentFieldLabel(key)
}

// 存檔被後端擋下（422）時，錯誤指到清單裡的某一項：「最新消息第 4 則・標題」。
// 清單裡的欄位名照編輯頁每一項的表單標籤寫，和最外層同名欄位的叫法不一定一樣
// （消息的 description 在表單上叫「摘要」）。沒列到的退回全站通用名稱。
const LIST_UNITS: Record<string, string> = {
  articles: '則',
  events: '筆',
  moments: '張',
  items: '題',
  body: '段',
  copy_lines: '行',
}

const LIST_FIELD_LABELS: Record<string, Record<string, string>> = {
  articles: {
    date: '日期',
    category: '分類',
    title: '標題',
    description: '摘要',
    body: '內文',
    image: '照片',
    alt: '圖片說明',
    scope: '適用校區',
    campus_keys: '適用校區',
    show_from: '上架日期',
    show_until: '下架日期',
  },
  events: {
    date: '日期',
    title: '活動名稱',
    description: '活動說明',
    location: '地點',
    link_url: '相關連結',
    link_label: '連結文字',
    start_time: '時間',
    end_time: '時間',
    scope: '適用校區',
    campus_keys: '適用校區',
    show_from: '開始宣傳日期',
    show_until: '提前下架日期',
  },
  moments: {
    time: '時間',
    label: '時段名稱',
    title: '拍立得標題',
    story: '翻面後的故事',
    photo: '照片',
    alt: '圖片說明',
    tint: '相紙色調',
    question: '家長常問',
    answer: '我們的回答',
  },
  items: { q: '問題', a: '回答' },
  body: { text: '文字', url: '網址', label: '連結文字', items: '清單項目', image: '圖片', alt: '圖片說明', caption: '圖說' },
}

/**
 * 422 的 loc（已去掉 body／payload 前綴）寫成中文位置，數字索引 +1：
 * ["articles", 3, "title"] →「最新消息第 4 則・標題」；["facebook"] →「Facebook 粉絲專頁網址」。
 */
export function contentPathLabel(kind: string | undefined, path: readonly (string | number)[]): string {
  const parts: string[] = []
  let parentList: string | undefined
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!
    if (typeof segment === 'number') {
      // 前一段已經把清單名寫進去了，這裡接「第 N 則」。
      const unit = (parentList && LIST_UNITS[parentList]) || '項'
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''}第 ${segment + 1} ${unit}`
      continue
    }
    const label = (parentList && LIST_FIELD_LABELS[parentList]?.[segment]) || (parts.length ? contentFieldLabel(segment) : contentFieldLabelFor(kind, segment))
    parts.push(label)
    if (typeof path[i + 1] === 'number') parentList = segment
  }
  return parts.join('・')
}

/** 錯誤指到的那一欄在表單上的標籤（最後一段），定位欄位時比對 el-form-item 的標籤用。 */
export function contentPathFieldLabel(kind: string | undefined, path: readonly (string | number)[]): string {
  const last = path[path.length - 1]
  if (typeof last !== 'string') return ''
  // 最靠近這一欄的清單名：後面接著數字索引的那一段。
  let list: string | undefined
  for (let i = path.length - 3; i >= 0; i--) {
    const segment = path[i]
    if (typeof segment === 'string' && typeof path[i + 1] === 'number') {
      list = segment
      break
    }
  }
  return (list && LIST_FIELD_LABELS[list]?.[last]) || (path.length === 1 ? contentFieldLabelFor(kind, last) : contentFieldLabel(last))
}
