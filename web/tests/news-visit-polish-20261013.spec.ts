import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { NewsArticle, SiteContent } from '../app/types/site-content'
import { articlesForCampus, newsInCampus, titleClauses } from '../app/utils/news-content'

// 2026-10-13 最新消息、預約流程與 404 的精修。
const site = fixture as unknown as SiteContent
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const article = (over: Partial<NewsArticle>): NewsArticle => ({
  id: 'a', date: '2026-09-01', campus: '全校', campusKeys: [], category: '校園日常', title: '標題', description: '摘要', image: 'garden', alt: '', ...over
})

describe('校區篩選：內建示意消息沒有 campusKeys 時比對校名', () => {
  it('/news?campus=yihua 只列義華校的示意消息，不再混入另外四校', () => {
    const list = articlesForCampus(site.news.articles, 'yihua', '義華校')
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((item) => item.campus === '義華校')).toBe(true)
    expect(articlesForCampus(site.news.articles, 'renwu', '仁武校').map((item) => item.campus)).toEqual(['仁武校'])
  })

  it('後台內容照舊看 campusKeys：空陣列＝全校（含舊版手打的校區文字），指定校區只在那一校', () => {
    const global = article({ id: 'g', campus: '全校', campusKeys: [] })
    const legacy = article({ id: 'l', campus: '義華校', campusKeys: [] })
    const renwu = article({ id: 'r', campus: '仁武校', campusKeys: ['renwu'] })
    expect(articlesForCampus([global, legacy, renwu], 'yihua', '義華校').map((a) => a.id)).toEqual(['g', 'l'])
    expect(articlesForCampus([global, legacy, renwu], 'minghua', '明華校').map((a) => a.id)).toEqual(['g', 'l'])
  })

  it('沒有 campusKeys：「全校」、多校清單裡有這一校才算；沒給校名時照舊都算', () => {
    expect(newsInCampus({ campus: '全校' }, 'yihua', '義華校')).toBe(true)
    expect(newsInCampus({ campus: '義華校、明華校' }, 'minghua', '明華校')).toBe(true)
    expect(newsInCampus({ campus: '仁武校' }, 'yihua', '義華校')).toBe(false)
    expect(newsInCampus({ campus: '仁武校' }, 'yihua')).toBe(true)
  })

  it('列表頁的消息與近期活動都用同一條規則，傳入校名', () => {
    const index = read('../app/components/NewsIndexContent.vue')
    expect(index).toContain('articlesForCampus(props.news.articles, campusKey.value, campusName.value)')
    expect(index).toContain('newsInCampus(e, campusKey.value, campusName.value)')
  })
})

