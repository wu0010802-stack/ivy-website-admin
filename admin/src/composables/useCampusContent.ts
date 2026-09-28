import { watch, type InjectionKey, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCampusScope } from './useCampusScope'
import type { ContentEditorState } from './useContentItem'
import type ContentEditor from '../components/ContentEditor.vue'

type EditorShell = InstanceType<typeof ContentEditor>

/**
 * ContentEditor 提供給工具列裡的 CampusSelect：多校下拉也在框內寫出「校區」，
 * 分校內容頁一眼看得出現在改的是哪一校（單校時本來就有這個標籤）。
 */
export const campusSelectLabelKey: InjectionKey<string> = Symbol('campusSelectLabel')

// 分校內容頁共用「上次編輯的校區」：在五校介紹改完仁武，換到常見問題也還是
// 仁武，不會每頁都跳回第一校。只記在這個分頁（sessionStorage）；私密模式等
// 讀寫失敗就當作沒有記。
const LAST_CAMPUS_KEY = 'ivy-admin-content-campus'

function rememberedCampus(): string {
  try {
    return sessionStorage.getItem(LAST_CAMPUS_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberCampus(key: string) {
  try {
    sessionStorage.setItem(LAST_CAMPUS_KEY, key)
  } catch {
    /* 存不了就不記 */
  }
}

// 分校內容頁（五校介紹、FAQ、消息、校園探索）共用：`campus` 由頁面先建好並交給
// useContentItem，這裡負責在選單切換時先確認有沒有未儲存的修改，確認放棄
// 才真的換校並重新載入；取消就把選單撥回去。目前的校區寫在網址 ?campus=，
// 重新整理或分享連結都停在同一校。
export function useCampusContent(
  editor: ContentEditorState,
  campus: Ref<string>,
  shell: Readonly<Ref<EditorShell | null>>,
  onSwitch?: () => void,
) {
  const scope = useCampusScope()
  const route = useRoute()
  const router = useRouter()
  const inScope = (key: unknown): key is string => typeof key === 'string' && scope.visibleCampusKeys.value.includes(key)
  // useRoute() 是全站目前的路由：換到別頁時它也會變，只處理還停在這一頁的時候。
  const ownPath = route?.path
  const onThisPage = () => Boolean(route) && route.path === ownPath

  // 從總覽、通知或發布紀錄點進來會帶 ?campus=，直接切到那一校（要在自己的範圍內）；
  // 沒帶就沿用上次在分校內容頁選的校區。
  const linked = route?.query.campus
  if (!campus.value && inScope(linked)) campus.value = linked
  if (!campus.value) {
    const last = rememberedCampus()
    if (inScope(last)) campus.value = last
  }
  if (!campus.value) campus.value = scope.selected.value
  let reverting = false

  function syncQuery(key: string) {
    if (!router || !key || !onThisPage() || route.query.campus === key) return
    void router.replace({ query: { ...route.query, campus: key } })
  }

  watch(
    campus,
    async (next, prev) => {
      if (reverting) {
        reverting = false
        // 從網址換校但使用者選擇留下：網址也撥回原本的校區。
        syncQuery(campus.value)
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
      rememberCampus(next)
      syncQuery(next)
      onSwitch?.()
      await editor.load()
    },
    { immediate: true },
  )

  // 已經在這一頁時再點帶 ?campus= 的連結（例如通知），元件不會重建，跟著網址換校。
  if (route) {
    watch(
      () => route.query.campus,
      (value) => {
        if (onThisPage() && inScope(value) && value !== campus.value) campus.value = value
      },
    )
  }

  // 登入者權限變動（例如重新整理後 session 還原）時同步預設校區
  watch(scope.selected, (v) => {
    if (v && !campus.value) campus.value = v
  })

  return scope
}
