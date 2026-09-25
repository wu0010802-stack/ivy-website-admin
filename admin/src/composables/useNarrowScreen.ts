import { onBeforeUnmount, ref, type Ref } from 'vue'

/** 手機版斷點，與 style.css 的 `@media (max-width: 720px)` 一致。
 *
 * Element Plus 的日期區間面板兩個月並排約 646px，teleport 到 body 後 popper 只能
 * 移位置、不能縮寬度，390px 手機會超出右緣；窄螢幕要給 `single-panel`，改成
 * 一個月的面板（約 322px）。沒有 matchMedia 的環境（測試、SSR）當成寬螢幕。 */
export function useNarrowScreen(query = '(max-width: 720px)'): Ref<boolean> {
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
  const narrow = ref(media?.matches ?? false)
  const update = (event: MediaQueryListEvent) => { narrow.value = event.matches }
  media?.addEventListener('change', update)
  onBeforeUnmount(() => media?.removeEventListener('change', update))
  return narrow
}
