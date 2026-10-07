// 一筆參觀案件的資料層與動作（2026-10-06 方向 C 從 VisitDetailView 抽出）：案件明細與列表右側的
// 預覽面板共用。回傳 reactive，子元件用 injectVisitCase() 取得同一份（provide／inject），不逐層傳 props。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type InjectionKey, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import { lastHandled } from '../api/visitHistory'
import type { RecruitmentVisit, VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
import { formatDateTime, formatSlotWhen, maskEmail, slotStarted, visitDisplay, visitDisplayStatus, visitStatus } from '../api/labels'
import { familyLastHandled, latestContact } from '../admissions/family'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { notifyError, notifyWarning } from './notify'
import { usePermissions } from './usePermissions'
import { useVisitStaff } from './useVisitStaff'
import { useFamilyAdmissions } from './useFamilyAdmissions'
import { arrivalFormLead } from './useArrivalAdmissionsForm'
import { arrivalAdmissionsNote } from './visitAttendance'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from './rescheduleDecision'
import { readVisitNoteDraft, writeVisitNoteDraft } from './visitNoteDraft'
import { followUpDue as isFollowUpDue, followUpTracked as isFollowUpTracked } from '../utils/visitSchedule'

// 哪一個動作正在處理：只有按下去的那顆按鈕轉圈，其他按鈕只停用，
// 不會讓人以為自己按到了別顆。
export type DetailAction = 'cancel' | 'no_show' | 'complete' | 'reschedule' | 'note' | RescheduleAction

export interface VisitCaseHooks {
  /** 每次讀到案件（含動作後的靜默重讀）；明細頁用來算「下一筆」。 */
  onLoaded?: (detail: VisitRequestFullOut) => void
  /** 狀態、場次或聯絡紀錄剛改過；預覽面板用來重讀列表。 */
  onChanged?: () => void
  /** 重新預約（另建新案）建好；明細頁與預覽面板都導到新案件。 */
  onRebooked?: (created: VisitRequestDetailOut) => void | Promise<void>
}

const DETAIL_STALE_MS = 30_000

export function useVisitCase(id: Readonly<Ref<string>>, hooks: VisitCaseHooks = {}) {
  const authStore = useAuthStore()
  const openRequests = useOpenRequestsStore()

  const detail = ref<VisitRequestFullOut | null>(null)
  // 招生部分（招生規格第 10 節、2026-10-05 家庭頁規格 5.10）：composables/useFamilyAdmissions.ts。
  const family = useFamilyAdmissions(detail, { reloadDetail: () => load({ quiet: true }) })
  // 家庭版面時的招生訪視；不是家庭版面就是 null（模板用它切換版面）。
  const familyVisit = computed(() => (family.isFamily.value ? family.visit.value : null))
  // 家長預約時填的資料在家庭版面收合（家庭頁規格 5.3）；換案件時收回去。
  const bookingDataOpen = ref(false)
  // 頁首「最後處理」：同事最近一次動這筆案件（api/visitHistory.ts）；家庭版面再併入招生事件與參觀後聯絡。
  const handled = computed(() => {
    const current = detail.value
    if (!current) return null
    const selfId = authStore.user?.id ?? null
    return familyVisit.value
      ? familyLastHandled(current.history ?? [], family.events.value, family.contactLogs.value, selfId)
      : lastHandled(current.history ?? [], selfId)
  })
  const notes = ref<VisitContactNoteOut[]>([])
  const availableSlots = ref<VisitSlotOut[]>([])
  // 已確認案件改期：選新場次、原因選填（記在案件歷程）。
  const rescheduleSlotId = ref('')
  const rescheduleReason = ref('')
  // 家長已經申請改期時，該做的是核准或退回；手動改期先收起來，要用再展開。
  const manualRescheduleOpen = ref(false)
  // 聯絡紀錄草稿：被打斷時存在這個分頁，回到同一筆帶回（composables/visitNoteDraft.ts）。
  const newNote = ref(readVisitNoteDraft(id.value))
  watch(newNote, (text) => writeVisitNoteDraft(id.value, text))
  // 「下次聯絡」跟著這一筆紀錄一起送；家長說「下週再打」時才有地方記，
  // 總覽的「到期待追蹤」也才會有來源。預先填案件目前的追蹤時間：不動就沿用，
  // 清空就是「不用再追」。
  const followUpAt = ref<string | null>(null)
  // 選擇器帶入時的伺服器值與案件版本（基準）。切回分頁靜默重讀時，選擇器沒動就跟著換成新值；
  // 動過而同事也改了，就保留自己的選擇、送出時帶基準版本，讓後端回 409 走衝突處理，
  // 不會把同事改好的時間用舊值蓋回去。
  let followUpBase: { picker: string | null; version: number } | null = null
  const pendingAction = ref<DetailAction | null>(null)
  const busy = computed(() => pendingAction.value !== null)
  const rebookOpen = ref(false)
  const loading = ref(true)
  const { can } = usePermissions()
  // 處理案件（聯絡紀錄、確認、取消、改期…）含櫃台；新增時段仍是校區管理者以上
  // （booking.manage）。
  const canHandle = computed(() => can('booking.handle'))
  const canManage = computed(() => can('booking.manage'))
  const { staff, load: loadStaff } = useVisitStaff()

  // 打好還沒按「新增紀錄」的聯絡紀錄：返回、下一筆、側欄換頁前都先問，
  // 不然同事接手時看不到這段聯絡過程。處理中（例如正在新增紀錄）先請使用者稍候。
  // 家庭版面沒有文字框：看不到的草稿不擋離開（家庭頁規格 Review Focus 1）。
  // 已到場、還在等招生查詢的空檔：先不畫改版前的版面，免得查完整頁跳成家庭版面（也看不到的草稿同樣不擋離開）。
  const familyPending = computed(() =>
    detail.value?.status === 'completed' && Boolean(authStore.features.admissions) && family.canRead.value && family.available.value === 'unknown' && !family.lookupFailed.value,
  )
  const noteDirty = computed(() => canHandle.value && !familyVisit.value && !familyPending.value && newNote.value.trim() !== '')

  const error = ref<string | null>(null)

  // 「下一筆」換 id 時元件不重新掛載：換案件就加一，舊案件較晚回來的
  // 回應不能蓋掉畫面（否則畫面是家長 A、送出卻寫到案件 B）。
  let generation = 0
  // 上次讀到案件的時間：切回分頁時超過 DETAIL_STALE_MS 才靜默重讀（不做固定輪詢）。
  let loadedAt = 0

  // 日期選擇器用台灣時間的字串（value-format），案件上的是 UTC ISO。
  function toPickerValue(iso: string | null | undefined): string | null {
    if (!iso) return null
    return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00'
  }

  function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return !a && !b
    return new Date(a).getTime() === new Date(b).getTime()
  }

  // 讀到案件後同步「下次聯絡」。reset：換案件或剛存好，選擇器直接換成伺服器的值；
  // quiet：背景重讀，選擇器沒動才跟著換，動過就只在伺服器上的值沒變時更新版本；
  // rebase：送出遇到版本衝突、已經提示過，以最新版本為基準（自己動過的選擇照樣保留）。
  function syncFollowUp(loaded: VisitRequestFullOut, mode: 'reset' | 'quiet' | 'rebase') {
    const server = toPickerValue(loaded.follow_up_at)
    const base = followUpBase
    const untouched = !base || sameInstant(followUpAt.value, base.picker)
    if (mode === 'reset' || untouched) followUpAt.value = server
    if (mode !== 'quiet' || untouched || sameInstant(server, base?.picker)) followUpBase = { picker: server, version: loaded.version }
  }

  // quiet：動作完成後的重讀不切回骨架畫面，頁面上的狀態（例如剛產生、只顯示
  // 一次的家長連結）才不會因為元件重新掛載而消失。
  async function load(options: { quiet?: boolean } = {}) {
    const gen = generation
    const requestId = id.value
    if (!options.quiet) loading.value = true
    error.value = null
    try {
      // 案件與聯絡紀錄互不相依，一起送出，手機網路少等一次往返。兩個都等回來
      // 再看結果：案件本身讀不到（例如找不到）優先說明，不被聯絡紀錄的錯誤蓋掉。
      const [caseResult, notesResult] = await Promise.allSettled([
        api.get<VisitRequestFullOut>(`/admin/visit-requests/${requestId}`),
        api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${requestId}/contact-notes`),
      ])
      if (caseResult.status === 'rejected') throw caseResult.reason
      if (notesResult.status === 'rejected') throw notesResult.reason
      if (gen !== generation) return
      const loaded = caseResult.value
      detail.value = loaded
      loadedAt = Date.now()
      notes.value = notesResult.value
      syncFollowUp(loaded, options.quiet ? 'quiet' : 'reset')
      hooks.onLoaded?.(loaded)
      // 改期（已確認）從同校未來 60 天的場次挑。
      let slots: VisitSlotOut[] = []
      if (loaded.status === 'confirmed') {
        const today = new Date().toISOString().slice(0, 10)
        const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        slots = await api.get<VisitSlotOut[]>(
          `/admin/slots?campus_key=${loaded.campus_key}&date_from=${today}&date_to=${future}`,
        )
      }
      if (gen !== generation) return
      availableSlots.value = slots
    } catch (err) {
      if (gen !== generation) return
      if (options.quiet) {
        // 靜默重讀失敗不能換掉整個畫面（正在打的聯絡紀錄草稿會消失），保留現況並提醒。
        notifyWarning('無法更新案件，畫面可能不是最新。')
        return
      }
      error.value = err instanceof ApiError && err.status === 404 ? '找不到這筆案件，可能已被移除或不在你的校區範圍。' : '無法讀取案件'
    } finally {
      if (gen === generation) loading.value = false
    }
  }

  // 動作完成後只更新案件本身（含歷程），不切回骨架畫面：家長連結剛產生的
  // 網址還顯示在頁面上，重新掛載就看不到了。
  async function refreshDetail(followUp: 'quiet' | 'rebase' = 'quiet') {
    const gen = generation
    try {
      const loaded = await api.get<VisitRequestFullOut>(`/admin/visit-requests/${id.value}`)
      if (gen !== generation) return
      detail.value = loaded
      syncFollowUp(loaded, followUp)
    } catch {
      /* 下次重新整理再讀 */
    }
  }

  // 動作失敗後重讀：失敗那一刻案件可能剛被別人動過（狀態、場次或歷程不同），列表上那一列也是舊的，
  // 有變才通知；沒變就不多打一次列表。
  async function reloadNotifyingIfChanged() {
    const before = activityKey()
    await load({ quiet: true })
    if (activityKey() !== before) hooks.onChanged?.()
  }

  function reportError(err: unknown, fallback: string) {
    if (isVersionConflict(err)) {
      // 別人剛改過下次聯絡時間：不蓋掉，重讀案件讓畫面顯示最新的。
      // 已經自動重讀，所以不接後端「請重新載入後再操作」的訊息。
      notifyWarning('這筆案件的下次聯絡時間剛被其他人修改，已載入最新的內容，請確認後再操作')
      // 列表上的「預定聯絡」也是舊的：讀到新值之後通知，列表重讀拿到的才是同事改好的。
      void refreshDetail('rebase').then(() => hooks.onChanged?.())
      return
    }
    if (apiErrorCode(err) === 'INVALID_TRANSITION') {
      void reloadAfterTransitionConflict(err, fallback)
      return
    }
    notifyError(apiErrorMessage(err, fallback))
  }

  // 狀態轉換被擋：多半是同事剛處理過（兩人同時開著同一筆）。重讀後狀態真的變了就寫
  // 現在是什麼、誰在什麼時候做的；狀態沒變（例如場次還沒開始就標記未到場）照後端原因講。
  async function reloadAfterTransitionConflict(err: unknown, fallback: string) {
    const before = detail.value?.status
    const handledBefore = handled.value?.at ?? null
    await reloadNotifyingIfChanged()
    const current = detail.value
    if (!current || !before || current.status === before) {
      notifyError(apiErrorMessage(err, fallback))
      return
    }
    // 只有同事有比重讀前更新的動作才點名；狀態是家長（修改連結）或系統改的就用中性說法。
    const latest = handled.value
    const newer = latest !== null && (handledBefore === null || Date.parse(latest.at) > Date.parse(handledBefore))
    const label = statusDisplay.value?.label ?? visitStatus(current.status).label
    if (newer && !latest.self) {
      notifyWarning(`這筆案件剛被處理過：${latest.who}在 ${formatDateTime(latest.at)} ${latest.what}，現在是「${label}」。已載入最新內容，請確認後再操作。`)
    } else {
      notifyWarning(`這筆案件剛被更新，現在是「${label}」。已載入最新內容，請確認後再操作。`)
    }
  }

  // 切回這個分頁或視窗：距上次讀取超過 30 秒就靜默重讀（不閃骨架、不動聯絡紀錄草稿與
  // 「下次聯絡」的選擇），同事剛處理過就提示一句。
  function activityKey(): string {
    const d = detail.value
    return d ? `${d.status}|${d.slot_id ?? ''}|${d.history?.length ?? 0}` : ''
  }
  // 切回時 focus 與 visibilitychange 通常連續觸發：重讀進行中就略過，只讀一次、只提示一次。
  let refreshing = false
  async function refreshIfStale() {
    if (refreshing || document.visibilityState === 'hidden' || loading.value || busy.value || !detail.value) return
    if (Date.now() - loadedAt < DETAIL_STALE_MS) return
    refreshing = true
    try {
      const before = activityKey()
      const handledBefore = handled.value?.at ?? null
      const gen = generation
      await load({ quiet: true })
      // 家庭版面的招生訪視、事件與聯絡紀錄不在 load 裡，同事剛在招生端動過的要一起讀回來。
      if (gen === generation && familyVisit.value) void family.reload()
      if (gen !== generation || !before || activityKey() === before) return
      const latest = handled.value
      // 只有同事有比重讀前更新的動作才點名；變動來自家長或系統就用中性說法。
      const newer = latest !== null && (handledBefore === null || Date.parse(latest.at) > Date.parse(handledBefore))
      if (newer && latest.self) return
      notifyWarning(newer ? `${latest.who}剛剛${latest.what}，畫面已更新。` : '這筆案件剛有更新，畫面已重新整理。')
    } finally {
      refreshing = false
    }
  }

  // 已經開始的場次不能再排人（後端也會拒絕），名額滿或關閉的也不列。
  const openSlots = computed(() =>
    availableSlots.value.filter((s) => !s.closed && s.booked_count < s.capacity && !slotStarted(s)),
  )
  const rescheduleSlots = computed(() => openSlots.value.filter((s) => s.id !== detail.value?.slot_id))

  // 名額以「組家庭」計，一組幾個人都只占一個名額。
  function slotLabel(slot: VisitSlotOut): string {
    const left = slot.capacity - slot.booked_count
    return `${formatSlotWhen(slot)}，剩 ${left} 組`
  }
  // 側欄窄，選單收起後的完整場次會被截斷；選好後在下面整行再寫一次。
  function chosenSlotText(slots: VisitSlotOut[], slotId: string): string {
    const slot = slots.find((s) => s.id === slotId)
    return slot ? slotLabel(slot) : ''
  }

  // 取消與改期會寄信給家長（有 Email 時）；說明寫在確認框裡，櫃台才知道不必再打電話。
  // 寄信是否啟用要看該校的預約設定；讀不到（沒有權限）時不保證，提醒自行確認。
  const emailEnabled = ref<boolean | null>(null)
  watch(() => detail.value?.campus_key, async (campus) => {
    emailEnabled.value = null
    if (!campus) return
    try {
      const config = await api.get<{ parent_email_enabled?: boolean }>(`/admin/booking-config/${campus}`)
      if (detail.value?.campus_key === campus && typeof config?.parent_email_enabled === 'boolean') emailEnabled.value = config.parent_email_enabled
    } catch {
      emailEnabled.value = null
    }
  }, { immediate: true })
  const parentMailNote = computed(() => {
    const email = detail.value?.email
    if (!email) return '這筆沒有 Email，請電話通知家長。'
    if (emailEnabled.value === true) return `會寄信通知家長（${maskEmail(email)}）。`
    if (emailEnabled.value === false) return '尚未設定寄信，請電話通知家長。'
    return `有 Email（${maskEmail(email)}），但無法確認系統是否會寄信，請確認是否需要另外通知家長。`
  })
  async function cancel() {
    // 參觀時間已過：家長沒來要按「沒來」（標記未到場），取消會被算成園方取消、名額也會釋出。
    const noShowNote = attendanceDue.value ? '家長沒來請改用上方的「沒來」。' : ''
    let reason: string | null = null
    try {
      const result = await ElMessageBox.prompt(
        `${noShowNote}原場次的名額會釋出。案件會結案。${parentMailNote.value}家長之後想再約，可以在這一頁用「重新預約（另建新案）」接續，不必請家長重新送出。`,
        '取消這筆預約？',
        {
          confirmButtonText: '取消預約',
          confirmButtonClass: 'el-button--danger',
          cancelButtonText: '先不要',
          autofocus: false,
          inputPlaceholder: '取消原因（選填，會記在案件歷程）',
          inputValidator: (value: string) => !value || value.length <= 500 || '原因最多 500 字',
          type: 'warning',
        },
      )
      const value = (result as { value?: string }).value ?? ''
      reason = value.trim() || null
    } catch {
      return
    }
    pendingAction.value = 'cancel'
    try {
      await api.post(`/admin/visit-requests/${id.value}/cancel`, { reason })
      ElMessage.success('已取消')
      openRequests.refresh(true)
      await load({ quiet: true })
      hooks.onChanged?.()
    } catch (err) {
      reportError(err, '取消失敗')
    } finally {
      pendingAction.value = null
    }
  }

  async function markNoShow() {
    try {
      await ElMessageBox.confirm('標記後這筆案件會結案。這一場的名額仍算已使用，不會再開放給別人。', '標記為未到場？', {
        confirmButtonText: '標記未到場',
        cancelButtonText: '先不要',
        type: 'warning',
      })
    } catch {
      return
    }
    pendingAction.value = 'no_show'
    try {
      await api.post(`/admin/visit-requests/${id.value}/no-show`)
      ElMessage.success('已標記未到場')
      // 結案時家長待核准的改期申請跟著失效，側欄的待核准數要一起更新。
      openRequests.refresh(true)
      await load({ quiet: true })
      hooks.onChanged?.()
    } catch (err) {
      reportError(err, '操作失敗')
    } finally {
      pendingAction.value = null
    }
  }

  // 參觀場次開始後才出現「標記已到場」與「標記未到場」（後端也會拒絕）：兩者都會
  // 保留這一場的名額，提早按下去未來那一場就永遠排不進人；家長事先說不來要取消。
  // 櫃台常開著案件頁等家長來，時間每 30 秒重算一次，場次一開始按鈕就出現；
  // 下次聯絡是否已過也跟著這個時鐘更新。
  const clockNow = ref(Date.now())
  const clock = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)
  const visitStarted = computed(() => {
    const slot = detail.value?.slot
    return slot ? slotStarted(slot, clockNow.value) : false
  })
  // 已確認而且場次已經開始：該做的是標記已到場／未到場，不是取消。
  const attendanceDue = computed(() => detail.value?.status === 'confirmed' && visitStarted.value)
  // 頁首狀態和案件列表同一種說法（預約正常／預約時間已過・尚未確認到場…）。
  // 分組跟著上面的時鐘重算：開著頁面等家長來，場次一開始就換成「預約時間已過」。
  const statusDisplay = computed(() => {
    const current = detail.value
    return current ? visitDisplay({ ...current, display_status: visitDisplayStatus(current.status, current.slot, clockNow.value) }) : null
  })
  // 確認時間和送出時間同一分鐘（官網自選場次送出即成立）時不重複列；舊流程與補登才會不同。
  const confirmedAtShown = computed(() => {
    const current = detail.value
    return Boolean(current?.confirmed_at) && formatDateTime(current!.confirmed_at) !== formatDateTime(current!.created_at)
  })

  async function reschedule() {
    const current = detail.value
    const target = rescheduleSlots.value.find((s) => s.id === rescheduleSlotId.value)
    if (!current || !target) {
      notifyWarning('請先選擇新的參觀場次')
      return
    }
    try {
      await ElMessageBox.confirm(
        `${current.parent_name} 的參觀時間會從 ${formatSlotWhen(current.slot)} 改到 ${formatSlotWhen(target)}，原場次名額釋出。${parentMailNote.value}`,
        '改期？',
        { confirmButtonText: '確認改期', cancelButtonText: '先不要', type: 'info' },
      )
    } catch {
      return
    }
    pendingAction.value = 'reschedule'
    try {
      await api.post(`/admin/visit-requests/${id.value}/reschedule`, {
        new_slot_id: target.id,
        reason: rescheduleReason.value.trim() || null,
      })
      ElMessage.success(`已改到 ${formatSlotWhen(target)}`)
      rescheduleSlotId.value = ''
      rescheduleReason.value = ''
      manualRescheduleOpen.value = false
      // 家長先前的改期申請在直接改期時失效，側欄的待核准數要一起更新。
      openRequests.refresh(true)
      await load({ quiet: true })
      hooks.onChanged?.()
    } catch (err) {
      reportError(err, '改期失敗')
      // 名額或時段可能剛被別人用掉，重讀一次讓選單反映現況。
      await reloadNotifyingIfChanged()
    } finally {
      pendingAction.value = null
    }
  }

  async function decideReschedule(action: RescheduleAction) {
    const request = detail.value?.pending_reschedule
    if (!request) return
    const decision = await confirmRescheduleDecision(request, action)
    if (!decision) return
    pendingAction.value = action
    try {
      await submitRescheduleDecision(request.id, action, decision.reason)
      ElMessage.success(action === 'approve' ? `已核准，改到 ${formatSlotWhen(request.requested_slot)}。記得告知家長。` : '已退回改期申請，家長維持原場次')
      openRequests.refresh(true)
      await load({ quiet: true })
      hooks.onChanged?.()
    } catch (err) {
      reportError(err, '操作失敗')
      await reloadNotifyingIfChanged()
    } finally {
      pendingAction.value = null
    }
  }

  // 重新預約（另建新案）建好：側欄的件數跟著更新；導到新案件由呼叫端（明細頁、預覽面板）決定。
  async function onRebooked(created: VisitRequestDetailOut) {
    openRequests.refresh(true)
    await hooks.onRebooked?.(created)
  }

  // 標記已到場後會不會接著打開招生資料表單：招生可用（查得到、開關開）而且能改招生資料。頁首主動作的提示與
  // markCompleted 共用這一條規則。
  const opensForm = computed(() => family.available.value === 'yes' && family.canWrite.value)

  // 招生入學可用時，標記已到場會在同一個交易裡建立招生訪視（規格 6.1），所以先確認（規格第 10 節原文）。
  // 招生未啟用（招生 API 404）或還不確定時，維持改版前的行為：沒有確認框、原本的訊息。
  // 能改招生資料的人標記後接著打開招生資料表單（2026-10-06，同案件列表的 useArrivalAdmissionsForm）。
  async function markCompleted() {
    // 招生查詢還在跑不是錯誤：等查完再決定要不要確認框，免得開關打開時沒確認就建了招生訪視。
    const lookupInFlight = family.canRead.value ? family.settled() : null
    if (lookupInFlight) await lookupInFlight
    const withAdmissions = family.available.value === 'yes'
    // 標記後招生會重查，opensForm 可能跟著變，所以這一刻的結果先存起來，確認框與標記之後都用同一個答案。
    const opensFormNow = opensForm.value
    if (withAdmissions) {
      try {
        await ElMessageBox.confirm(arrivalAdmissionsNote(opensFormNow), '標記已到場？', {
          confirmButtonText: '標記已到場',
          cancelButtonText: '先不要',
          type: 'info',
        })
      } catch {
        return
      }
    }
    pendingAction.value = 'complete'
    try {
      await api.post(`/admin/visit-requests/${id.value}/complete`)
      if (!opensFormNow) ElMessage.success(withAdmissions ? '已標記已到場，招生訪視已建立' : '已標記已到場')
      openRequests.refresh(true)
      await load({ quiet: true })
      hooks.onChanged?.()
      if (opensFormNow) await openArrivalForm()
    } catch (err) {
      reportError(err, '操作失敗')
    } finally {
      pendingAction.value = null
    }
  }

  // ---- 家庭版面（2026-10-05 家庭頁規格第 5 節）----
  const latestFamilyContact = computed(() => latestContact(family.contactLogs.value))
  // 撥號：園方改過以招生那筆為準，招生電話空的退回預約電話（規格 5.2）。
  // 匿名化後預約電話也會被寫成假號碼，退回撥它沒有意義：整顆不顯示（Review Focus 3）。
  const callPhone = computed(() => {
    const v = familyVisit.value
    if (!v) return detail.value?.phone ?? ''
    if (v.anonymized_at) return ''
    return v.phone || detail.value?.phone || ''
  })
  const bookingDataTitle = computed(() => {
    if (familyVisit.value) return isWebCase.value ? '家長預約時填寫的資料' : '補登時的案件資料'
    return isWebCase.value ? '家長填寫的資料' : '案件資料'
  })

  // 標記已到場後的招生資料表單：狀態變成已到場會重查招生訪視（useFamilyAdmissions），等查完、
  // 查得到就打開（後面同時換成家庭版面）；表單上方寫出已到場，所以不另跳成功訊息。
  const arrivalOpen = ref(false)
  const arrivalLead = ref('')
  async function openArrivalForm() {
    await nextTick()
    const lookup = family.settled()
    if (lookup) await lookup
    const current = detail.value
    if (current?.status === 'completed' && family.visit.value) {
      arrivalLead.value = arrivalFormLead(current.parent_name)
      arrivalOpen.value = true
    } else {
      ElMessage.success('已標記已到場，招生訪視已建立')
    }
  }

  // 家庭版面頁首的「填招生資料」（2026-10-06 方向 C）：同一個表單，不是剛標記到場，所以不寫「已標記…已到場」、
  // 取消鈕維持「取消」（VisitCaseDialogs 依 arrivalLead 決定）。
  function openAdmissionsForm() {
    if (!family.visit.value) return
    arrivalLead.value = ''
    arrivalOpen.value = true
  }

  function onFamilyChanged(next: RecruitmentVisit) {
    family.replaceVisit(next)
    void family.loadExtras()
  }

  async function addNote() {
    // 畫面上的案件（detail）才是要寫的那一筆；還在載入下一筆時不送。
    if (!newNote.value.trim() || !detail.value || detail.value.id !== id.value || busy.value) return
    const gen = generation
    const current = detail.value
    const nextFollowUp = followUpAt.value || null
    // 改或清下次聯絡時間會蓋掉案件上的值，要帶版本；沒動就只記一筆紀錄。已到場、已取消的案件
    // 不列入到期待追蹤，選擇器也不顯示，不送下次聯絡（後端 FOLLOW_UP_NOT_TRACKED）。
    // 有沒有動、帶哪個版本都跟選擇器帶入時的基準比（followUpBase），不是重讀後的案件：
    // 同事在這段期間改過的話，後端會回 409，不會把同事的時間蓋掉。
    const base = followUpBase ?? { picker: toPickerValue(current.follow_up_at), version: current.version }
    const followUpChanged = followUpTracked.value && !sameInstant(nextFollowUp, base.picker)
    pendingAction.value = 'note'
    try {
      await api.post(`/admin/visit-requests/${current.id}/contact-notes`, {
        note: newNote.value.trim(),
        ...(followUpChanged ? { follow_up_at: nextFollowUp, expected_version: base.version } : {}),
      })
      // 送出的這段時間使用者已換到別筆：紀錄已經寫進原案件（可能連下次聯絡也改了），列表那一列要更新。
      if (gen !== generation) {
        hooks.onChanged?.()
        return
      }
      newNote.value = ''
      notes.value = await api.get<VisitContactNoteOut[]>(`/admin/visit-requests/${current.id}/contact-notes`)
      // 追蹤時間存在案件上、歷程也多一筆；重讀一次頁首與歷程。
      await refreshDetail()
      hooks.onChanged?.()
      if (gen !== generation) return
      if (detail.value) syncFollowUp(detail.value, 'reset')
      if (followUpChanged) ElMessage.success(nextFollowUp ? '已記下，到時會出現在總覽的「到期待追蹤」' : '已清除下次聯絡時間，不會再出現在「到期待追蹤」')
    } catch (err) {
      reportError(err, '新增紀錄失敗')
    } finally {
      pendingAction.value = null
    }
  }

  // 會列進總覽「到期待追蹤」的案件：與後端同一個定義，已取消、已完成的不算
  // （結案不會清掉下次聯絡時間，所以不能只看時間）。規則在 utils/visitSchedule，列表的列共用。
  const followUpTracked = computed(() => !!detail.value && isFollowUpTracked(detail.value.status))

  // 追蹤時間已過、案件還沒結案：頁首用警示色提醒。
  const followUpDue = computed(() => !!detail.value && isFollowUpDue(detail.value, Date.now()))

  // 紀錄框旁預填的下次聯絡已經過了：不動就沿用（測試規範），但提醒送出後
  // 這筆仍會留在「到期待追蹤」。已確認的案件也可能是刻意設的提醒，只提示不擋；
  // 已取消、已完成的不會列進去，不提示。
  const followUpPast = computed(() => {
    if (!followUpAt.value || !followUpTracked.value) return false
    const at = Date.parse(followUpAt.value)
    return !Number.isNaN(at) && at <= clockNow.value
  })

  // 還在流程中的案件才需要家長連結；結案時後端已經撤銷。
  const linkApplicable = computed(() => detail.value?.status === 'confirmed')

  // 官網送出的才是家長自己填的；園方補登的是櫃台代填。
  const isWebCase = computed(() => !detail.value?.source || detail.value.source === 'web')

  onMounted(() => {
    void load()
    void loadStaff()
    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
  })
  onBeforeUnmount(() => {
    window.clearInterval(clock)
    document.removeEventListener('visibilitychange', refreshIfStale)
    window.removeEventListener('focus', refreshIfStale)
  })
  // 「下一筆」或預覽換一筆：同一個元件換 id，不重新掛載。
  watch(id, () => {
    generation += 1
    detail.value = null
    notes.value = []
    newNote.value = readVisitNoteDraft(id.value)
    bookingDataOpen.value = false
    followUpAt.value = null
    followUpBase = null
    rescheduleSlotId.value = ''
    rescheduleReason.value = ''
    manualRescheduleOpen.value = false
    void load()
  })

  return reactive({
    detail, notes, availableSlots, loading, error, newNote, followUpAt, rescheduleSlotId, rescheduleReason, manualRescheduleOpen,
    pendingAction, busy, bookingDataOpen, rebookOpen, arrivalOpen, arrivalLead, emailEnabled, clockNow,
    canHandle, canManage, staff, family,
    canReadAdmissions: family.canRead, canCreateAdmissions: family.canWrite, admissionsVisit: family.visit,
    admissionsAvailable: family.available, creatingAdmissions: family.creating, lookupFailed: family.lookupFailed,
    extrasFailed: family.extrasFailed, familyEvents: family.events, familyLogs: family.contactLogs,
    familyStaff: family.staff, familyOptions: family.options,
    familyVisit, familyPending, handled, noteDirty, openSlots, rescheduleSlots, parentMailNote, visitStarted, attendanceDue,
    statusDisplay, confirmedAtShown, followUpTracked, followUpDue, followUpPast, linkApplicable, isWebCase,
    latestFamilyContact, callPhone, bookingDataTitle,
    load, refreshDetail, refreshIfStale, cancel, markNoShow, markCompleted, openArrivalForm, openAdmissionsForm, opensForm, reschedule, decideReschedule,
    addNote, onFamilyChanged, onRebooked, slotLabel, chosenSlotText,
  })
}

export type VisitCase = ReturnType<typeof useVisitCase>
export const VISIT_CASE_KEY: InjectionKey<VisitCase> = Symbol('visit-case')

export function provideVisitCase(vc: VisitCase): void {
  provide(VISIT_CASE_KEY, vc)
}

/** 案件明細的子元件（頁首、時間線、資料表、設定列…）取得同一份案件。 */
export function injectVisitCase(): VisitCase {
  const vc = inject(VISIT_CASE_KEY, null)
  if (!vc) throw new Error('VisitCase 沒有 provide：子元件要放在案件明細或預覽面板裡')
  return vc
}
