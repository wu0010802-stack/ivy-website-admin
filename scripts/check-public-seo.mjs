// 唯讀驗證：node scripts/check-public-seo.mjs https://正式網域
// 本機：SEO_EXPECT_INDEXABLE=false SEO_EXPECT_ORIGIN=https://example.test node scripts/check-public-seo.mjs http://127.0.0.1:3100
// 本機驗開放收錄的樣子：robots.txt 只在正式主機開放，所以用 *.localhost 當正式主機名（nuxt dev 放行、Node 解析得到）：
//   伺服器 NUXT_PUBLIC_SITE_ORIGIN=https://ivy.localhost NUXT_PUBLIC_INDEXING_ENABLED=true
//   SEO_EXPECT_ORIGIN=https://ivy.localhost node scripts/check-public-seo.mjs http://ivy.localhost:3100
import assert from 'node:assert/strict'
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3100').origin
const origin = process.env.SEO_EXPECT_ORIGIN ?? base
const indexable = process.env.SEO_EXPECT_INDEXABLE !== 'false'
// 首頁之外也查固定公開頁（2026-11-11）：每頁都要有自己的 canonical、分享資料與一份結構化資料。
const paths = ['/', '/about', '/curriculum', '/admission', '/environment', '/news', '/visit']
const types = (node) => [node['@type']].flat()
let count = 0
for (const path of paths) {
  const response = await fetch(base + path)
  assert.equal(response.status, 200, path)
  const html = await response.text()
  assert.match(html, /<h1[\s>]/, `${path}: SSR h1`)
  assert.ok(html.includes(`rel="canonical" href="${origin}${path}"`), `${path}: canonical`)
  // 分享圖預設是 1200×630 JPG；後台可換成素材庫的圖（公開素材網址，沒有副檔名），所以只要求絕對網址。
  assert.match(html, /property="og:image" content="https:\/\/[^"]+"/, `${path}: absolute OG image`)
  assert.match(html, /property="og:site_name" content="[^"]+"/, `${path}: og:site_name`)
  assert.match(html, indexable ? /name="robots" content="index, follow/ : /name="robots" content="noindex/, `${path}: robots`)
  if (path === '/') assert.match(response.headers.get('cache-control') ?? '', /no-cache/, `${path}: release freshness`)
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 1, `${path}: JSON-LD count`)
  const graph = JSON.parse(scripts[0][1])['@graph']
  assert.ok(graph.some(item => types(item).includes('WebSite')), `${path}: WebSite`)
  assert.ok(graph.some(item => types(item).includes('EducationalOrganization')), `${path}: 機構節點`)
  const schools = graph.filter(item => types(item).includes('Preschool'))
  if (path === '/') {
    // 各校節點掛在首頁（沒有分校頁）：每一校都要有地址與電話，網址是各校預約頁，不能指向已拿掉的 /campuses/。
    assert.ok(schools.length >= 1, `${path}: 各校 Preschool`)
    for (const school of schools) {
      assert.ok(school.address?.streetAddress && school.telephone, `${path}: ${school.name} 缺地址或電話`)
      assert.ok(String(school.url).startsWith(`${origin}/visit/`), `${path}: ${school.name} 網址是各校預約頁`)
    }
  } else {
    assert.equal(schools.length, 0, `${path}: 各校節點只在首頁與各校預約頁`)
    assert.ok(graph.some(item => types(item).includes('BreadcrumbList')), `${path}: 麵包屑`)
  }
  if (path === '/admission') {
    const faq = graph.find(item => types(item).includes('FAQPage'))
    assert.ok(faq?.mainEntity?.length > 0, `${path}: 常見問題結構化資料`)
    for (const question of faq.mainEntity) {
      assert.ok(html.includes(`id="${new URL(question.url).hash.slice(1)}"`), `${path}: ${question.name} 的錨點不在頁面上`)
    }
  }
  assert.ok(!JSON.stringify(graph).includes('/campuses/'), `${path}: 不指向已拿掉的分校頁`)
  count++
}
const robots = await (await fetch(base + '/robots.txt')).text()
assert.ok(indexable ? robots.includes(`Sitemap: ${origin}/sitemap.xml`) : robots.includes('Disallow: /\n'))
if (indexable) {
  // 預約頁 2026-11-11 起開放收錄，robots.txt 不能整個擋掉；修改預約頁照舊不給爬。
  assert.ok(!/^Disallow: \/visit$/m.test(robots), 'robots.txt: 不擋 /visit')
  assert.match(robots, /^Disallow: \/visit\/manage$/m, 'robots.txt: 擋 /visit/manage')
  // 公開素材 2026-11-13 起單獨放行（頁面上的照片走這個路徑），其餘 API 照舊擋。
  assert.match(robots, /^Allow: \/api\/website\/v1\/public\/media\/$/m, 'robots.txt: 放行公開素材')
  assert.match(robots, /^Disallow: \/api\/$/m, 'robots.txt: 擋其餘 API')
  const llms = await fetch(base + '/llms.txt')
  assert.equal(llms.status, 200, '/llms.txt')
  const text = await llms.text()
  assert.match(text, /^# \S/, '/llms.txt: 標題')
  assert.match(text, /^## 各校地址與電話$/m, '/llms.txt: 各校地址與電話')
  assert.match(text, /^## 常見問題$/m, '/llms.txt: 常見問題')
  assert.ok(!text.includes('/campuses/'), '/llms.txt: 不指向已拿掉的分校頁')
}
// 沒開放索引時 sitemap 回 200 的空 urlset（web/server/routes/sitemap.xml.get.ts），不是 404。
const sitemap = await fetch(base + '/sitemap.xml')
assert.equal(sitemap.status, 200, '/sitemap.xml')
const xml = await sitemap.text()
assert.match(xml, /<urlset[\s>]/, '/sitemap.xml: urlset')
if (indexable) {
  for (const path of paths) assert.ok(xml.includes(`<loc>${origin}${path}</loc>`))
  assert.ok(!xml.includes('/visit/manage') && !xml.includes('/admin'))
  assert.match(xml, new RegExp(`<loc>${origin}/visit/[a-z]+</loc>`), '/sitemap.xml: 各校預約頁')
} else {
  assert.ok(!xml.includes('<url>'), '/sitemap.xml: 未開放索引時不列任何網址')
}
for (const path of ['/campuses/yihua', '/campuses/not-a-campus']) {
  const response = await fetch(base + path, { redirect: 'manual' })
  assert.equal(response.status, 301, `${path}: 分校頁已移除，轉回首頁`)
  assert.equal(new URL(response.headers.get('location') ?? '', base).pathname, '/', path)
}
// 預約頁照全站收錄開關（開放時不送 noindex 標頭）；預覽頁與修改預約頁一律 noindex。
const visitRobots = (await fetch(base + '/visit')).headers.get('x-robots-tag') ?? ''
assert.equal(/noindex/.test(visitRobots), !indexable, '/visit: X-Robots-Tag 跟著收錄開關')
for (const path of ['/visit/manage', '/preview']) {
  const response = await fetch(base + path)
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/, `${path}: 一律 noindex`)
}
console.log(`PASS: ${count} 個 SSR 頁面、分享資料、JSON-LD（機構、五校、常見問題）、索引設定、robots、sitemap、llms.txt、分校頁轉址與私有頁隔離`)
