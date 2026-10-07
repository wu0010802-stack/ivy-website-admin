<script setup lang="ts">
import { computed, nextTick, ref, toRefs, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { ageLabel, campusLabel, consentRecordLabel, contactTimeLabel, formatDateTime, partySizeLabel, referralSourceLabels } from '../api/labels'
import { groupSlotsByDay, slotChoiceTime } from '../utils/sessions'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useCampusScope } from '../composables/useCampusScope'
import { provideVisitCase, useVisitCase } from '../composables/useVisitCase'
import { ARRIVAL_FORM_CANCEL_TEXT } from '../composables/useArrivalAdmissionsForm'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { detailOrigin } from '../admissions/family'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import VisitCaseHero from '../components/visit/VisitCaseHero.vue'
import VisitCaseTimeline from '../components/visit/VisitCaseTimeline.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

// 案件的資料層與動作在 composables/useVisitCase.ts（2026-10-06 抽出，預覽面板共用同一份）；
// 這一頁只管返回、下一筆、離頁保護與改期表單的焦點；聯絡紀錄與歷程在 VisitCaseTimeline。
const vc = useVisitCase(id, {
  onLoaded: (loaded) => void loadNextCases(loaded.campus_key),
  onRebooked: async (created) => {
    const failure = await router.push(`/visit-requests/${created.id}`)
    // 紀錄框還有沒新增的紀錄、使用者選擇留在這頁：新案件已經建好了，告訴他之後去哪裡開。
    if (failure) ElMessage.info('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
  },
})
provideVisitCase(vc)
const {
  detail, rescheduleSlotId, rescheduleReason, manualRescheduleOpen, pendingAction, busy,
  bookingDataOpen, rebookOpen, arrivalOpen, arrivalLead, canHandle, canManage, canCreateAdmissions,
  admissionsVisit, familyOptions, familyStaff,
  familyVisit, familyPending, noteDirty, rescheduleSlots, attendanceDue, confirmedAtShown,
  linkApplicable, latestFamilyContact,
  bookingDataTitle, loading, error, emailEnabled,
} = toRefs(vc)
const { cancel, reschedule, onFamilyChanged, onRebooked, slotLabel, chosenSlotText, refreshDetail } = vc
const family = vc.family

const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
// 打好還沒按「新增紀錄」的聯絡紀錄（noteDirty，定義見 useVisitCase）：返回、下一筆、側欄換頁前都先問。
const { confirmLeave } = useUnsavedChanges(noteDirty, busy)
// 「下一筆」只換 :id，不會觸發離頁守衛，要另外攔。
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? confirmLeave() : true))

const rescheduleSelect = ref<{ focus: () => void } | null>(null)
const rescheduleTitle = ref<HTMLElement | null>(null)
// 手動改期表單一律先收成一個連結，要用再展開（2026-10-05 第九輪）：改期不是每筆都要做的事，
// 整個表單攤在處理面板最上面，手機上會把聯絡紀錄推到很下面。家長申請改期時先核准或退回，
// 參觀開始後先標記到場，也都是先看到那些按鈕。
const manualRescheduleShown = computed(() => manualRescheduleOpen.value)

// 展開手動改期時，按下的連結會被表單換掉；把焦點移進表單（能選時段就放在
// 時段選單，沒有時段可選就放在標題），鍵盤與報讀軟體才知道表單出現在哪裡。
async function openManualReschedule() {
  manualRescheduleOpen.value = true
  await nextTick()
  if (rescheduleSlots.value.length > 0 && rescheduleSelect.value) rescheduleSelect.value.focus()
  else rescheduleTitle.value?.focus()
}

// 同校還沒處理完的其他案件，讓櫃台能一筆接一筆處理，不必每次回列表。
// 從列表點進來時跟著那份列表的條件與順序（list）；沒有來源時照下方 loadNextCases 的處理優先序。
interface NextCount { count: number; more: boolean }
const nextQueue = ref<{ id: string; attendance: NextCount; due: NextCount; list?: { count: number } } | null>(null)

// 下一筆的清單上限；回傳剛好這麼多筆時，件數寫「N+」，不假裝是全部。
const NEXT_LIMIT = 100

