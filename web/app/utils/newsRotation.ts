/** 首頁最新消息一次三則；超過三則才輪播，最後一組不足三則時從頭補滿。 */
export const NEWS_PER_PAGE = 3

export function newsPageCount(total: number, perPage = NEWS_PER_PAGE) {
  return total > perPage ? Math.ceil(total / perPage) : 1
}

export function newsPageItems<T>(items: readonly T[], page: number, perPage = NEWS_PER_PAGE): T[] {
  if (items.length <= perPage) return items.slice()
  return Array.from({ length: perPage }, (_, slot) => items[(page * perPage + slot) % items.length]!)
}
