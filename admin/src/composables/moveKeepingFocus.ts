import { nextTick } from 'vue'
import { moveItem } from './newsContent'

/**
 * 清單的上移／下移按鈕：移動之後讓鍵盤焦點跟著那一項到新位置，連按就能一路
 * 移到想要的位置（v-for 以位置當 key，按鈕本身不會跟著移動）。按鈕要帶
 * data-move-row（第幾項）與 data-move-dir（-1／1）。
 */
export async function moveKeepingFocus<T>(list: T[], index: number, delta: number, root: HTMLElement | null | undefined): Promise<void> {
  const target = index + delta
  if (target < 0 || target >= list.length) return
  moveItem(list, index, delta)
  if (!root) return
  await nextTick()
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-move-row="${target}"]`))
  const same = buttons.find((button) => button.dataset.moveDir === String(delta) && !button.disabled)
  ;(same ?? buttons.find((button) => !button.disabled))?.focus()
}