// 排序用的時間：沒有值的排在最後。
function timeOf(value: string | null | undefined): number {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}
const visitTime = (request: VisitRequestDetailOut) =>
  timeOf(request.slot ? `${request.slot.slot_date}T${request.slot.start_time.slice(0, 8)}+08:00` : null)
const byTime = (key: (r: VisitRequestDetailOut) => number) => (a: VisitRequestDetailOut, b: VisitRequestDetailOut) => {
  const x = key(a)
  const y = key(b)
  return x === y ? 0 : x < y ? -1 : 1
}

// 列表帶進來的條件只收這些鍵，其餘忽略；分頁與每頁筆數由這裡自己決定。
const LIST_KEYS = ['campus_key', 'group', 'status', 'open', 'q', 'follow_up_due', 'source', 'created_from', 'created_to', 'needs_attention', 'order', 'page', 'page_size']
function sourceListParams(): URLSearchParams | null {
  const raw = route.query.list
  if (typeof raw !== 'string' || !raw) return null
  const incoming = new URLSearchParams(raw)
  const params = new URLSearchParams()
  for (const key of LIST_KEYS) {
    const value = incoming.get(key)
    if (value) params.set(key, value)
  }
  // 從列表第 1 頁來就一次抓 50 筆；第 2 頁以後照列表的頁碼與每頁筆數抓同一段。
  if (!params.has('page_size')) params.set('page_size', '50')
  return params
}

const NONE: NextCount = { count: 0, more: false }
// 目前這筆在來源列表的第幾位；處理完離開列表（例如狀態變了）後，
// 接手它位置的那一筆就是下一筆。
let queuePosition = 0

// 從列表點進來：下一筆照那份列表的條件與順序走。
async function loadListNext(source: URLSearchParams, gen: number) {
  const list = await api.get<VisitRequestDetailOut[]>(`/admin/visit-requests?${source}`)
  if (gen !== nextGeneration) return
  const rows = Array.isArray(list) ? list : []
  const index = rows.findIndex((r) => r.id === id.value)
  const others = rows.filter((r) => r.id !== id.value)
  if (index >= 0) queuePosition = index
  const next = index >= 0 ? (rows[index + 1] ?? others[0]) : others[Math.min(queuePosition, others.length - 1)]
  nextQueue.value = next
    ? { id: next.id, attendance: NONE, due: NONE, list: { count: others.length } }
    : null
}

// 下一筆的順序（2026-09-30 家長自選場次之後）：先是參觀時間已過、還沒標記到場的預約，
// 參觀時間早的先；再來是到期待追蹤，預定聯絡時間早的先。後端列表只能依送出時間排序，
// 這裡自己排；同一筆同時符合兩段時只算在前一段。
async function loadNextCases(campusKey: string) {
  const gen = nextGeneration
  const source = sourceListParams()
  if (source) {
    try {
      await loadListNext(source, gen)
    } catch {
      if (gen === nextGeneration) nextQueue.value = null
    }
    return
  }
  const fetchList = (params: Record<string, string>) =>
    api.get<VisitRequestDetailOut[]>(
      `/admin/visit-requests?${new URLSearchParams({ ...params, campus_key: campusKey, order: 'oldest', page_size: String(NEXT_LIMIT) })}`,
    )
  try {
    const [attendance, due] = await Promise.all([
      fetchList({ group: 'past', status: 'confirmed' }),
      fetchList({ follow_up_due: 'true' }),
    ])
    if (gen !== nextGeneration) return
    const rows = (list: unknown) => (Array.isArray(list) ? (list as VisitRequestDetailOut[]) : [])
    const seen = new Set([id.value])
    const take = (list: VisitRequestDetailOut[]) => list.filter((r) => !seen.has(r.id) && seen.add(r.id))
    const attendanceOthers = take(rows(attendance).sort(byTime(visitTime)))
    const dueOthers = take(rows(due).sort(byTime((r) => timeOf(r.follow_up_at))))
    const first = attendanceOthers[0] ?? dueOthers[0]
    const full = (list: unknown) => rows(list).length >= NEXT_LIMIT
    nextQueue.value = first
      ? {
          id: first.id,
          attendance: { count: attendanceOthers.length, more: full(attendance) },
          due: { count: dueOthers.length, more: full(due) },
        }
      : null
  } catch {
    if (gen === nextGeneration) nextQueue.value = null
  }
}

