import { onBeforeUnmount } from 'vue'

/** 切換篩選或校區後，只讓最後一次請求更新目前畫面。 */
export function useRequestSequence() {
  let sequence = 0
  onBeforeUnmount(() => { sequence++ })
  return {
    begin: () => ++sequence,
    isCurrent: (request: number) => request === sequence,
  }
}
