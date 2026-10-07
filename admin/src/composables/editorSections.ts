// 長編輯頁的段落目錄（2026-10-03 第八輪，稽核 09-28「超長編輯頁沒有段落導覽」）。
// 頁面把每一段的標題元素放上 id、data-section-anchor、tabindex="-1"，再把
// sections 傳給 ContentEditor。目錄點一下就捲到那個標題、焦點移過去，鍵盤與
// 報讀軟體跟著到那一段；捲動時留給頁首的空間在 style.css 的 [data-section-anchor]。

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

/**
 * 和比對基準不同的段落（同動作列「草稿有 N 處修改」）：changedKeys 是 draftChanges 的欄位鍵；
 * 寫到清單某一項的 field 再比那一項本身，其他項改了不算這一段。
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
        return field === top || JSON.stringify(valueAt(base, field)) !== JSON.stringify(valueAt(current, field))
      }),
    )
    .map((section) => section.id)
}