// 按鈕上寫清楚算的是什麼：同校待標記到場幾件、到期追蹤幾件（不含這一筆）。
const nextCount = (c: NextCount) => `${c.count}${c.more ? '+' : ''}`
const nextLabel = computed(() => {
  const q = nextQueue.value
  if (!q) return ''
  if (q.list) return `下一筆（這份列表還有 ${q.list.count} 件）`
  const parts = [
    q.attendance.count ? `待標記到場 ${nextCount(q.attendance)}` : '',
    q.due.count ? `到期追蹤 ${nextCount(q.due)}` : '',
  ].filter(Boolean)
  return `下一筆（${parts.join('・')}）`
})

const nextTitle = computed(() => {
  const q = nextQueue.value
  if (!q || !detail.value) return ''
  if (q.list) return '照剛才案件列表的篩選條件與排序往下'
  return `${campusLabel(detail.value.campus_key)}還有參觀時間已過、尚未確認到場 ${q.attendance.count} 件，到期待追蹤 ${q.due.count} 件（不含這一筆）；參觀時間早的排最前面`
})

// 上一頁是哪裡（2026-10-05 家庭頁規格 6.2）：從招生入學或案件列表來的用瀏覽器返回（保留分頁、篩選與
// 捲動位置）；從通知連結、登入頁或別的頁面進來時，返回會回到不相干的地方，改成直接開案件列表。
const readOrigin = () => detailOrigin((router.options.history.state as { back?: unknown } | null)?.back)
const origin = ref(readOrigin())
const backLabel = computed(() => (origin.value === 'admissions' ? '招生入學' : '參觀案件'))

function goBack() {
  if (origin.value === 'other') void router.push('/visit-requests')
  else router.back()
}

// 用 replace：一筆接一筆處理完，按返回直接回列表，不必一筆筆倒退。
// 從列表來的把列表條件一起帶到下一筆，下一筆的「下一筆」才會照同一份列表走。
function goNext() {
  if (!nextQueue.value) return
  const path = `/visit-requests/${nextQueue.value.id}`
  const list = route.query.list
  void router.replace(typeof list === 'string' && list ? { path, query: { list } } : path)
}

// 「下一筆」的請求序號：換案件就加一，舊案件較晚回來的清單不能蓋掉（案件本身的序號在 useVisitCase）。
let nextGeneration = 0
// 「下一筆」是同一個元件換 id，router 不會重新掛載；案件本身的重設與重讀在 useVisitCase。
watch(id, () => {
  nextGeneration += 1
  origin.value = readOrigin()
  nextQueue.value = null
})
</script>

