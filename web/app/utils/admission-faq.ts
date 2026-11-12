// 入學資訊頁「常見問題」（2026-11-03 使用者要求「多新增幼兒園的 QA」「退費小一點或拿掉」）。
// 原本第 5 頁「收退費辦法」整章（補助券、育兒津貼表、五條退費條款）收進這裡：補助那題預設打開、
// 退費變成一題、預設收合。津貼表、補助券、退費條款仍讀後台 admission_content（slot 指定插在哪一題），
// 其餘問答寫在這裡、不開放後台編輯（後台 FAQ 內容種類 2026-10-08 已刪）。
//
// 答案只寫站上查得到的事實（入學頁流程與叮嚀、常春藤環境的衛廁與餐點）；
// 各校不同或沒有資料的（作息時間、交通車、課後延托、學費金額、生病規定）不寫，請家長直接問校區。
// 這頁不放預約參觀入口（2026-09-28 裁定）：「怎麼預約參觀」只寫頁首按鈕在哪、列各校電話，不連到 /visit。

import type { AdmissionContent, Campus } from '../types/site-content'

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
    // 2026-11-04 TA 檢視：轉園與學期中入學原本分兩題、收在第 2、3 題又預設收合，急著轉園的家長要捲到頁面底部才找得到；
    // 合成一題放第一題、預設打開，題目下直接列各校電話。「幾歲可以入學」改成滿 2 歲有名額就能入學（園方海報
    // 「滿2歲即可入學」），學期中入學編在哪一班各校安排不同，不寫死。「怎麼預約參觀」不寫死哪幾校能線上預約。
    items: [
      {
        id: 'faq-transfer',
        q: '現在轉園或插班可以嗎？',
        a: ['可以。依生日直接讀同齡的班，不用從幼幼班讀起；那一班還有名額，學期中就能轉入。學費和雜費依入園時間按比例收取，越晚入園收得越少。歡迎先打電話問想讀的校區現在有沒有名額。'],
        slot: 'phones',
        open: true
      },
      {
        id: 'faq-age',
        q: '寶貝幾歲可以入學？',
        a: ['滿 2 歲、有名額就可以入學。分班看生日：9 月 2 日到隔年 9 月 1 日出生的孩子同一屆，一起從幼幼班升小班、中班、大班。還沒到幼幼班年紀、先滿 2 歲來上學的寶貝，編在哪一班，參觀時可以和校區確認。'],
        link: { href: '#birthday-tool', label: '輸入生日查班別' }
      },
      {
        id: 'faq-visit',
        q: '怎麼預約參觀？',
        a: ['頁首的「預約參觀」可以選校區：開放線上場次的校區直接選日期和場次，其他校區請打電話約時間。'],
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
        // 2026-11-10：「依胎次補助」沒講補助叫什麼；直接說是育兒津貼、金額看第幾胎（下面就是津貼表）。
        a: ['有。讀私立幼兒園，每個月可以領育兒津貼，金額看是第幾胎。'],
        slot: 'allowance',
        open: true
      },
      {
        id: 'faq-tuition',
        q: '學費大概多少？',
        // 2026-11-10：原本只寫「參觀時可以直接問」，電話卻放在別題；學費是決定要不要參觀之前就想知道的事，這題直接列各校電話。
        // 「收退費通知單前一個月公告」是在學家長的事，新生準備的註冊須知已經寫了，這裡不重複。
        a: ['各校、各班別的收費不同。歡迎直接打電話問想讀的校區，或參觀時當面問我們。'],
        slot: 'phones'
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
        a: ['可以。教室連著套房式衛廁，老師隨時留意寶貝上廁所的情形，陪寶貝慢慢練習。開學前導師打電話來時，可以先聊聊寶貝現在的習慣。']
      },
      {
        id: 'faq-cry',
        q: '剛上學一直哭，怎麼辦？',
        a: ['剛開始哭很正常。前三天以半天為主，讓寶貝慢慢熟悉；到校時哭得比較厲害，您可以先陪一下。第一天建議早點起床、早點到校，在家吃完早餐再來，寶貝會比較安心。'],
        link: { href: '#newcomer', label: '看新生準備' }
      },
      {
        // 2026-11-04 TA 檢視：常接送的是阿公阿嬤，接送規則原本只在新生準備的接送安全（手機約第 7 屏）。
        // 只寫新生準備已有的事實（代接前 30 分鐘來電、確認身分並登記）。2026-11-12 使用者：學校沒有接送證，一律打電話；「麻煩」改「請」。
        id: 'faq-pickup',
        q: '阿公阿嬤或保母可以來接嗎？',
        a: ['可以。阿公阿嬤、保母或其他人來接寶貝時，請在對方到校前 30 分鐘打電話告訴老師；老師確認身分、登記之後，才會把寶貝交給對方。'],
        link: { href: '#newcomer', label: '看新生準備' }
      },
      {
        id: 'faq-meals',
        q: '每天吃什麼？寶貝會過敏怎麼辦？',
        a: ['廚房每天現煮早餐、午餐和下午點心，另外每天兩份蔬果。寶貝對食物過敏或有不能吃的東西，參觀時或開學前導師打電話來時，請先告訴我們。'],
        link: { href: '/environment#meals', label: '看幼兒餐點' }
      }
      // 2026-11-12「有美語課嗎？」整題拿掉（使用者：先整段拿掉）。幼兒園不能分科教美語、只能融入式，要加回來先問使用者，
      // 不寫「美語課」「沉浸式」「全美語」、不強調國際校。後台成效統計的 faq_english 名稱對照留著給舊紀錄用。
    ]
  }
]

