<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { campusLabel, VISIT_VIEW_LABELS, type VisitView } from '../api/labels'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { provideVisitCase, useVisitCase } from '../composables/useVisitCase'
import { detailOrigin } from '../admissions/family'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import VisitCaseDialogs from '../components/visit/VisitCaseDialogs.vue'
import VisitCaseFacts from '../components/visit/VisitCaseFacts.vue'
import VisitCaseHero from '../components/visit/VisitCaseHero.vue'
import VisitCaseSettings from '../components/visit/VisitCaseSettings.vue'
import VisitCaseTimeline from '../components/visit/VisitCaseTimeline.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

// 案件明細（2026-10-06 方向 C）：頁首（VisitCaseHero）、主欄（招生資料、時間線）、右欄（處理區、家長資料、
// 設定列），兩個對話框在最後。案件的資料層與動作在 composables/useVisitCase.ts，子元件用 inject 取同一份，
// 列表右側的預覽面板也用它們。這一頁只管組版、返回、下一筆與離頁保護。
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
  detail, rebookOpen, canHandle, canCreateAdmissions, familyOptions, familyStaff, familyVisit, familyPending,
  noteDirty, busy, latestFamilyContact, loading, error,
} = toRefs(vc)
const { onFamilyChanged } = vc
const family = vc.family

// 打好還沒按「新增紀錄」的聯絡紀錄（noteDirty，定義見 useVisitCase）：返回、下一筆、側欄換頁前都先問。
const { confirmLeave } = useUnsavedChanges(noteDirty, busy)
// 「下一筆」只換 :id，不會觸發離頁守衛，要另外攔。
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? confirmLeave() : true))

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
const LIST_KEYS = ['campus_key', 'group', 'view', 'status', 'open', 'q', 'follow_up_due', 'source', 'created_from', 'created_to', 'needs_attention', 'order', 'page', 'page_size']
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
// 從列表來時寫出是哪個頁籤（2026-10-06 方向 B：「‹ 參觀案件（接下來）」）；「全部」頁籤沒有 view，只寫「參觀案件」。
const listTabLabel = computed(() => {
  const raw = route.query.list
  if (origin.value !== 'visit-list' || typeof raw !== 'string') return ''
  const view = new URLSearchParams(raw).get('view')
  return view && Object.hasOwn(VISIT_VIEW_LABELS, view) ? VISIT_VIEW_LABELS[view as VisitView] : ''
})
const backLabel = computed(() => (origin.value === 'admissions' ? '招生入學' : listTabLabel.value ? `參觀案件（${listTabLabel.value}）` : '參觀案件'))

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
              class="detail__family-data"
              :visit="familyVisit"
              :options="familyOptions"
              :editable="canCreateAdmissions"
              @saved="family.replaceVisit"
              @stale="family.reload"
            />
            <!-- 聯絡紀錄與案件歷程合成一條時間線（輸入框在最上；家庭版面沒有輸入框、再併入參觀後聯絡與招生事件）。 -->
            <VisitCaseTimeline />
          </template>
        </div>

        <div class="detail__side">
          <section v-if="familyVisit" class="panel detail__family-actions">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body">
              <FamilyActions
                :visit="familyVisit"
                :staff="familyStaff"
                :latest="latestFamilyContact"
                :rebookable="canHandle"
                :primary="false"
                @changed="onFamilyChanged"
                @stale="family.reload"
                @rebook="rebookOpen = true"
              />
            </div>
          </section>
          <VisitCaseFacts v-if="!familyPending" />
          <VisitCaseSettings />
        </div>
      </div>

      <VisitCaseDialogs />
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

/* 兩欄（2026-10-06 方向 C）：主欄是招生資料與時間線，右欄是處理區、家長資料、設定列。
   右欄不 sticky：設定列比畫面高時，最底的取消預約會被卡住看不到。 */
.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
}

.detail__main,
.detail__side {
  display: grid;
  gap: 20px;
  min-width: 0;
}

/* 面板之間的間距只由 grid 的 gap 決定，不再疊上 .panel + .panel 的外距。 */
.detail__main > .panel,
.detail__side > .panel {
  margin-top: 0;
}

/* 1100px 以下一欄：處理區 → 招生資料 → 時間線 → 家長資料 → 設定列。兩欄的外框拆掉
   （display: contents），子元素直接排進 grid 才能交錯排序。 */
@media (max-width: 1100px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }

  .detail__main,
  .detail__side {
    display: contents;
  }

  .detail__family-actions {
    order: 1;
  }

  .detail__family-data {
    order: 2;
  }

  .detail__notes {
    order: 3;
  }

  .case-facts {
    order: 4;
  }

  .case-settings {
    order: 5;
  }
}

@media (max-width: 900px) {
  /* 下一筆的件數比較長，窄螢幕允許換行，不擠出畫面。 */
  .detail__next {
    min-width: 0;
    height: auto;
    white-space: normal;
    text-align: right;
  }
}
</style>