describe('消息標題依句中標點分段', () => {
  it('標點留在前一段尾，接回去和原標題一樣', () => {
    expect(titleClauses('小小園丁，把好奇心種進生活裡。')).toEqual(['小小園丁，', '把好奇心種進生活裡。'])
    expect(titleClauses('新朋友、新發現，校園生活開始了。')).toEqual(['新朋友、', '新發現，', '校園生活開始了。'])
    expect(titleClauses('一起認識崇德校的每個小角落。')).toEqual(['一起認識崇德校的每個小角落。'])
    for (const item of site.news.articles) expect(titleClauses(item.title).join('')).toBe(item.title)
  })

  it('列表 h3 與單篇 h1 包 inline-block 的 .np-clause；hover 底線畫在每一段上', () => {
    const css = read('../app/assets/css/news-page.css')
    expect(read('../app/components/NewsIndexContent.vue')).toContain('<NuxtLink :to="newsPath(item.id)"><span v-for="(part, i) in titleClauses(item.title)" :key="i" class="np-clause">')
    expect(read('../app/components/NewsArticleContent.vue')).toContain('<h1 id="np-article-title"><span v-for="(part, i) in titleClauses(article.title)" :key="i" class="np-clause">')
    expect(css).toContain('.np-clause{display:inline-block}')
    expect(css).toMatch(/\.np-row:hover :is\(h3,\.np-clause\)\{text-decoration:underline/)
  })
})

describe('消息頁版面', () => {
  const css = read('../app/assets/css/news-page.css')
  it('.np-meta 與單篇示意說明不受全域 p{max-width:65ch} 限制，日期貼齊內文右緣', () => {
    expect(css).toMatch(/^\.np-meta\{[^}]*max-width:none/m)
    expect(css).toContain('.np-article .np-sample-note{margin-top:20px;max-width:none}')
  })
  it('眉標是中文，不是寬字距英文大寫', () => {
    expect(read('../app/components/NewsIndexContent.vue')).toContain('<p class="ivy-kicker np-kicker">常春藤幼兒園・最新消息</p>')
    expect(css).not.toMatch(/\.np-kicker\{[^}]*text-transform:uppercase/)
  })
})

describe('預約頁', () => {
  const css = read('../app/assets/css/visit-booking.css')
  const form = read('../app/components/VisitForm.vue')

  it('內容區對齊頁面 .container，不再另外縮成 1248px', () => {
    expect(css).not.toMatch(/\.visit-content \{max-width/)
  })

  it('選校卡是白框相片：文字在照片外、不壓字（2026-10-29 視覺方向 B 取代 10-13 的壓字底）', () => {
    expect(css).toContain('.visit-campus-copy {position:relative;display:flex;flex-direction:column;gap:2px;padding:12px 4px 0;color:var(--text)}')
    expect(css).not.toMatch(/\.visit-campus-copy \{[^}]*linear-gradient/)
    expect(css).toMatch(/\.visit-campus-card \{[^}]*background:var\(--ivy-photo-mat\);box-shadow:var\(--shadow-paper\)/)
  })

  it('讀不到參觀方式：標題不重複說明，致電是主要按鈕、重新載入改外框鈕排在後面', () => {
    expect(form).toContain('<h2 id="visit-contact-title">歡迎與{{ selectedCampus.name }}聯絡</h2>')
    expect(form).toMatch(/<span class="visit-call-number">\{\{ selectedCampus\.phone \}\}<\/span><\/a>\n\s*<button v-if="action\.kind === 'unavailable'" type="button" class="button" :class="selectedCampus\.phone \? 'outline' : 'primary'"/)
  })

  it('沒有場次只給寫出號碼的致電主要按鈕；讀取失敗才有「重新載入場次」，說明放進淡色底塊', () => {
    expect(form).toContain('<a v-if="selectedCampus.phone" class="button primary" :href="`tel:${selectedCampus.phone}`"><svg class="icon" aria-hidden="true"><use href="#i-phone" /></svg>致電{{ selectedCampus.name }}<span class="visit-call-number">')
    expect(form).toContain('<button v-if="slotsError" type="button" class="button"')
    expect(css).toMatch(/\.visit-slots-empty>p \{[^}]*background:var\(--visit-soft\)/)
  })

  it('360 以下致電鈕的號碼只給讀屏，按鈕不折成兩行', () => {
    expect(css).toContain('@media(max-width:360px) {.visit-call-number {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}')
  })

  it('960 以下按下一步捲到頁名，不是側欄（頁名原本壓在膠囊底下）', () => {
    expect(form).toContain('<h1 id="visit-title" ref="titleRef">')
    expect(form).toContain("? (titleRef.value ?? asideRef.value) : stageRef.value")
  })

  it('第二步頁名跟第一步眉標同一個樣子', () => {
    // 2026-10-29 起兩者都是章節頭樣式：LINE Seed 600、字距 .04em、不畫短線
    expect(css).toContain(".visit-page:not([data-step='1']) .visit-welcome h1 {font:600 var(--fs-sm)/1.6 var(--font-head);letter-spacing:.04em}")
    expect(css).not.toContain('.visit-welcome h1::before')
  })

  it('短的狀態句只在標點後換行；讀場次時有骨架、減少動態不閃', () => {
    expect(css).toMatch(/\.visit-status \{[^}]*word-break:keep-all;overflow-wrap:anywhere/)
    expect(css).toMatch(/\.visit-slots-loading::after \{[^}]*animation:visit-skeleton/)
    expect(css).toContain('@media(prefers-reduced-motion:reduce) {.visit-slots-loading::after {animation:none}}')
  })

  it('平板直拿：迎賓照片 12:5，第二列兩張卡置中；橫拿手機細條照舊靠左', () => {
    expect(css).toMatch(/@media\(max-width:960px\) \{[^@]*\.visit-welcome-photo img \{aspect-ratio:12\/5\}\n\s*\.visit-campus-list \{justify-content:center\}/)
    expect(css).toMatch(/\(orientation:landscape\) \{\n\s*\.visit-campus-choice \{flex:0 1 calc\(\(100% - 16px\) \/ 2\)\}\n\s*\.visit-campus-list \{justify-content:flex-start\}/)
  })

  it('月曆標出今天', () => {
    const picker = read('../app/components/VisitDatePicker.vue')
    expect(picker).toContain("const today = taipeiDate()")
    expect(picker).toContain(`<span class="visit-day-number" :class="{ 'is-today': cell === today }">`)
  })
})

describe('404 頁', () => {
  const page = read('../app/error.vue')
  it('回到首頁是膠囊鈕；校名焦點框貼著校名', () => {
    expect(page).toContain('.error-actions .button {border-radius:999px}')
    expect(page).toMatch(/\.error-campus-name \{[^}]*justify-self:start;[^}]*border-radius:4px/)
  })
  it('說明只在標點後換行', () => {
    expect(page).toMatch(/\.error-lead \{[^}]*text-wrap:pretty;word-break:keep-all;overflow-wrap:anywhere/)
  })
})
