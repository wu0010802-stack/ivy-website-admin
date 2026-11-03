// 入學資訊頁「常見問題」（2026-11-03 使用者要求「多新增幼兒園的 QA」「退費小一點或拿掉」）。
// 原本第 5 頁「收退費辦法」整章（補助券、育兒津貼表、五條退費條款）收進這裡：補助那題預設打開、
// 退費變成一題、預設收合。津貼表、補助券、退費條款仍讀後台 admission_content（slot 指定插在哪一題），
// 其餘問答寫在這裡、不開放後台編輯（後台 FAQ 內容種類 2026-10-08 已刪）。
//
// 答案只寫站上查得到的事實（入學頁流程與叮嚀、常春藤環境的衛廁與餐點、特色教學的美語、國際校的美語商店街）；
// 各校不同或沒有資料的（作息時間、交通車、課後延托、學費金額、生病規定）不寫，請家長直接問校區。
// 這頁不放預約參觀入口（2026-09-28 裁定）：「怎麼預約參觀」只寫頁首按鈕在哪、列各校電話，不連到 /visit。

export type AdmissionFaqSlot = 'allowance' | 'refunds' | 'phones'

export interface AdmissionFaqItem {
  /** 錨點；補助那題沿用舊章節的 #fees，舊連結還落得到補助 */
  id: string
  q: string
  a: string[]
  /** 插在答案後面、讀後台內容的區塊 */
  slot?: AdmissionFaqSlot
  /** 站內延伸連結（頁內錨點或其他分頁），不放 /visit */
  link?: { href: string; label: string }
  open?: boolean
}

export interface AdmissionFaqGroup {
  title: string
  items: AdmissionFaqItem[]
}

export const ADMISSION_FAQ: AdmissionFaqGroup[] = [
  {
    title: '入學與分班',
    items: [
      {
        id: 'faq-age',
        q: '寶貝幾歲可以入學？',
        a: ['當年 9 月 1 日前滿 2 歲，那一學年就可以讀幼幼班，之後依序升小班、中班、大班。'],
        link: { href: '#birthday-tool', label: '輸入生日查班別' }
      },
      {
        id: 'faq-transfer',
        q: '從別的幼兒園轉過來，要從哪一班讀起？',
        a: ['依生日分班，直接讀同齡的班，不用從幼幼班讀起。']
      },
      {
        id: 'faq-midterm',
        q: '學期中也可以入學嗎？',
        a: ['名額許可就可以，先打電話問想讀的校區。學費和雜費依入園時間按比例收取，越晚入園收得越少。']
      },
      {
        id: 'faq-visit',
        q: '怎麼預約參觀？',
        a: ['點頁首的「預約參觀」線上預約，或直接打電話給想參觀的校區。'],
        slot: 'phones'
      }
    ]
  },
  {
    title: '費用與補助',
    items: [
      {
        id: 'fees',
        q: '讀私立幼兒園有補助嗎？',
        a: ['有，每個月依胎次補助。'],
        slot: 'allowance',
        open: true
      },
      {
        id: 'faq-tuition',
        q: '學費大概多少？',
        a: ['各校、各班別的收費不同，參觀時可以直接問。新學期的收退費通知單，會在每學期結束前一個月公告。']
      },
      {
        id: 'faq-refund',
        q: '中途入園、離園或請假，費用怎麼算？',
        a: [],
        slot: 'refunds'
      }
    ]
  },
  {
    title: '上學之後',
    items: [
      {
        id: 'faq-diaper',
        q: '還沒戒尿布，可以入學嗎？',
        a: ['可以。教室連著套房式衛廁，老師隨時留意寶貝的如廁狀況，陪寶貝慢慢練習。開學前導師來電時，可以先聊聊寶貝現在的習慣。']
      },
      {
        id: 'faq-cry',
        q: '剛上學一直哭，怎麼辦？',
        a: ['剛開始哭很正常。前三天以半天為主，讓寶貝慢慢熟悉；入園時情緒比較明顯，爸爸媽媽可以稍微陪一下。第一天早點起床、早點到校，吃完早餐再入園，寶貝會比較安心。'],
        link: { href: '#newcomer', label: '看新生準備' }
      },
      {
        id: 'faq-meals',
        q: '每天吃什麼？寶貝會過敏怎麼辦？',
        a: ['廚房每天現煮早餐、午餐和下午點心，另外每天兩份蔬果。食物過敏或特殊飲食需求，參觀時或開學前導師來電時，先告訴我們。'],
        link: { href: '/environment#meals', label: '看幼兒餐點' }
      },
      {
        id: 'faq-english',
        q: '有美語課嗎？',
        a: ['有。早餐時間有早餐美語，課程裡也有沉浸式美語活動；國際校還有一條美語商店街，孩子在模擬的醫院、餐廳裡用美語玩。'],
        link: { href: '/curriculum#directions', label: '看特色教學' }
      }
    ]
  }
]