<template>
  <div class="page detail">
    <div class="detail__nav">
      <el-button text :icon="ArrowLeft" class="detail__back" @click="goBack">{{ backLabel }}</el-button>
      <el-button v-if="nextQueue" text class="detail__next" :title="nextTitle" @click="goNext">
        {{ nextLabel }}<el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-skeleton v-else-if="loading" animated :rows="6" />

    <template v-else-if="detail">
      <VisitCaseHero />

      <div class="detail__grid">
        <div class="detail__main">
          <el-skeleton v-if="familyPending" animated :rows="6" class="detail__family-pending" />
          <template v-else>
          <FamilyAdmissionsData
            v-if="familyVisit"
            :visit="familyVisit"
            :options="familyOptions"
            :editable="canCreateAdmissions"
            @saved="family.replaceVisit"
            @stale="family.reload"
          />
          <div class="panel detail__data">
            <div class="panel__head">
              <h2>{{ bookingDataTitle }}</h2>
              <el-button
                v-if="familyVisit"
                link
                type="primary"
                :aria-expanded="bookingDataOpen ? 'true' : 'false'"
                aria-controls="visit-booking-data"
                @click="bookingDataOpen = !bookingDataOpen"
              >{{ bookingDataOpen ? '收起' : '展開' }}</el-button>
            </div>
            <el-descriptions v-show="!familyVisit || bookingDataOpen" id="visit-booking-data" :column="1" border label-width="128" class="detail__desc">
              <el-descriptions-item label="電話">
                <a :href="`tel:${detail.phone}`" class="num detail__link">{{ detail.phone }}</a>
              </el-descriptions-item>
              <el-descriptions-item label="孩子姓名">{{ detail.child_name || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="出生年月日">{{ detail.child_birthdate || '未填寫' }}</el-descriptions-item>
              <el-descriptions-item label="Email"><a v-if="detail.email" :href="`mailto:${detail.email}`" class="detail__link">{{ detail.email }}</a><span v-else>未填寫</span></el-descriptions-item>
              <!-- 官網 10-03 起不問參觀人數與想了解的事、10-02 起不用勾同意：只有舊案件與補登有值才列，
                   新案件不再固定出現「未填寫」「不需勾選同意」（官網沒有的欄位後台不列）。 -->
              <el-descriptions-item v-if="detail.party_size" label="參觀人數">{{ partySizeLabel(detail.party_size) }}</el-descriptions-item>
              <el-descriptions-item label="得知管道">{{ referralSourceLabels(detail.referral_sources) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.age" label="家長填的年齡">{{ ageLabel(detail.age) }}</el-descriptions-item>
              <!-- 家長自選場次之後不再問方便接電話時段，只有舊資料才有值。 -->
              <el-descriptions-item v-if="detail.preferred_time" label="方便接電話時段">{{ contactTimeLabel(detail.preferred_time) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.questions" label="想了解的事">
                <span class="detail__pre">{{ detail.questions }}</span>
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.consent_given" label="同意紀錄">{{ consentRecordLabel(detail) }}</el-descriptions-item>
              <el-descriptions-item v-if="confirmedAtShown" label="確認時間">{{ formatDateTime(detail.confirmed_at) }}</el-descriptions-item>
              <el-descriptions-item v-if="detail.cancelled_at" label="取消時間">{{ formatDateTime(detail.cancelled_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- 聯絡紀錄與案件歷程合成一條時間線（輸入框在最上；家庭版面沒有輸入框、再併入參觀後聯絡與招生事件）。
               聯絡紀錄每天都在用，排在很少用的家長管理連結前面；手機上再排到家長資料前面（見樣式）。 -->
          <VisitCaseTimeline />

          <ParentAccessLinkPanel
            v-if="linkApplicable"
            :visit-id="detail.id"
            :access-link="detail.access_link"
            :can-handle="canHandle"
            :status="detail.status"
            :email="detail.email ?? null"
            :email-enabled="emailEnabled"
            :deadline-hours="detail.parent_change_deadline_hours"
            @changed="refreshDetail"
          />
          </template>
        </div>

        <aside v-if="familyPending || familyVisit || (detail.status === 'confirmed' && canHandle)" class="detail__side">
          <div class="panel">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body detail__actions">
              <el-skeleton v-if="familyPending" animated :rows="3" />
              <FamilyActions
                v-else-if="familyVisit"
                :visit="familyVisit"
                :staff="familyStaff"
                :latest="latestFamilyContact"
                :rebookable="canHandle"
                :primary="false"
                @changed="onFamilyChanged"
                @stale="family.reload"
                @rebook="rebookOpen = true"
              />
              <template v-else-if="detail.status === 'confirmed' && canHandle">
                <div v-if="manualRescheduleShown" class="reschedule" role="group" aria-labelledby="visit-reschedule-title">
                  <p id="visit-reschedule-title" ref="rescheduleTitle" class="reschedule__title" tabindex="-1">改期（換場次）</p>
                  <el-select ref="rescheduleSelect" v-model="rescheduleSlotId" placeholder="選擇新的參觀場次" filterable :disabled="rescheduleSlots.length === 0" aria-label="改期的新場次" style="width: 100%">
                    <el-option-group v-for="group in groupSlotsByDay(rescheduleSlots)" :key="group.day" :label="group.label">
                      <el-option v-for="slot in group.slots" :key="slot.id" :label="slotLabel(slot)" :value="slot.id">{{ slotChoiceTime(slot) }}</el-option>
                    </el-option-group>
                  </el-select>
                  <p v-if="chosenSlotText(rescheduleSlots, rescheduleSlotId)" class="hint slot-chosen">已選：{{ chosenSlotText(rescheduleSlots, rescheduleSlotId) }}</p>
                  <p v-if="rescheduleSlots.length === 0" class="hint">
                    <template v-if="canManage">未來 60 天沒有其他可用場次。先到 <router-link to="/visit-calendar">參觀場次</router-link> 新增。</template>
                    <template v-else>未來 60 天沒有其他可用場次，請校區管理者到「參觀場次」新增。</template>
                  </p>
                  <el-input v-model="rescheduleReason" maxlength="500" placeholder="改期原因（選填）" aria-label="改期原因" />
                  <el-button :loading="pendingAction === 'reschedule'" :disabled="!rescheduleSlotId || busy" style="width: 100%; margin-left: 0" @click="reschedule">改到這一場</el-button>
                  <p class="hint">改好後原場次的名額會空出來；新場次剛好額滿的話不會改。</p>
                </div>
                <div v-else class="reschedule reschedule--collapsed">
                  <el-button link type="primary" class="reschedule__toggle" aria-expanded="false" @click="openManualReschedule">{{ detail.pending_reschedule ? '不照申請，改到其他場次…' : '改到其他場次…' }}</el-button>
                </div>
              </template>
            </div>
            <div
              v-if="canHandle && detail.status === 'confirmed'"
              class="detail__danger"
            >
              <span class="hint">{{ attendanceDue ? '家長沒來請用上方的「沒來」' : '家長不來了？' }}</span>
              <el-button text type="danger" :loading="pendingAction === 'cancel'" :disabled="busy" class="detail__cancel" @click="cancel">取消預約</el-button>
            </div>
          </div>
        </aside>
      </div>
      <ManualVisitDialog v-model="rebookOpen" :campus-keys="visibleCampusKeys" :related-from="detail" @created="onRebooked" />
      <!-- 一直掛著：RecordDialog 在打開的那一刻（open 變 true）才把 record 帶進表單。 -->
      <RecordDialog
        v-if="canCreateAdmissions"
        v-model="arrivalOpen"
        mode="edit"
        :campus-key="detail.campus_key"
        :record="admissionsVisit"
        :options="familyOptions"
        :lead="arrivalLead"
        :cancel-text="arrivalLead ? ARRIVAL_FORM_CANCEL_TEXT : undefined"
        @saved="family.replaceVisit"
        @stale="family.reload"
      />
    </template>
  </div>
</template>

<style scoped>
.detail__nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail__back {
  margin-left: -8px;
}

.detail__next {
  margin-right: -8px;
}

.detail__data .panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 取消預約與上方的處理區塊隔開一段，並用分隔線宣告它是另一類動作，減少誤觸。 */
.detail__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 24px 6px;
  border-top: 1px solid var(--line);
}

.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}

.detail__pre {
  white-space: pre-wrap;
}

/* 處理面板沒有內容時（結案、只能查看）整個 aside 不畫，主欄不留一條空的右欄。 */
.detail__grid:not(:has(> .detail__side)) {
  grid-template-columns: minmax(0, 1fr);
}

.reschedule {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.reschedule--collapsed {
  justify-items: start;
}

/* 處理面板第一個區塊上面不畫分隔線，免得標題下先出現一條空線。 */
.detail__actions > .reschedule:first-child {
  padding-top: 0;
  border-top: 0;
}

.slot-chosen {
  margin: -4px 0 0;
}

.reschedule__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink);
}

.detail__side {
  position: sticky;
  top: calc(var(--top-h) + 16px);
}

.detail__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail__cancel {
  margin-right: -8px;
}

/* 觸控裝置：電話、Email 連結放大到 44px 好點。 */
@media (hover: none), (pointer: coarse) {
  .detail__link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}

@media (max-width: 900px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail__side {
    position: static;
    order: -1;
  }

  /* 手機上打完電話接著就是記一筆：撥號鈕、處理面板之後先放聯絡紀錄，
     家長資料表排在後面。改成 flex 直排，兄弟間距統一用 gap，不靠 .panel + .section 的外距。 */
  .detail__main {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail__main > * {
    margin-top: 0;
  }

  .detail__notes {
    order: -1;
  }

  /* 下一筆的件數比較長，窄螢幕允許換行，不擠出畫面。 */
  .detail__next {
    min-width: 0;
    height: auto;
    white-space: normal;
    text-align: right;
  }
}

@media (max-width: 720px) {
  .detail__danger {
    padding: 10px 16px 6px;
  }
}
</style>
