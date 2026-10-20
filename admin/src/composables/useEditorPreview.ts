import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { ContentEditorState } from './useContentItem'
import { useLivePreview } from './useLivePreview'
import {
  livePreviewOrigin,
  previewFrameUrl,
  previewTargetsFor,
  readPreviewViewport,
  rememberPreviewViewport,
  type PreviewPage,
  type PreviewViewport,
} from './previewTargets'

// ContentEditor 右側官網預覽的接線（2026-10-20 從 ContentEditor.vue 抽出，行為不變）：要不要放預覽欄、
// 目前分頁與寬度、iframe 網址與什麼時候重新載入、即時預覽（useLivePreview）。版面量測（usePreviewPaneFit）
// 綁在 ContentEditor 的根元素上，留在元件裡。

interface EditorPreviewOptions {
  /** 1280 以下（ContentEditor 用 useNarrowScreen 量）：維持原本版面，用狀態列的「存草稿並預覽」開新分頁。 */
  belowPreviewWidth: Ref<boolean>
  /** 尚未選校區等情況，表單換成提示時不放預覽欄。 */
  placeholder: () => string | undefined
  loading: Ref<boolean>
  loadError: Ref<string | null>
  latestRevisionId: Ref<string | null>
}

export function useEditorPreview(editor: ContentEditorState, options: EditorPreviewOptions) {
  const { belowPreviewWidth, loading, loadError, latestRevisionId } = options
  // 右側官網預覽（2026-10-06 方向 D）：1280 以上、後台與官網同源、這種內容有對應預覽頁時才放。
  const previewTargets = computed(() => previewTargetsFor(editor.kind))
  const previewOrigin = livePreviewOrigin()
  const showPreviewPane = computed(() => Boolean(previewOrigin) && previewTargets.value.length > 0 && !belowPreviewWidth.value && !options.placeholder())
  const previewTargetId = ref('')
  watch(
    previewTargets,
    (targets) => {
      if (!targets.some((t) => t.id === previewTargetId.value)) previewTargetId.value = targets[0]?.id ?? ''
    },
    { immediate: true },
  )
  const currentTarget = computed(() => previewTargets.value.find((t) => t.id === previewTargetId.value) ?? previewTargets.value[0] ?? null)
  const previewViewport = ref<PreviewViewport>(readPreviewViewport())
  watch(previewViewport, rememberPreviewViewport)
  // 即時預覽：把還沒存的表單送進 iframe（useLivePreview；預覽欄沒顯示時它什麼都不掛）。iframe 只在換校、
  // 重新載入時重建，換預覽分頁用訊息切、不重新載入。預覽頁沒接上（舊版官網、太慢、沒登入）時，
  // 切分頁照舊換網址，存成新的一版也重新載入，至少看得到剛存的草稿。
  // 校區以「表單是哪一校載入的」為準（loadedCampusKey），不是校區選單：有未存修改時換校會先問
  // 「放棄修改？」，這段時間選單已是下一校、表單還是上一校，預覽不能因此換 iframe 或把上一校標成下一校。
  // 沒給 loadedCampusKey 的 editor（舊的假物件）退回用校區選單的值。
  const previewCampusKey = computed(() => (editor.loadedCampusKey ? editor.loadedCampusKey.value : (editor.campusKey?.value ?? null)))
  const previewFrame = shallowRef<HTMLIFrameElement | null>(null)
  const livePreview = useLivePreview({
    frame: previewFrame,
    origin: previewOrigin ?? '',
    kind: editor.kind ?? '',
    campusKey: previewCampusKey,
    form: editor.form ?? ref(null),
    target: currentTarget,
    enabled: showPreviewPane,
  })
  const previewState = livePreview.state
  // 從沒存過任何版本：預覽看到的是官網目前的內容，說明不能寫「上次儲存的草稿」。
  const previewNeverSaved = computed(() => Boolean(editor.latestRevisionId) && latestRevisionId.value === null)
  const previewReload = ref(0)
  const previewFrameKey = computed(() => `${previewCampusKey.value ?? ''}|${previewReload.value}`)
  const previewSrc = ref('')
  // iframe 網址上載的是哪一頁。預覽接上（live）後切分頁只送訊息、網址不動，所以它可能和目前分頁不同。
  let framePage: PreviewPage | null = null
  function loadPreviewPage() {
    framePage = currentTarget.value?.page ?? null
    previewSrc.value = previewOrigin && framePage ? previewFrameUrl(previewOrigin, framePage, { live: true }) : ''
  }
  watch(previewFrameKey, loadPreviewPage, { immediate: true })
  // 預覽欄收起再出現（寬度跨 1280）會建新的 iframe：網址要換成目前分頁那一頁。
  watch(showPreviewPane, (shown) => {
    if (shown) loadPreviewPage()
  })
  watch(currentTarget, () => {
    if (previewState.value !== 'live') loadPreviewPage()
  })
  // 讀取中、讀取失敗時整個版面（含預覽欄）換成骨架／提示，讀好之後預覽欄重掛、建新的 iframe：同校區重新載入
  // （重新載入鈕、版本衝突「載入最新」）時 previewFrameKey 沒變，網址要自己重算成目前分頁那一頁；不然 live 時
  // 切過分頁的話，新的 iframe 載入的是切分頁之前的頁，沒接上的狀態（saved／denied）就一直看到舊分頁。
  watch(
    () => !loadError.value && !loading.value,
    (shown) => {
      if (shown) loadPreviewPage()
    },
  )
  // 離開 live（草稿太大退回 saved、預覽頁拒絕）之後，iframe 該顯示目前分頁那一頁：和網址上的不同就重新載入。
  watch(previewState, (now, before) => {
    if (before === 'live' && (now === 'saved' || now === 'denied') && currentTarget.value && currentTarget.value.page !== framePage) previewReload.value += 1
  })
  watch(latestRevisionId, () => {
    if (previewState.value === 'saved') previewReload.value += 1
  })

  return {
    previewTargets, showPreviewPane, previewTargetId, currentTarget, previewViewport, previewFrame,
    previewState, previewNotice: livePreview.notice, previewNeverSaved, previewReload, previewFrameKey, previewSrc,
  }
}
