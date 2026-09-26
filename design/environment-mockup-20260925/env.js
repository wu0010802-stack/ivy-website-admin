// 常春藤環境 mockup v4：頁首收合＋餐點書按鈕開到當月那一頁。只供 design/ 預覽，不是正式站程式。
// 模擬日期：?date=YYYY-MM-DD
(() => {
  const params = new URLSearchParams(location.search)

  // ---------- 頁首：模擬正式站 SiteHeader 的捲動收合 ----------
  const header = document.querySelector('.header')
  const syncHeader = () => {
    const compact = scrollY > 40
    header.classList.toggle('is-scrolled', compact)
    header.dataset.state = compact ? 'compact' : 'hero'
  }
  addEventListener('scroll', syncHeader, { passive: true })
  syncHeader()

  // ---------- 餐點書：直接導向當月菜單那一頁，不抄菜單資料 ----------
  // 營養餐點書每月一頁：1–6 月第 10–15 頁，7–12 月第 17–22 頁（第 16 頁是文章）。
  const BOOK = 'https://online.flipbuilder.com/nrpb/toby/index.html'
  const MENU_PAGE = { 1: 10, 2: 11, 3: 12, 4: 13, 5: 14, 6: 15, 7: 17, 8: 18, 9: 19, 10: 20, 11: 21, 12: 22 }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('date') || '')
  const month = m ? +m[2] : new Date().getMonth() + 1
  document.querySelectorAll('[data-book-month]').forEach((a) => {
    a.href = `${BOOK}#p=${MENU_PAGE[month]}`
    if (a.hasAttribute('aria-label')) a.setAttribute('aria-label', `打開營養餐點書的 ${month} 月菜單（另開新視窗）`)
  })
  document.querySelectorAll('[data-book-label]').forEach((el) => { el.textContent = `看 ${month} 月菜單` })
  document.querySelectorAll('[data-book-month-text]').forEach((el) => { el.textContent = `${month} 月` })
  document.querySelectorAll('[data-chapter-meal]').forEach((el) => { el.textContent = `${month} 月菜單` })
})()
