import type { SiteContent } from '../types/site-content'

const OLD_DESCRIPTION = '走進常春藤，認識五校的環境與孩子的校園生活。官網設計互動提案。'
const OLD_BOOKING = '先選擇想參觀的校區，再留下家長稱呼、電話與方便聯絡的時段。這份 prototype 僅示範流程，不會送出資料；實際參觀請直接致電園所。'

/** 僅替換已知原型原文，不蓋掉園方後來發布的自訂說明。 */
export function publicCopy(site: SiteContent): SiteContent {
  return {
    ...site,
    siteMeta: { ...site.siteMeta, description: site.siteMeta.description === OLD_DESCRIPTION
      ? '認識高雄常春藤幼兒園義華、明華、崇德、國際與仁武五校，查看校園環境、所在地、聯絡方式與參觀資訊。'
      : site.siteMeta.description },
    footer: { ...site.footer, bottomNote: site.footer.bottomNote === '官網設計提案 · 預約為操作示範，不會送出資料'
      ? '參觀時間與入學資訊，請向各校確認。' : site.footer.bottomNote },
    booking: { ...site.booking, consentText: site.booking.consentText === '我了解這是操作示範，資料不會傳送給學校，不代表預約成立。'
      ? '我同意園方使用本次填寫的資料聯絡與安排參觀；送出需求後，仍須由園方確認參觀時間。' : site.booking.consentText },
    campuses: site.campuses.map((campus) => {
      const isLegacy = campus.faq.items.some((item) => item.a === OLD_BOOKING)
      if (!isLegacy) return campus
      const items = campus.faq.items.map((item) => {
        if (item.a === OLD_BOOKING) return { ...item, a: `請先選擇${campus.name}，查看目前開放的參觀聯絡方式，也可致電 ${campus.phone} 詢問。若開放線上填寫，送出的是參觀需求，仍須由園方聯絡確認時間，才算預約成立。` }
        if (item.a === `招生年齡、名額與費用依校區與學年度而異。請向${campus.name}確認；這份提案不提供即時招生名額或費用報價。`) return { ...item, a: `招生年齡、名額與費用依校區與學年度而異。請致電 ${campus.phone} 向${campus.name}確認當期資訊。` }
        return item
      })
      items.push({ q: `${campus.name}在哪裡？如何聯絡？`, a: `${campus.name}位於${campus.address}，參觀專線為 ${campus.phone}。請事先聯絡園所確認接待時間，再使用本頁的地圖與路線連結規劃交通。` })
      return { ...campus, faq: { ...campus.faq, items } }
    })
  }
}
