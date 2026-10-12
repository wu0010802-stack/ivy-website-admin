import { computed, watch, type Ref } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { useCampusScope } from './useCampusScope'
import { notifyWarning } from './notify'
import type { ContentEditorState } from './useContentItem'
import type ContentEditor from '../components/ContentEditor.vue'

type EditorShell = InstanceType<typeof ContentEditor>

// 分校內容頁共用「上次編輯的校區」：在五校介紹改完仁武，換到各校消息也還是
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

// 分校內容頁（五校介紹、消息、校園探索）共用：`campus` 由頁面先建好並交給
// useContentItem，這裡負責在選單切換時先確認有沒有未儲存的修改，確認放棄
// 才真的換校並重新載入；取消就把選單撥回去。目前的校區寫在網址 ?campus=，
// 重新整理或分享連結都停在同一校。
export function useCampusContent(
  editor: ContentEditorState,
  campus: Ref<string>,
  shell: Readonly<Ref<EditorShell | null>>,
  onSwitch?: () => void,
  options: { allCampuses?: boolean } = {},
) {
  const scope = useCampusScope({ allCampuses: options.allCampuses })
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
  // 從網址換校前已經問過「放棄修改？」並同意：切換時不再問第二次。
  let confirmedSwitch: string | null = null
  // 存檔、發布、送審、審核、排程、還原還在處理：一律不換校。回應回來時寫進的是「目前的」
  // 校區，處理中換了校，舊校的結果就會蓋掉新校的狀態。校區選單處理中停用（頁面綁這個），
  // 從網址或硬換進來的也撥回去並提示。
  const campusLocked = computed(() => editor.saving.value || editor.publishing.value)
  const BUSY_SWITCH_TEXT = '正在處理這一校的內容，請等完成後再換校區。'

  function syncQuery(key: string) {
    if (!router || !key || !onThisPage() || route.query.campus === key) return
    void router.replace({ query: { ...route.query, campus: key } })
  }

  watch(
    campus,
    async (next, prev) => {
      if (reverting) {
        reverting = false
        // 備援：網址已經換了（沒經過下面的離頁攔截）但使用者選擇留下，網址也撥回。
        syncQuery(campus.value)
        return
      }
      if (!next) return
      if (prev && campusLocked.value) {
        notifyWarning(BUSY_SWITCH_TEXT)
        reverting = true
        campus.value = prev
        return
      }
      // 只認網址真的換到這一校的那次（換頁被其他原因取消就照常再問）。
      const confirmed = confirmedSwitch === next && route?.query.campus === next
      confirmedSwitch = null
      if (prev && editor.isDirty.value && !confirmed) {
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
  // 有未儲存的修改要先問；選擇留下就取消這次換頁，網址和上一頁紀錄都不動。
  if (route) {
    onBeforeRouteUpdate(async (to) => {
      const value = to.query.campus
      if (to.path !== ownPath || !inScope(value) || value === campus.value) return true
      if (campusLocked.value) {
        notifyWarning(BUSY_SWITCH_TEXT)
        return false
      }
      if (!editor.isDirty.value) return true
      if (!(await shell.value?.confirmLeave())) return false
      confirmedSwitch = value
      return true
    })
    watch(
      () => route.query.campus,
      (value) => {
        if (!onThisPage()) return
        if (inScope(value)) {
          if (value !== campus.value) campus.value = value
          return
        }
        // 從側欄再點同一頁（網址沒帶校區）或帶了看不到的校區：畫面仍停在目前的
        // 校區，網址補回來，重新整理或分享才不會跳校。
        syncQuery(campus.value)
      },
    )
  }

  // 登入者權限變動（例如重新整理後 session 還原）時同步預設校區
  watch(scope.selected, (v) => {
    if (v && !campus.value) campus.value = v
  })

  return { ...scope, campusLocked }
}
