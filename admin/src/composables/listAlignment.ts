// 內容裡的清單（消息、段落、時刻…）在「改之前」和「改之後」怎麼對應成同一項（2026-10-08 T8b）。
// 給差異摘要（useContentItem 的 nestedChangeDetail）與段落目錄的打點（editorSections 的 dirtySectionIds）共用，
// 兩邊對「哪一項改了」的判斷才一致。純函式，不依賴畫面。

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 清單怎麼對應「同一項」，才分得出「改了」和「刪了再加」：
// 1. 有 id／key 的項目（消息、時刻、場景）依 id／key 對應；對不上的就是新增或刪除，不會和別項配對。
// 2. 沒有 id／key、但有 heading（或 title）而且在新舊清單裡各只出現一次的項目（隱私權政策的段落）依標題對應：
//    刪掉中間一段時，後面的段落不會因為位置往前移就全被標成「修改」。
// 3. 其餘（沒有標題、標題重複、標題被改過的）夾在對得上的項目之間，依出現順序兩兩配對，多出來的算新增或刪除；
//    整份清單都沒有可對應的項目時，就是整份依位置配對（舊行為）。
function idKey(item: unknown): string | null {
  if (isPlainObject(item)) {
    for (const key of ['id', 'key'] as const) {
      const value = item[key]
      if (typeof value === 'string' && value) return `${key}:${value}`
    }
  }
  return null
}

function headingKey(item: unknown): string | null {
  if (isPlainObject(item)) {
    for (const key of ['heading', 'title'] as const) {
      const value = item[key]
      if (typeof value === 'string' && value.trim()) return `${key}:${value.trim()}`
    }
  }
  return null
}

export interface ItemPairing {
  /** [舊清單的位置, 新清單的位置]：同一項 */
  pairs: Array<[number, number]>
  added: number[]
  removed: number[]
}

export function pairItems(beforeList: unknown[], afterList: unknown[]): ItemPairing {
  const beforeIds = beforeList.map(idKey)
  const afterIds = afterList.map(idKey)
  // 標題只認各自清單裡唯一的（重複的標題分不出是哪一段）。
  const uniqueHeadings = (list: unknown[], ids: Array<string | null>) => {
    const counts = new Map<string, number>()
    list.forEach((item, index) => {
      const heading = ids[index] ? null : headingKey(item)
      if (heading) counts.set(heading, (counts.get(heading) ?? 0) + 1)
    })
    return new Set([...counts].filter(([, count]) => count === 1).map(([heading]) => heading))
  }
  const beforeUnique = uniqueHeadings(beforeList, beforeIds)
  const afterUnique = uniqueHeadings(afterList, afterIds)
  const identity = (item: unknown, id: string | null, unique: Set<string>) => {
    if (id) return id
    const heading = headingKey(item)
    return heading && unique.has(heading) ? heading : null
  }

  const beforeByIdentity = new Map<string, number[]>()
  beforeList.forEach((item, index) => {
    const key = identity(item, beforeIds[index]!, beforeUnique)
    if (key) beforeByIdentity.set(key, [...(beforeByIdentity.get(key) ?? []), index])
  })
  const pairs: Array<[number, number]> = []
  const matchedBefore = new Set<number>()
  const matchedAfter = new Set<number>()
  afterList.forEach((item, index) => {
    const key = identity(item, afterIds[index]!, afterUnique)
    const candidate = key ? beforeByIdentity.get(key)?.shift() : undefined
    if (candidate === undefined) return
    pairs.push([candidate, index])
    matchedBefore.add(candidate)
    matchedAfter.add(index)
  })

  // 沒對上的：有 id／key 的直接算新增或刪除；其餘依「前面已對上幾項」分段，同一段裡依順序配對。
  const added: number[] = []
  const removed: number[] = []
  const gaps = new Map<number, { before: number[]; after: number[] }>()
  const gap = (n: number) => gaps.get(n) ?? gaps.set(n, { before: [], after: [] }).get(n)!
  let seen = 0
  beforeList.forEach((_, index) => {
    if (matchedBefore.has(index)) seen += 1
    else if (beforeIds[index]) removed.push(index)
    else gap(seen).before.push(index)
  })
  seen = 0
  afterList.forEach((_, index) => {
    if (matchedAfter.has(index)) seen += 1
    else if (afterIds[index]) added.push(index)
    else gap(seen).after.push(index)
  })
  for (const { before, after } of gaps.values()) {
    const shared = Math.min(before.length, after.length)
    for (let i = 0; i < shared; i += 1) pairs.push([before[i]!, after[i]!])
    removed.push(...before.slice(shared))
    added.push(...after.slice(shared))
  }
  return { pairs, added, removed }
}
