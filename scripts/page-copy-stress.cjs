// 整頁內容的字數硬上限實測：把每個欄位換成「上限字數」的文字（標題換成上限行數 × 每行上限），
// 檢查 390 與 1440 寬沒有橫向捲動、文字沒有超出所在卡片或被裁掉。改了 page_schemas.py 的上限就重跑。
// 用法（fixture 模式 dev server，計畫 Task 1 Step 2）：node scripts/page-copy-stress.cjs /curriculum
// 截圖存在 output/page-cms/stress/，失敗時結束碼 1。
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.PAGE_CMS_BASE ?? 'http://127.0.0.1:3141'
const SAMPLE = [...'常春藤的孩子，在這裡快樂學習、慢慢長大。']
const fill = (n) => Array.from({ length: n }, (_, i) => SAMPLE[i % SAMPLE.length]).join('')

// sel：要換字的元素（全部符合的都換）；chars：一般欄位上限；lines＋perLine：標題；
// textNode：只換元素自己的第一個文字節點（元素裡還有 <b>／<small> 等子元素時用）；box：不能超出的外框
const RULES = {
  '/curriculum': [
    { sel: '.cur-eyebrow', chars: 24 },
    { sel: '#curriculum-title', lines: 3, perLine: 14, mark: 8 },
    { sel: '.cur-lede', chars: 90 },
    { sel: '.cur-notice', chars: 60 },
    { sel: '.cur-index-copy b', chars: 10, box: '.cur-index a' },
    { sel: '.cur-index-copy > span', chars: 14, box: '.cur-index a' },
    { sel: '#years-title, #directions-title, #gallery-title, #daily-title', lines: 3, perLine: 16 },
    { sel: '.cur-years-head .cur-text, .cur-dir-head .cur-text', chars: 80 },
    { sel: '.cur-spiral b', chars: 10 },
    { sel: '.cur-spiral', chars: 60, textNode: true },
    { sel: '.cur-years-photo figcaption', chars: 30 },
    { sel: '.cur-year h3', chars: 12, box: '.cur-year' },
    { sel: '.cur-year > p:not(.cur-year-name)', chars: 100, box: '.cur-year' },
    { sel: '.cur-dir h3', chars: 10, box: '.cur-dir' },
    { sel: '.cur-dir-sub', chars: 30, box: '.cur-dir' },
    { sel: '.cur-dir-copy > p:last-child', chars: 50, box: '.cur-dir' },
    { sel: '.cur-split-head .cur-text', chars: 80, textNode: true },
    { sel: '#gallery .cur-source', chars: 50 },
    { sel: '#daily .cur-source', chars: 30 },
    { sel: '.cur-art > span', chars: 10, box: '.cur-art' },
    { sel: '.cur-thing h3', chars: 8, box: '.cur-thing' },
    { sel: '.cur-thing > p:last-child', chars: 160, box: '.cur-thing' },
    { sel: '#belief-title', lines: 3, perLine: 18 },
    { sel: '.cur-belief-list li', chars: 24, textNode: true },
    { sel: '.cur-belief-close', chars: 50, textNode: true },
    { sel: '.cur-belief-close .cur-source', chars: 30 }
  ]
}

;(async () => {
  const route = process.argv[2]
  const rules = RULES[route]
  if (!rules) {
    console.error(`用法：node scripts/page-copy-stress.cjs ${Object.keys(RULES).join('|')}`)
    process.exit(2)
  }
  const outDir = path.join('output', 'page-cms', 'stress')
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  let failed = 0
  try {
    for (const [device, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const page = await context.newPage()
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      const problems = await page.evaluate(async ({ rules, sample }) => {
        const fillIn = (n) => Array.from({ length: n }, (_, i) => sample[i % sample.length]).join('')
        const touched = []
        for (const rule of rules) {
          const els = [...document.querySelectorAll(rule.sel)]
          if (els.length === 0) touched.push({ rule, missing: true })
          for (const el of els) {
            if (rule.lines) {
              // mark：第一行含一個上限字數的顏料標示（元件的 .cur-swash＋.cur-blot），其餘字數補滿該行
              el.innerHTML = Array.from({ length: rule.lines }, (_, i) => {
                if (!rule.mark || i) return fillIn(rule.perLine)
                const before = fillIn(rule.perLine - rule.mark)
                return `${before}<span class="cur-swash"><span class="cur-blot cur-swash-paint" data-blot="orange" aria-hidden="true"></span>${fillIn(rule.mark)}</span>`
              }).join('<br>')
            }
            else if (rule.textNode) {
              const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
              if (node) node.textContent = fillIn(rule.chars)
            } else el.textContent = fillIn(rule.chars)
            touched.push({ rule, el })
          }
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const out = []
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`整頁橫向捲動：${document.documentElement.scrollWidth} > ${window.innerWidth}`)
        for (const { rule, el, missing } of touched) {
          if (missing) { out.push(`找不到 ${rule.sel}`); continue }
          const rect = el.getBoundingClientRect()
          // 只量文字本身：略過 aria-hidden 的裝飾層（顏料 .cur-blot 會用負 inset 外擴，不算文字溢出）
          const textRight = Math.max(rect.left, ...[...el.childNodes]
            .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.getAttribute('aria-hidden') === 'true'))
            .map((n) => { const range = document.createRange(); range.selectNodeContents(n); return range.getBoundingClientRect().right }))
          if (textRight > rect.right + 1) out.push(`${rule.sel} 文字橫向溢出自己的框`)
          const box = rule.box ? el.closest(rule.box) : null
          if (box) {
            const b = box.getBoundingClientRect()
            if (rect.right > b.right + 1 || rect.bottom > b.bottom + 1) out.push(`${rule.sel} 超出 ${rule.box}`)
          }
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const style = getComputedStyle(a)
            // 橫向捲動容器（手機的卡片橫滑帶）：卡片排在它的捲動範圍內，只檢查垂直方向，且不再往外層比對
            if (/(auto|scroll)/.test(style.overflowX)) {
              const r = a.getBoundingClientRect()
              if (rect.bottom > r.bottom + 1) out.push(`${rule.sel} 被橫滑帶 ${a.className || a.tagName} 裁掉`)
              break
            }
            if (/(hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
              const r = a.getBoundingClientRect()
              if (rect.bottom > r.bottom + 1 || rect.right > r.right + 1) { out.push(`${rule.sel} 被 ${a.className || a.tagName} 裁掉`); break }
            }
          }
        }
        return [...new Set(out)]
      }, { rules, sample: SAMPLE })
      await page.screenshot({ path: path.join(outDir, `${route.slice(1)}-${device}.png`), fullPage: true })
      console.log(`${route} ${device}: ${problems.length ? problems.join('；') : '通過'}`)
      failed += problems.length
      await context.close()
    }
  } finally {
    await browser.close()
  }
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