/** 這題要不要出現：讀後台內容的題目，內容清空就整題拿掉（頁面、結構化資料、llms.txt 共用）。 */
export function admissionFaqVisible(item: AdmissionFaqItem, admission: Pick<AdmissionContent, 'allowance' | 'subsidies' | 'refunds'>): boolean {
  if (item.slot === 'allowance') return admission.allowance.length > 0 || admission.subsidies.length > 0
  if (item.slot === 'refunds') return admission.refunds.length > 0
  return true
}

const sentence = (text: string) => {
  const value = text.replace(/\s+/g, ' ').trim()
  return !value || /[。！？；：]$/.test(value) ? value : `${value}。`
}

/** 插在答案後面的後台內容，攤平成和頁面上同一份資訊的句子。 */
function slotText(item: AdmissionFaqItem, admission: AdmissionContent, campuses: Pick<Campus, 'name' | 'phone'>[]): string[] {
  if (item.slot === 'phones') {
    const phones = campuses.filter((campus) => campus.phone).map((campus) => `${campus.name} ${campus.phone}`)
    return phones.length ? [`各校電話：${phones.join('、')}。`] : []
  }
  if (item.slot === 'allowance') {
    const out = admission.subsidies.map((subsidy) => sentence(`${subsidy.by}${subsidy.amount}${subsidy.unit}（${subsidy.who}）`))
    if (admission.allowance.length) {
      out.push(sentence(`${admission.allowanceTitle}：${admission.allowance.map((row) => `${row.order}每月 ${row.amount} 元`).join('、')}`))
      if (admission.allowanceNote) out.push(sentence(admission.allowanceNote))
    }
    return out
  }
  if (item.slot === 'refunds') {
    const out = admission.feeIntro ? [sentence(admission.feeIntro)] : []
    for (const refund of admission.refunds) {
      const groups = refund.groups.map((group) => `${group.label ? `${group.label}：` : ''}${group.lines.join('；')}`).join('。')
      out.push(sentence(`${refund.title}——${groups}`))
      if (refund.note) out.push(sentence(refund.note))
    }
    out.push('實際金額以學校開的退費單據為準。')
    return out
  }
  return []
}

export interface AdmissionFaqEntry { id: string; q: string; a: string }

/**
 * 常見問題的純文字版（2026-11-11，/admission 的 FAQPage 結構化資料與 llms.txt 用）：題目、順序、
 * 顯示條件都和頁面上的 `<details>` 同一份，後台內容的區塊（津貼表、退費條款、各校電話）攤平成句子，
 * 不另寫頁面上沒有的答案。沒有答案文字的題目不列。
 */
export function admissionFaqEntries(admission: AdmissionContent, campuses: Pick<Campus, 'name' | 'phone'>[]): AdmissionFaqEntry[] {
  return ADMISSION_FAQ.flatMap((group) => group.items)
    .filter((item) => admissionFaqVisible(item, admission))
    .map((item) => ({ id: item.id, q: item.q, a: [...item.a.map(sentence), ...slotText(item, admission, campuses)].filter(Boolean).join('') }))
    .filter((entry) => entry.a)
}
