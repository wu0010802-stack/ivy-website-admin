// 整頁內容的字數硬上限實測：把每個欄位換成「上限字數」的文字（標題換成上限行數 × 每行上限），
// 檢查 390／820／901／1024／1440 寬（手機、760–900、900–1100、桌機四段版面，901 是立體書桌機版最窄的寬度）
// 沒有橫向捲動、文字沒有超出所在卡片或被裁掉。改了 page_schemas.py 的上限就重跑。
// 用法（fixture 模式 dev server，計畫 Task 1 Step 2）：node scripts/page-copy-stress.cjs /curriculum
// 截圖存在 output/page-cms/stress/，失敗時結束碼 1。
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.PAGE_CMS_BASE ?? 'http://127.0.0.1:3141'
// curriculum.css 的斷點是 1100／900／760：390／820／1024／1440 各落在一段；about.css 的桌機版
// （立體書左右頁、章名旁的紀念章）從 901 開始，901 是左頁最窄、標題最容易碰到紀念章的寬度
const VIEWPORTS = [
  ['390', { width: 390, height: 844 }],
  ['820', { width: 820, height: 1180 }],
  ['901', { width: 901, height: 900 }],
  ['1024', { width: 1024, height: 768 }],
  ['1440', { width: 1440, height: 900 }]
]
const SAMPLE = [...'常春藤的孩子，在這裡快樂學習、慢慢長大。']
const fill = (n) => Array.from({ length: n }, (_, i) => SAMPLE[i % SAMPLE.length]).join('')

