/// <reference types="node" />
// 常春藤環境頁（environment_page）的內建內容、標籤、字數建議與官網的對照。
// 三份副本要一字不差：官網 web/server/data/site-fixture.json 的 environmentPage、後台的初稿、
// 後端 content/page_schemas.py 的字數上限（改上限三處一起改）。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentPreviewPath, contentPublicPath, mediaFieldPathLabel } from '../api/labels'
import { contentFieldLabelFor, contentPathFieldLabel, contentPathLabel } from '../api/contentFieldLabels'
import { LENGTH_HINTS, lengthHintText, textLength } from '../composables/contentHints'
import { sitePageName } from '../composables/siteLinks'
import { previewTargetsFor } from '../composables/previewTargets'
import {
  ENVIRONMENT_BUILTIN_PHOTOS,
  ENVIRONMENT_CHAPTER_HINTS,
  ENVIRONMENT_PHOTO_PREVIEWS,
  environmentPageDraft,
  mealOrderError,
  mealTimeError,
} from '../composables/environmentPageDraft'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const schemas = readFileSync(resolve(ROOT, 'backend/app/content/page_schemas.py'), 'utf8')
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
/** fixture 是 camelCase；後端 payload 是 snake_case（巢狀的 spaces[].campusLabel ↔ campus_label 也要轉）。 */
function snakeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), snakeDeep(v)]))
  return value
}
const PHOTO_KEY = /(^|_)photo(_alt)?$/
/** 只留文字鍵（去掉 photo／photo_alt／*_photo／*_photo_alt），清單與巢狀項目也一樣。 */
function textOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(textOnly)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !PHOTO_KEY.test(k)).map(([k, v]) => [k, textOnly(v)]))
  return value
}

describe('環境頁的內建內容（初稿）', () => {
  it('和官網 fixture 一字不差（文字，含巢狀 spaces[].campus_label）', () => {
    const draft = environmentPageDraft()
    expect(textOnly(draft)).toEqual(snakeDeep(fixture.environmentPage))
    expect(draft.spaces[2]!.campus_label).toBe('明華校')
    expect(draft.spaces[0]!.campus_label).toBe('')
  })

  it('固定項目數：章名 4、五顆心 5、照顧的小事 5、空間 6、餐點 5', () => {
    const draft = environmentPageDraft()
    expect([draft.chapter_names.length, draft.hearts.length, draft.care_items.length, draft.spaces.length, draft.meals.length]).toEqual([4, 5, 5, 6, 5])
  })

  it('每個照片版位都是 null／空字串（形狀同後端 model_dump）；每項各自一份物件', () => {
    const draft = environmentPageDraft()
    expect(draft.hero_photo).toBeNull()
    expect(draft.hero_photo_alt).toBe('')
    expect(draft.care_photo).toBeNull()
    expect(draft.care_photo_alt).toBe('')
    for (const item of [draft.feature, ...draft.care_items, ...draft.spaces]) expect([item.photo, item.photo_alt]).toEqual([null, ''])
    // 兩次呼叫不共用物件：改一份不會連動另一份。
    const other = environmentPageDraft()
    other.spaces[0]!.title = '改過'
    expect(draft.spaces[0]!.title).not.toBe('改過')
  })

  it('餐點時間是 HH:MM 且由早到晚（官網太陽弧的位置照序號固定）', () => {
    const times = environmentPageDraft().meals.map((meal) => meal.time)
    expect(times.every((time) => mealTimeError(time) === '')).toBe(true)
    expect([...times].sort()).toEqual(times)
  })
})

