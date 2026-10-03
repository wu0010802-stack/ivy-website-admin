// 唯讀驗證：node scripts/check-public-seo.mjs https://正式網域
// 本機：SEO_EXPECT_INDEXABLE=false SEO_EXPECT_ORIGIN=https://example.test node scripts/check-public-seo.mjs http://127.0.0.1:3100
import assert from 'node:assert/strict'
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3100').origin
const origin = process.env.SEO_EXPECT_ORIGIN ?? base
const indexable = process.env.SEO_EXPECT_INDEXABLE !== 'false'
const paths = ['/']
let count = 0
for (const path of paths) {
  const response = await fetch(base + path)
  assert.equal(response.status, 200, path)
  const html = await response.text()
  assert.match(html, /<h1[\s>]/, `${path}: SSR h1`)
  assert.ok(html.includes(`rel="canonical" href="${origin}${path}"`), `${path}: canonical`)
  assert.match(html, /property="og:image" content="https:\/\/[^"]+\.jpg"/, `${path}: absolute OG image (1200×630 JPG)`)
  assert.match(html, indexable ? /name="robots" content="index, follow/ : /name="robots" content="noindex/, `${path}: robots`)
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/, `${path}: release freshness`)
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 1, `${path}: JSON-LD count`)
  const graph = JSON.parse(scripts[0][1])['@graph']
  assert.ok(graph.some(item => item['@type'] === 'WebSite'))
  assert.ok(!graph.some(item => item['@type'] === 'Preschool'), `${path}: 不輸出各校 Preschool`)
  count++
}
const robots = await (await fetch(base + '/robots.txt')).text()
assert.ok(indexable ? robots.includes(`Sitemap: ${origin}/sitemap.xml`) : robots.includes('Disallow: /\n'))
const sitemap = await fetch(base + '/sitemap.xml')
assert.equal(sitemap.status, indexable ? 200 : 404)
if (indexable) {
  const xml = await sitemap.text()
  for (const path of paths) assert.ok(xml.includes(`<loc>${origin}${path}</loc>`))
  assert.ok(!xml.includes('/visit') && !xml.includes('/admin'))
}
for (const path of ['/campuses/yihua', '/campuses/not-a-campus']) {
  const response = await fetch(base + path, { redirect: 'manual' })
  assert.equal(response.status, 301, `${path}: 分校頁已移除，轉回首頁`)
  assert.equal(new URL(response.headers.get('location') ?? '', base).pathname, '/', path)
}
for (const path of ['/visit', '/preview']) {
  const response = await fetch(base + path)
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/)
}
console.log(`PASS: ${count} 個 SSR 頁面、分享資料、JSON-LD、索引設定、sitemap、分校頁轉址與私有頁隔離`)