// sel：要換字的元素（全部符合的都換）；chars：一般欄位上限；lines＋perLine：標題（perLine 是陣列＝逐行上限）；
// avoid：標題每一行的字都不能碰到這個圓形元素（中心＋半徑，量 offsetWidth，不受轉動影響）。每一行的左右用 Range
// 量；上下換成字的墨跡：Range 的矩形是字型的 content area（ascent＋descent），LINE Seed TW 在 901 寬 63px 高、
// 墨跡只有約 36px，照原框量，內建標題第二行在 901 寬也算重疊 9px，截圖上字離金幣還有空隙。
// 墨跡用 canvas measureText：fontBoundingBoxAscent 從矩形上緣換算基線，actualBoundingBox 是整個標題的字最高最低處；
// textNode：只換元素自己的第一個文字節點（元素裡還有 <b>／<small> 等子元素時用）；box：不能超出的外框；
// paint：印在顏料上的字，每一行的四個角都要落在 box 裡這團顏料的實心範圍內：utils/watercolor.ts blotCanvas
// 的基底橢圓（半徑為顏料框的 0.34 × 0.31），頂點本身有 ±17.5% 的起伏，所以容許到 (x/rx)²+(y/ry)² ≤ 1.1
// （2026-10-04 截圖校準：1440 寬兩行 1.03 仍壓在顏料上，三行 1.34 頂到顏料邊外）
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
    { sel: '.cur-dir:not(.cur-dir--quote) .cur-dir-sub', chars: 30, box: '.cur-dir' },
    { sel: '.cur-dir:not(.cur-dir--quote) .cur-dir-copy > p:last-child', chars: 50, box: '.cur-dir' },
    // 品德培養印在顏料上：引言是大字、下面一行說明（page_schemas.py 的 QUOTE_SUB_LIMIT、QUOTE_TEXT_LIMIT）。
    // 說明超過一行（1440 寬約 21 字）會把引言往上推出顏料，所以兩個上限一起量。
    { sel: '.cur-dir--quote .cur-dir-sub', chars: 10, box: '.cur-dir--quote', paint: '.cur-blot' },
    { sel: '.cur-dir--quote .cur-dir-copy > p:last-child', chars: 20, box: '.cur-dir--quote' },
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
  ],
  '/about': [
    { sel: '.abk-hero-text h1', lines: 3, perLine: 12 },
    { sel: '.abk-lede', chars: 120 },
    { sel: '.abk-pop.is-hero figcaption', chars: 20, box: '.abk-pop.is-hero' },
    { sel: '.abk-toc li span', chars: 6, box: '.abk-toc li' },
    { sel: '.abk-chap > span', chars: 6 },
    { sel: '.abk-cover b', chars: 6, box: '.abk-cover' },
    // 右上角是紀念章：逐行上限第一行 6、第二三行 7（page_schemas.py 的 STORY_TITLE_PER_LINE）
    { sel: '#story-title', lines: 3, perLine: [6, 7, 7], box: '.abk-page', avoid: '.abk-medal.is-title' },
    { sel: '#whole-title', lines: 3, perLine: 12, box: '.abk-page' },
    { sel: '#hope-title', lines: 3, perLine: 14, box: '.abk-page' },
    { sel: '#story .abk-text', chars: 120, box: '.abk-page' },
    { sel: '.abk-list li div > p', chars: 30, box: '.abk-list li' },
    { sel: '#whole-child .abk-text', chars: 100, box: '.abk-page' },
    { sel: '.abk-fine', chars: 100, textNode: true, box: '.abk-page' },
    { sel: '.abk-fine small', chars: 30, box: '.abk-page' },
    { sel: '.abk-quote p', chars: 70, box: '.abk-page' },
    { sel: '#about-campuses-title', chars: 6 },
    { sel: '.abk-outro-copy p', chars: 80 }
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
    for (const [device, viewport] of VIEWPORTS) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: process.env.STRESS_MOTION ? 'no-preference' : 'reduce' })
      const page = await context.newPage()
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      const { problems, notes } = await page.evaluate(async ({ rules, sample }) => {
        const fillIn = (n) => Array.from({ length: n }, (_, i) => sample[i % sample.length]).join('')
        const touched = []
        for (const rule of rules) {
          const els = [...document.querySelectorAll(rule.sel)]
          if (els.length === 0) touched.push({ rule, missing: true })
          for (const el of els) {
            if (rule.lines) {
              // mark：第一行含一個上限字數的顏料標示（元件的 .cur-swash＋.cur-blot），其餘字數補滿該行
              el.innerHTML = Array.from({ length: rule.lines }, (_, i) => {
                const perLine = Array.isArray(rule.perLine) ? rule.perLine[Math.min(i, rule.perLine.length - 1)] : rule.perLine
                if (!rule.mark || i) return fillIn(perLine)
                const before = fillIn(perLine - rule.mark)
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
        await document.fonts.ready
        const out = []
        const notes = []
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
          const paint = box && rule.paint ? box.querySelector(`:scope > ${rule.paint}`) : null
          if (rule.paint && !paint) out.push(`找不到 ${rule.box} 裡的 ${rule.paint}`)
          if (paint) {
            // 顏料還沒上色時是 scale(.5)：用 offset* 量版面上的框（不受 transform 影響）
            const b = box.getBoundingClientRect()
            const cx = b.left + box.clientLeft + paint.offsetLeft + paint.offsetWidth / 2
            const cy = b.top + box.clientTop + paint.offsetTop + paint.offsetHeight / 2
            const rx = paint.offsetWidth * 0.34, ry = paint.offsetHeight * 0.31
            const range = document.createRange()
            range.selectNodeContents(el)
            const lines = [...range.getClientRects()].filter((r) => r.width > 0)
            const worst = Math.max(...lines.flatMap((r) => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
              .map(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)))
            if (worst > 1.1) out.push(`${rule.sel} 超出顏料（${lines.length} 行，最遠的角在橢圓 ${worst.toFixed(2)} 倍處）`)
          }
          const avoid = rule.avoid ? document.querySelector(rule.avoid) : null
          if (rule.avoid && !avoid) out.push(`找不到 ${rule.avoid}`)
          // display:none（手機版紀念章改在右頁接縫）時 offsetWidth 是 0，不量
          if (avoid && avoid.offsetWidth > 0) {
            const m = avoid.getBoundingClientRect()
            const cx = m.left + m.width / 2, cy = m.top + m.height / 2, r = avoid.offsetWidth / 2
            const canvas = document.createElement('canvas').getContext('2d')
            canvas.font = getComputedStyle(el).font
            const ink = canvas.measureText(el.textContent)
            const range = document.createRange()
            range.selectNodeContents(el)
            // 同一行可能拆成好幾個矩形：依 top 合併成一行一個
            const lines = new Map()
            for (const x of [...range.getClientRects()].filter((x) => x.width > 1)) {
              const key = Math.round(x.top)
              const line = lines.get(key)
              lines.set(key, line
                ? { left: Math.min(line.left, x.left), right: Math.max(line.right, x.right), top: Math.min(line.top, x.top), bottom: Math.max(line.bottom, x.bottom) }
                : { left: x.left, right: x.right, top: x.top, bottom: x.bottom })
            }
            const gaps = [...lines.values()].map((line) => {
              const baseline = line.top + ink.fontBoundingBoxAscent
              const top = baseline - ink.actualBoundingBoxAscent, bottom = baseline + ink.actualBoundingBoxDescent
              const dx = Math.max(line.left - cx, 0, cx - line.right), dy = Math.max(top - cy, 0, cy - bottom)
              return Math.round(Math.hypot(dx, dy) - r)
            })
            if (gaps.some((gap) => gap < 0)) out.push(`${rule.sel} 壓到 ${rule.avoid}（每行和它的距離 ${gaps.join('／')}px，負數＝重疊）`)
            else notes.push(`${rule.sel} 每行和 ${rule.avoid} 的距離 ${gaps.join('／')}px`)
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
        return { problems: [...new Set(out)], notes: [...new Set(notes)] }
      }, { rules, sample: SAMPLE })
      if (process.env.STRESS_MOTION) {
        // 一般動態：逐段捲過整頁，讓釘住的立體書翻頁、紀念章啟動，再依捲動位置截圖
        const h = await page.evaluate(() => document.documentElement.scrollHeight)
        const step = Math.round(viewport.height * 0.8)
        for (let y = 0, n = 0; y < h; y += step, n++) {
          await page.evaluate((top) => window.scrollTo(0, top), y)
          await page.waitForTimeout(900)
          await page.screenshot({ path: path.join(outDir, `${route.slice(1)}-motion-${device}-${String(n).padStart(2, '0')}.png`) })
        }
      } else await page.screenshot({ path: path.join(outDir, `${route.slice(1)}-${device}.png`), fullPage: true })
      console.log(`${route} ${device}: ${problems.length ? problems.join('；') : '通過'}${notes.length ? `（${notes.join('；')}）` : ''}`)
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