describe('內建照片與官網裁切', () => {
  const component = readFileSync(resolve(ROOT, 'web/app/components/EnvironmentContent.vue'), 'utf8')
  const css = readFileSync(resolve(ROOT, 'web/app/assets/css/environment.css'), 'utf8')

  it('內建照片在官網 assets 裡，也和官網元件寫的順序一樣', () => {
    const codes = [
      ENVIRONMENT_BUILTIN_PHOTOS.hero,
      ENVIRONMENT_BUILTIN_PHOTOS.care,
      ENVIRONMENT_BUILTIN_PHOTOS.feature,
      ...ENVIRONMENT_BUILTIN_PHOTOS.careItems,
      ...ENVIRONMENT_BUILTIN_PHOTOS.spaces,
    ]
    for (const code of codes) expect(existsSync(resolve(ROOT, `web/public/assets/${code}.webp`)), code).toBe(true)
    expect(ENVIRONMENT_BUILTIN_PHOTOS.careItems).toHaveLength(5)
    expect(ENVIRONMENT_BUILTIN_PHOTOS.spaces).toHaveLength(6)
    // 首屏照片的代號在 responsive-image.ts，其餘在 EnvironmentContent.vue 的 CARE／SPACES／模板裡。
    expect(readFileSync(resolve(ROOT, 'web/app/utils/responsive-image.ts'), 'utf8')).toContain(`ENVIRONMENT_HERO_IMAGE = '${ENVIRONMENT_BUILTIN_PHOTOS.hero}'`)
    expect(component).toContain(`'${ENVIRONMENT_BUILTIN_PHOTOS.care}'`)
    expect(component).toContain(`'${ENVIRONMENT_BUILTIN_PHOTOS.feature}'`)
    const order = (names: readonly string[]) => names.map((name) => component.indexOf(`'${name}'`))
    for (const names of [ENVIRONMENT_BUILTIN_PHOTOS.careItems, ENVIRONMENT_BUILTIN_PHOTOS.spaces]) {
      const positions = order(names)
      expect(positions.every((p) => p > 0)).toBe(true)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    }
  })

  // 2026-10-30 官網木頭積木版：照片裝在積木形狀裡，預覽給最接近的矩形比例；空間照片也會裁切，所以也給預覽
  it('照片焦點預覽的比例和官網 environment.css 一致', () => {
    expect(css).toContain('.renv-rainbow{--t:17px;--g:5px;width:100%;max-width:540px;')
    expect(css).toContain('.renv-care-main .renv-ph{--ar:2.75;')
    expect(css).toContain('.renv-care-main .renv-ph{--ar:2.2;')
    expect(css).toContain('.renv-feature .renv-ph{--ar:1.5;')
    expect(ENVIRONMENT_PHOTO_PREVIEWS.hero.map((p) => p.ratio)).toEqual(['3 / 4'])
    expect(ENVIRONMENT_PHOTO_PREVIEWS.care.map((p) => p.ratio)).toEqual(['2.75 / 1', '2.2 / 1'])
    expect(ENVIRONMENT_PHOTO_PREVIEWS.feature.map((p) => p.ratio)).toEqual(['3 / 2'])
    expect(ENVIRONMENT_PHOTO_PREVIEWS.careItem.map((p) => p.ratio)).toEqual(['4 / 5'])
    expect(ENVIRONMENT_PHOTO_PREVIEWS.space.map((p) => p.ratio)).toEqual(['1 / 1'])
    expect(Object.keys(ENVIRONMENT_PHOTO_PREVIEWS)).toEqual(['hero', 'care', 'feature', 'careItem', 'space'])
  })

  it('章名說明四個、最後一個提到沒有校園探索時整章不出現', () => {
    expect(ENVIRONMENT_CHAPTER_HINTS).toHaveLength(4)
    expect(ENVIRONMENT_CHAPTER_HINTS[3]).toContain('整章不出現')
  })
})

