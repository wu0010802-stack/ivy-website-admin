import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-11 手機體驗（使用者要求）：矮手機打開選單就看得到五校與參觀專線；特色教學三條橫滑清單有張數。
// 都是版面，比照 visit-mobile-first-screen-20261111 鎖住原始碼裡的關鍵寫法；實測數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const studio = read('../app/assets/css/studio.css')
const curCss = read('../app/assets/css/curriculum.css')
const cur = read('../app/components/CurriculumContent.vue')

describe('矮手機的選單卡', () => {
  const query = '@media(max-width:900px) and (max-height:760px) {\n'
  const start = studio.indexOf(query)
  const short = studio.slice(start, studio.indexOf('\n}\n', start))

  it('只在 900 寬以下、可視高度 760 以下收短', () => {
    expect(start).toBeGreaterThan(-1)
    expect(short).toContain('.menu-links a {min-height:52px;padding-block:5px;line-height:1.3}')
    expect(short).toContain('.menu-heading {padding-block:10px}')
    expect(short).toContain('.menu-campuses {margin-top:12px}')
  })
  it('導覽列還是 44px 以上的點擊高度', () => {
    const height = Number(/\.menu-links a \{min-height:(\d+)px/.exec(short)?.[1])
    expect(height).toBeGreaterThanOrEqual(44)
  })
  it('高一點的手機照舊 64px', () => {
    expect(studio.replace(short, '')).toContain('.menu-links a {min-height:64px;font-size:1.125rem;gap:14px}')
  })
})

describe('特色教學橫滑清單的張數', () => {
  it('三條清單都接捲動事件，底下各有一行張數', () => {
    for (const key of ['directions', 'gallery', 'daily']) {
      expect(cur).toContain(`@scroll.passive="onRailScroll('${key}', $event)"`)
      expect(cur).toContain(`<p class="cur-count" aria-hidden="true"><b>{{ railAt.${key} }}</b> / {{ ${key}.length }}<span>左右滑動</span></p>`)
    }
  })
  it('張數只給看得到畫面的人：讀屏已經有清單項目數', () => {
    expect(cur.match(/class="cur-count" aria-hidden="true"/g)).toHaveLength(3)
  })
  it('桌機不顯示，760 以下才顯示', () => {
    const mobileAt = curCss.indexOf('@media (width <= 760px)') >= 0 ? curCss.indexOf('@media (width <= 760px)') : curCss.indexOf('@media (max-width: 760px)')
    expect(mobileAt).toBeGreaterThan(-1)
    const base = curCss.indexOf('.cur-count { display: none; }')
    const shown = curCss.indexOf('.cur-count { display: flex;')
    expect(base).toBeGreaterThan(-1)
    expect(base).toBeLessThan(mobileAt)
    expect(shown).toBeGreaterThan(mobileAt)
  })
})
