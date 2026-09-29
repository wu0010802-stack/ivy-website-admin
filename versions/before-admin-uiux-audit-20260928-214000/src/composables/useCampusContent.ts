import { watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useCampusScope } from './useCampusScope'
import type { ContentEditorState } from './useContentItem'
import type ContentEditor from '../components/ContentEditor.vue'

type EditorShell = InstanceType<typeof ContentEditor>

// 分校內容頁（五校介紹、FAQ、校園探索）共用：`campus` 由頁面先建好並交給
// useContentItem，這裡負責在選單切換時先確認有沒有未儲存的修改，確認放棄
// 才真的換校並重新載入；取消就把選單撥回去。
export function useCampusContent(
  editor: ContentEditorState,
  campus: Ref<string>,
  shell: Readonly<Ref<EditorShell | null>>,
  onSwitch?: () => void,
) {
  const scope = useCampusScope()
  // 從總覽、通知或發布紀錄點進來會帶 ?campus=，直接切到那一校（要在自己的範圍內）。
  const linked = useRoute()?.query.campus
  if (!campus.value && typeof linked === 'string' && scope.visibleCampusKeys.value.includes(linked)) {
    campus.value = linked
  }
  if (!campus.value) campus.value = scope.selected.value
  let reverting = false

  watch(
    campus,
    async (next, prev) => {
      if (reverting) {
        reverting = false
        return
      }
      if (!next) return
      if (prev && editor.isDirty.value) {
        const ok = await shell.value?.confirmLeave()
        if (!ok) {
          reverting = true
          campus.value = prev
          return
        }
      }
      scope.selected.value = next
      onSwitch?.()
      await editor.load()
    },
    { immediate: true },
  )

  // 登入者權限變動（例如重新整理後 session 還原）時同步預設校區
  watch(scope.selected, (v) => {
    if (v && !campus.value) campus.value = v
  })

  return scope
}
