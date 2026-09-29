import { contentFieldLabel } from './labels'

// 差異清單（發布、核准、還原）的欄位名要和編輯頁的表單標籤一致，使用者才對得上
// 「改了哪裡」。同一個欄位鍵在不同內容種類的表單叫法不同（例如 intro 在分校
// 基本資料叫「一句話簡介」），所以依內容種類覆寫；沒列到的退回全站通用名稱。
const KIND_FIELD_LABELS: Record<string, Record<string, string>> = {
  home_hero: {
    eyebrow: '標語上方的小標',
    copy_lines: '標語',
    poster: '影片封面照片',
    poster_alt: '影片封面的圖片說明',
    fallback_image: '影片載入失敗時的替代圖',
  },
  home_about: {
    photo_alt: '照片的圖片說明',
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
    film_poster: '背景影片的封面照片',
    moments: '時刻卡',
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