describe('字數建議和後端硬上限一致（page_schemas.py）', () => {
  /** 取 `NAME: dict[...] = {` 到收尾 `}` 之間的 `"key": (N, ...)` */
  function table(name: string): Record<string, number> {
    const start = schemas.indexOf(`${name}: dict[`)
    expect(start, `找不到 ${name}`).toBeGreaterThan(-1)
    const body = schemas.slice(start, schemas.indexOf('\n}', start))
    return Object.fromEntries([...body.matchAll(/"([a-z_]+)": \((\d+),/g)].map((m) => [m[1]!, Number(m[2])]))
  }
  function constant(name: string): number {
    const m = new RegExp(`^${name} = (\\d+)`, 'm').exec(schemas)
    expect(m, `找不到 ${name}`).not.toBeNull()
    return Number(m![1])
  }

  it('標題逐行（每行同一個上限）', () => {
    const titles = table('ENVIRONMENT_TITLES')
    const map = { envHeroTitle: 'hero_title', envCareTitle: 'care_title', envSpacesTitle: 'spaces_title', envMealsTitle: 'meals_title', envTourTitle: 'tour_title' } as const
    for (const [hint, field] of Object.entries(map)) expect(LENGTH_HINTS[hint as keyof typeof map].max, hint).toEqual([titles[field]])
    expect(Object.keys(titles).sort()).toEqual(Object.values(map).sort())
    expect(LENGTH_HINTS.envFeatureTitle.max).toEqual([constant('ENVIRONMENT_FEATURE_TITLE_PER_LINE')])
  })

  it('首屏與各章文字', () => {
    const texts = table('ENVIRONMENT_TEXTS')
    const map = {
      envHighlight: 'hero_highlight', envHeroLede: 'hero_lede', envHeroNotice: 'hero_notice', envHeroCaption: 'hero_caption',
      envCareLead: 'care_lead', envCareText: 'care_text', envCareCaption: 'care_caption', envCareNote: 'care_photo_note',
      envSpacesText: 'spaces_text', envTrailHint: 'trail_hint', envMealsText: 'meals_text', envMealsDayTitle: 'meals_day_title',
      envTourText: 'tour_text', envTourHint: 'tour_hint',
    } as const
    for (const [hint, field] of Object.entries(map)) expect(LENGTH_HINTS[hint as keyof typeof map].max, hint).toBe(texts[field])
    expect(Object.keys(texts).sort()).toEqual(Object.values(map).sort())
    expect(LENGTH_HINTS.envChapterName.max).toBe(constant('ENVIRONMENT_CHAPTER_NAME_LIMIT'))
    expect(LENGTH_HINTS.envHeart.max).toBe(constant('ENVIRONMENT_HEART_LIMIT'))
  })

  it('主打區、照顧的小事、空間、餐點', () => {
    const feature = table('ENVIRONMENT_FEATURE_TEXTS')
    expect([LENGTH_HINTS.envFeatureTag.max, LENGTH_HINTS.envFeatureText.max, LENGTH_HINTS.envFeatureNote.max]).toEqual([feature.tag, feature.text, feature.note])
    const care = table('ENVIRONMENT_CARE_ITEM_TEXTS')
    expect([LENGTH_HINTS.envCareItemTitle.max, LENGTH_HINTS.envCareItemText.max]).toEqual([care.title, care.text])
    const space = table('ENVIRONMENT_SPACE_TEXTS')
    expect([LENGTH_HINTS.envSpaceTitle.max, LENGTH_HINTS.envSpaceText.max, LENGTH_HINTS.envSpaceNote.max, LENGTH_HINTS.envSpaceCampus.max]).toEqual([space.title, space.text, space.note, space.campus_label])
    const meal = table('ENVIRONMENT_MEAL_TEXTS')
    expect([LENGTH_HINTS.envMealName.max, LENGTH_HINTS.envMealNote.max, LENGTH_HINTS.envMealText.max]).toEqual([meal.name, meal.note, meal.text])
  })

  it('內建內容沒有一欄超過上限（一打開不會有金色提醒）', () => {
    const d = environmentPageDraft()
    const over = (value: string, rule: (typeof LENGTH_HINTS)[keyof typeof LENGTH_HINTS]) => lengthHintText(value, rule).over
    const checks: [string, boolean][] = [
      ['hero_title', over(d.hero_title, LENGTH_HINTS.envHeroTitle)],
      ['care_title', over(d.care_title, LENGTH_HINTS.envCareTitle)],
      ['spaces_title', over(d.spaces_title, LENGTH_HINTS.envSpacesTitle)],
      ['meals_title', over(d.meals_title, LENGTH_HINTS.envMealsTitle)],
      ['tour_title', over(d.tour_title, LENGTH_HINTS.envTourTitle)],
      ['feature.title', over(d.feature.title, LENGTH_HINTS.envFeatureTitle)],
      ['hero_lede', over(d.hero_lede, LENGTH_HINTS.envHeroLede)],
      ['meals_text', over(d.meals_text, LENGTH_HINTS.envMealsText)],
      ...d.hearts.map((heart, i) => [`hearts[${i}]`, over(heart, LENGTH_HINTS.envHeart)] as [string, boolean]),
      ...d.spaces.map((space, i) => [`spaces[${i}].text`, over(space.text, LENGTH_HINTS.envSpaceText)] as [string, boolean]),
    ]
    expect(checks.filter(([, flagged]) => flagged).map(([name]) => name)).toEqual([])
    expect(textLength(d.hero_notice)).toBeLessThanOrEqual(LENGTH_HINTS.envHeroNotice.max)
  })
})

describe('餐點時間檢查', () => {
  it('只收 24 小時制的 HH:MM（兩位數）', () => {
    for (const ok of ['00:00', '08:30', '15:30', '23:59']) expect(mealTimeError(ok), ok).toBe('')
    for (const bad of ['', '8:30', '24:00', '08:60', '早上', '0830', ' 08:30']) expect(mealTimeError(bad), bad).not.toBe('')
  })

  it('比上一個早或同一時間：那一個提醒；前一個沒填好就不比', () => {
    const meals = [{ time: '08:30', name: '早餐' }, { time: '08:00', name: '香蕉' }, { time: '08:00', name: '午餐' }, { time: '12:00', name: '蘋果' }]
    expect(mealOrderError(meals, 0)).toBe('')
    expect(mealOrderError(meals, 1)).toContain('早餐 08:30')
    expect(mealOrderError(meals, 1)).toContain('由早到晚')
    expect(mealOrderError(meals, 2)).toContain('香蕉 08:00')
    expect(mealOrderError(meals, 3)).toBe('')
    expect(mealOrderError([{ time: '', name: '甲' }, { time: '07:00', name: '乙' }], 1)).toBe('')
    expect(mealOrderError([{ time: '08:30', name: '甲' }, { time: '7點', name: '乙' }], 1)).toBe('')
  })
})

describe('側欄、標籤與網址', () => {
  it('側欄在「全站與素材」，關於常春藤頁之後，只有總管理者', () => {
    const items = NAV_GROUPS.find((g) => g.key === 'site')!.items
    const item = items.find((i) => i.name === 'environment-page')!
    expect(item.path).toBe('/content/environment-page')
    expect(item.title).toBe('常春藤環境頁')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    for (const word of ['環境', '餐點', '保育', '校園']) expect(item.keywords, word).toContain(word)
    expect(items.findIndex((i) => i.name === 'environment-page')).toBe(items.findIndex((i) => i.name === 'about-page') + 1)
  })

  it('內容種類標籤與官網網址', () => {
    expect(CONTENT_KIND_LABELS.environment_page).toBe('常春藤環境頁')
    expect(contentPublicPath('environment_page')).toBe('/environment')
    expect(contentPreviewPath('environment_page')).toBe('/preview?page=environment')
    expect(contentEditorPath('environment_page')).toBe('/content/environment-page')
    expect(sitePageName('/environment')).toBe('常春藤環境頁')
  })

  it('預覽欄對到環境頁的頁首（不框欄位）', () => {
    expect(previewTargetsFor('environment_page')).toEqual([{ id: 'page', label: '常春藤環境頁', page: 'environment', block: 'page-top' }])
  })

  it('素材庫「用在哪裡」認得每一張照片', () => {
    expect(mediaFieldPathLabel('hero_photo.media_id')).toBe('首屏照片')
    expect(mediaFieldPathLabel('care_photo.media_id')).toBe('幼兒保育照片')
    expect(mediaFieldPathLabel('feature.photo.media_id')).toBe('校園環境主打區的照片')
    expect(mediaFieldPathLabel('care_items[0].photo.media_id')).toBe('照顧的小事第 1 件的照片')
    expect(mediaFieldPathLabel('spaces[5].photo.media_id')).toBe('校園環境第 6 個空間的照片')
    // 既有路徑不受影響
    expect(mediaFieldPathLabel('daily[2].photo.media_id')).toBe('五件事第 3 件的照片')
    expect(mediaFieldPathLabel('hope_photo.media_id')).toBe('紙房子窗戶的照片')
  })

  it('錯誤訊息指到第幾項（數字索引 +1）、巢狀的主打區', () => {
    expect(contentFieldLabelFor('environment_page', 'hero_title')).toBe('首屏大標')
    expect(contentFieldLabelFor('environment_page', 'hero_highlight')).toBe('大標裡畫螢光的字')
    expect(contentPathLabel('environment_page', ['spaces', 2, 'note'])).toBe('小腳印走過的空間第 3 個・照片上的便條')
    expect(contentPathLabel('environment_page', ['spaces', 2, 'campus_label'])).toBe('小腳印走過的空間第 3 個・照片上的校名')
    expect(contentPathLabel('environment_page', ['care_items', 4, 'text'])).toBe('照顧的小事第 5 件・說明')
    expect(contentPathLabel('environment_page', ['meals', 1, 'time'])).toBe('一天的餐點第 2 個・時間')
    expect(contentPathLabel('environment_page', ['hearts', 2])).toBe('五顆心第 3 顆')
    expect(contentPathLabel('environment_page', ['chapter_names', 3])).toBe('章名第 4 個')
    expect(contentPathLabel('environment_page', ['feature', 'tag'])).toBe('主打區的標籤')
    expect(contentPathLabel('environment_page', ['feature', 'title'])).toBe('主打區的標題')
    expect(contentPathLabel('environment_page', ['feature', 'photo_alt'])).toBe('主打區的照片說明')
    expect(contentPathFieldLabel('environment_page', ['spaces', 2, 'note'])).toBe('照片上的便條')
    expect(contentPathFieldLabel('environment_page', ['feature', 'text'])).toBe('主打區的說明')
    expect(contentPathFieldLabel('environment_page', ['meals'])).toBe('一天的餐點')
  })
})
