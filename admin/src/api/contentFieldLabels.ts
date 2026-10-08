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
    // 以下三欄 2026-10-08 從表單與後端拿掉，留著只為版本歷程比較舊版本時有中文欄位名。
    banner_title_template: '橫幅標題',
    banner_body: '橫幅內文',
    banner_button_label: '橫幅按鈕文字',
  },
  campus_profile: {
    name: '校名',
    district: '行政區',
    phone: '參觀專線',
    // intro、description（連同 labels.ts 的 fb_note）2026-10-08 從表單與後端拿掉，
    // 留著只為版本歷程比較舊版本時有中文欄位名。
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
  // 特色教學頁：欄位名＝編輯頁的表單標籤（錯誤定位靠比對標籤）。
  curriculum_page: {
    hero_eyebrow: '首屏小標',
    hero_title: '首屏大標',
    hero_highlight: '大標裡畫顏料的字',
    hero_lede: '首屏介紹',
    hero_notice: '首屏提醒',
    hero_photo: '首屏照片',
    hero_photo_alt: '首屏照片說明',
    chapters: '章節索引',
    years_title: '四個年段的標題',
    years_text: '四個年段的說明',
    spiral_label: '螺旋式課程的標題',
    spiral_text: '螺旋式課程的說明',
    years_photo: '四個年段的照片',
    years_photo_alt: '四個年段的照片說明',
    years_caption: '照片下方文字',
    years: '四個年段',
    directions_title: '課程方向的標題',
    directions_text: '課程方向的說明',
    directions: '課程方向',
    gallery_title: '兒童美術館的標題',
    gallery_text: '兒童美術館的說明',
    gallery_source: '作品照片出處',
    gallery: '兒童美術館的作品',
    daily_title: '五件事的標題',
    daily_text: '五件事的說明',
    daily_source: '五件事的出處',
    daily: '五件事',
    belief_title: '教學理念的標題',
    beliefs: '教學理念',
    belief_close: '教學理念的結語',
    belief_source: '教學理念的出處',
  },
  // 關於常春藤頁：欄位名＝編輯頁的表單標籤（錯誤定位靠比對標籤）。
  about_page: {
    hero_title: '首屏大標',
    hero_lede: '首屏介紹',
    hero_caption: '首屏照片上的一句話',
    hero_photo: '首屏照片',
    hero_photo_alt: '首屏照片說明',
    hero_back_photo: '首屏後排照片',
    hero_back_photo_alt: '首屏後排照片說明',
    chapter_names: '章名',
    story_title: '一路走來的標題',
    story_text: '一路走來的說明',
    milestones: '沿革',
    whole_title: '全人教育的標題',
    whole_text: '全人教育的說明',
    whole_fine: '全人教育的補充',
    whole_fine_source: '全人教育的出處',
    hope_title: '我們的期許的標題',
    hope_quotes: '期許',
    hope_photo: '紙房子窗戶的照片',
    hope_photo_alt: '紙房子窗戶的照片說明',
    outro_title: '五所校園的標題',
    outro_text: '五所校園的說明',
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
  chapters: '個', years: '個', directions: '個', gallery: '件', daily: '件', beliefs: '項',
  chapter_names: '個', milestones: '站', hope_quotes: '段',
}

const LIST_FIELD_LABELS: Record<string, Record<string, string>> = {
  chapters: { label: '章節名稱', hint: '小字' },
  milestones: { year: '年份', text: '說明' },
  years: { motto: '標語', text: '說明' },
  directions: { title: '標題', sub: '副標', text: '說明', photo: '照片', photo_alt: '照片說明' },
  gallery: { label: '作品名稱', photo: '照片', photo_alt: '照片說明' },
  daily: { title: '名稱', text: '介紹', photo: '照片', photo_alt: '照片說明' },
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

// 清單裡某一項的欄位叫法和同清單其他項不同時，依內容種類寫「清單[索引].欄位」。特色教學頁
// 課程方向第 4 個是品德培養（後端 CURRICULUM_DIRECTION_KEYS 順序固定），它的 sub 在編輯頁叫
// 「引言（大字）」，不是其他方向的「副標」；422 定位靠標籤，兩邊要一致。
const LIST_ITEM_FIELD_LABELS: Record<string, Record<string, string>> = {
  curriculum_page: { 'directions[3].sub': '引言（大字）' },
}

function listFieldLabel(kind: string | undefined, list: string, index: unknown, field: string): string | undefined {
  const override = kind && typeof index === 'number' ? LIST_ITEM_FIELD_LABELS[kind]?.[`${list}[${index}].${field}`] : undefined
  return override ?? LIST_FIELD_LABELS[list]?.[field]
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
    const label = (parentList && listFieldLabel(kind, parentList, path[i - 1], segment)) || (parts.length ? contentFieldLabel(segment) : contentFieldLabelFor(kind, segment))
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
  let index: unknown
  for (let i = path.length - 3; i >= 0; i--) {
    const segment = path[i]
    if (typeof segment === 'string' && typeof path[i + 1] === 'number') {
      list = segment
      index = path[i + 1]
      break
    }
  }
  return (list && listFieldLabel(kind, list, index, last)) || (path.length === 1 ? contentFieldLabelFor(kind, last) : contentFieldLabel(last))
}
