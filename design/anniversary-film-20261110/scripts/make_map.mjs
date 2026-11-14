#!/usr/bin/env node
// 第 18 小節「星圖落地」用的高雄地圖線條。
//
// 來源是官網 30 週年頁那張地圖的同一份資料（web/app/utils/anniversary/map-data.ts，由 scripts/build-anniversary-map.mjs
// 產生）：區界＝內政部國土測繪中心鄉鎮市區界線（政府資料開放授權條款）；湖泊、愛河＝© OpenStreetMap 貢獻者（ODbL）。
// 這裡只做座標換算，不另外抓資料：把區界、愛河、三座湖的外框與區名位置換成星空座標（和 film/sky.js 的五校座標
// 同一個換算：(x − 488) × 2.2、(y − 470) × 2.2，北在上），寫成 film/map-data.js。
//
//   node scripts/make_map.mjs
//
// 頁面那張地圖是「孩子畫的」：每條線有一點點慢慢起伏的手繪抖動（最多約 2 個地圖單位，換到影片畫面約 2.5px），
// 區界還畫了兩次。影片只取第一次，抖動留著——細線看起來比較不像電腦畫的，位置誤差在一顆星的光暈以內。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../../web/app/utils/anniversary/map-data.ts')
const OUT = resolve(HERE, '../film/map-data.js')

const text = readFileSync(SRC, 'utf8')
const map = JSON.parse(text.slice(text.indexOf('= {') + 2).trim().replace(/;?\s*$/, ''))

/** SVG 路徑（只有 M、l、z）→ 幾條折線，每條是 [[x, y], …]（地圖座標） */
function polylines(d) {
  const out = []
  let cur = null, x = 0, y = 0, cmd = ''
  const tok = d.match(/[MlLzZ]|-?\d*\.?\d+/g) ?? []
  for (let i = 0; i < tok.length;) {
    const t = tok[i]
    if (/[MlLzZ]/.test(t)) {
      cmd = t; i++
      if (cmd === 'z' || cmd === 'Z') { if (cur?.length) cur.push([...cur[0]]); continue }
      if (cmd === 'M') { x = +tok[i]; y = +tok[i + 1]; i += 2; cur = [[x, y]]; out.push(cur); cmd = 'L' }
      continue
    }
    const a = +tok[i], b = +tok[i + 1]; i += 2
    if (cmd === 'l') { x += a; y += b } else if (cmd === 'L') { x = a; y = b } else throw new Error(`沒處理的指令 ${cmd}`)
    cur.push([x, y])
  }
  return out
}
const sky = ([x, y]) => [Math.round((x - 488) * 22) / 10, Math.round((y - 470) * 22) / 10]
const flat = (pts) => pts.flatMap(sky)

const borderAll = polylines(map.border)
if (borderAll.length % 2) throw new Error('區界應該是兩次描線（偶數條）')
const border = borderAll.slice(0, borderAll.length / 2).map(flat)
const river = polylines(map.river).map(flat)
const water = map.water.map((w) => {
  const rings = polylines(w.shape)
  if (rings.length !== 1) throw new Error(`${w.name} 應該只有一圈`)
  const pts = rings[0]
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0])
  return { name: w.name, ring: flat(pts), c: sky(c) }
})
const districts = map.districts.map((d) => ({ name: d.name, campus: Boolean(d.campus), at: sky(d.label) }))

const body = { border, river, riverLabel: sky(map.riverLabel), water, districts }
writeFileSync(OUT,
  '/* 由 scripts/make_map.mjs 從 web/app/utils/anniversary/map-data.ts 產生，不要手改。\n'
  + ' * 高雄的區界、愛河、湖泊（星空座標，和 sky.js 的五校座標同一個換算）。\n'
  + ' * 區界：內政部國土測繪中心鄉鎮市區界線（政府資料開放授權條款）。湖泊、愛河：© OpenStreetMap 貢獻者（ODbL）。 */\n'
  + "'use strict';\n"
  + `const SKY_MAP = ${JSON.stringify(body)};\n`)
const n = (ls) => ls.reduce((s, l) => s + l.length / 2, 0)
console.log(`${OUT}\n區界 ${border.length} 段 ${n(border)} 點；愛河 ${river.length} 段 ${n(river)} 點；湖 ${water.map((w) => `${w.name} ${w.ring.length / 2} 點`).join('、')}；區名 ${districts.map((d) => d.name).join('、')}`)
