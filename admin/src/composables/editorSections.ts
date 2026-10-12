// 長編輯頁的段落目錄（2026-10-03 第八輪，稽核 09-28「超長編輯頁沒有段落導覽」）。
// 頁面把每一段的標題元素放上 id、data-section-anchor、tabindex="-1"，再把
// sections 傳給 ContentEditor。目錄點一下就捲到那個標題、焦點移過去，鍵盤與
// 報讀軟體跟著到那一段；捲動時留給頁首的空間在 style.css 的 [data-section-anchor]。

import { pairItems } from './listAlignment'

export interface EditorSection {
  /** 標題元素的 id（同一頁唯一） */
  id: string
  /** 目錄上的字，和標題同一句 */
  label: string
  /** 目錄項目後面的小字，例如「12 則」；沒有就不顯示 */
  note?: string
  /**
   * 這一段編輯的欄位（2026-10-06 方向 D）：最外層欄位（'phone'）或清單的某一項（'sections.2'）。
   * 和官網那一版不同時，目錄在這一段打點。新增欄位要一併分段（editorSectionFields.test.ts 守門）。
   */
  fields?: readonly string[]
}

/** 至少兩段才值得放目錄。 */
export const MIN_NAV_SECTIONS = 2

export function jumpToSection(id: string): boolean {
  const target = document.getElementById(id)
  if (!target) return false
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  return true
}

function valueAt(source: Record<string, unknown> | null, path: string): unknown {
  let current: unknown = source
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// 清單某一項（'sections.2'）：基準裡對應的是「同一項」，不是同一個位置——刪掉前面的段落、換順序之後，
// 後面的段落位置變了，但內容沒改，不該打點。對應的規則同差異摘要（listAlignment.pairItems）。
// 基準裡找不到對應（新增的一項）時 before 是 undefined，一定算不同。
function fieldValues(base: Record<string, unknown> | null, current: Record<string, unknown>, field: string): { before: unknown; after: unknown } {
  const [top, index, ...rest] = field.split('.')
  const baseList = base?.[top!]
  const currentList = current[top!]
  if (index !== undefined && !rest.length && /^\d+$/.test(index) && Array.isArray(baseList) && Array.isArray(currentList)) {
    const position = Number(index)
    const pair = pairItems(baseList, currentList).pairs.find(([, now]) => now === position)
    return { before: pair ? baseList[pair[0]] : undefined, after: currentList[position] }
  }
  return { before: valueAt(base, field), after: valueAt(current, field) }
}

/**
 * 和比對基準不同的段落（同動作列「草稿有 N 處修改」）：changedKeys 是 draftChanges 的欄位鍵；
 * 寫到清單某一項的 field 再比那一項本身（和基準裡同一項比），其他項改了不算這一段。
 */
export function dirtySectionIds(
  sections: readonly EditorSection[],
  changedKeys: ReadonlySet<string>,
  base: Record<string, unknown> | null,
  current: Record<string, unknown>,
): string[] {
  return sections
    .filter((section) =>
      (section.fields ?? []).some((field) => {
        const top = field.split('.')[0]!
        if (!changedKeys.has(top)) return false
        if (field === top) return true
        const { before, after } = fieldValues(base, current, field)
        return JSON.stringify(before) !== JSON.stringify(after)
      }),
    )
    .map((section) => section.id)
}
