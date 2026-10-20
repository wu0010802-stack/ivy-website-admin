<script setup lang="ts">
import { computed, useId } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type {
  AdmissionsArea, AreaDistrictRow, AreaEnrolled, AreaOpportunity, AreaPeerFees, AreaPresale, AreaTrends, AreaVillageRow,
  VillageBoundaries,
} from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { areaQuery } from '../../../admissions/areaFilter'
import { AREA_TABLE_TABS, type AreaTableTab } from '../../../admissions/areaView'
import AreaVillageTable from './AreaVillageTable.vue'
import BirthSeries from './BirthSeries.vue'
import EnrolledPanel from './EnrolledPanel.vue'
import PeerFeesPanel from './PeerFeesPanel.vue'
import PresalePanel from './PresalePanel.vue'
import SchoolDistrictPanel from './SchoolDistrictPanel.vue'
import { bandLabel, campusNotLocatedReason, presaleListNote, trendsUnavailable, type GradeFilter } from './areaFormat'
import { addressSummary } from './areaPane'
import type { PeerAge } from './peerFeesFormat'
import { villageTableRows } from './villageTable'

// 地圖下方的「完整表格」（2026-10-16 區域分析工作台規格 §2.7）：七個分頁一次只畫一頁（v-if，換頁不重抓資料，
// 資料都由 AreaTab 保管）。各里、預售建案（2026-10-20）、國小學區、在籍學生、同業收費、出生走勢沿用現有面板；參觀來源是原本頁底的三張表
// （行政區排行、里排行、距離分布）。標籤後的數字資料還沒回來就不帶（不寫 0）。
const props = defineProps<{
  tab: AreaTableTab
  area: AdmissionsArea
  trends: AreaTrends | null
  trendsFailed: boolean
  opportunity: AreaOpportunity | null
  opportunityFailed: boolean
  enrolled: AreaEnrolled | null
  enrolledFailed: boolean
  gradeFilter: GradeFilter
  peerFees: AreaPeerFees | null
  peerFeesFailed: boolean
  presale: AreaPresale | null
  presaleFailed: boolean
  peerAge: PeerAge
  csvName: (title: string) => string
  /** 還沒有招生訪視時，參觀來源那一頁寫的句子（D14）。 */
  emptyText: string
  /** 合併組的里挑選取地圖用的代碼時要對照里界檔（見 AreaVillageTable）。 */
  boundaries?: VillageBoundaries | null
}>()
const emit = defineEmits<{
  'update:tab': [tab: AreaTableTab]
  'update:peerAge': [age: PeerAge]
  'select-village': [code: string]
  'open-records': [filter: { area: string }]
  retry: [source: 'trends' | 'opportunity' | 'enrolled' | 'peerFees' | 'presale']
}>()

const headingId = useId()

// ---- 頁籤與數字 ----

const villageRows = computed(() => villageTableRows(props.trends, props.opportunity, props.enrolled, props.boundaries ?? null))
// 各里表兩份資料任何一份還在讀就是骨架（見 AreaVillageTable），數字也等兩份都到；讀取失敗的那份不等，兩份都失敗沒有列。
const villageWaiting = computed(() => (!props.trends && !props.trendsFailed) || (!props.opportunity && !props.opportunityFailed))
const villageCount = computed(() => (villageWaiting.value || (!props.trends && !props.opportunity) ? null : villageRows.value.length))
// 預售建案沒匯入或本校沒座標時清單是空的，頁籤不帶數字（不寫 0，像是附近真的沒有）。
const presaleUnavailable = computed(() => (props.presale ? presaleListNote(props.presale) !== '' : false))
const tabs = computed<{ name: AreaTableTab; label: string; count: number | null }[]>(() => [
  { name: 'village', label: '各里', count: villageCount.value },
  { name: 'presale', label: '預售建案', count: props.presale && !presaleUnavailable.value ? props.presale.summary.cases : null },
  { name: 'school', label: '國小學區', count: props.trends ? props.trends.schools.length : null },
  { name: 'enrolled', label: '在籍學生', count: props.enrolled?.status === 'ready' ? props.enrolled.total : null },
  {
    name: 'fees', label: '同業收費',
    count: props.peerFees ? props.peerFees.schools.filter((school) => school.semester_total !== null).length : null,
  },
  { name: 'births', label: '出生走勢', count: null },
  { name: 'visits', label: '參觀來源', count: props.area.totals.with_address },
])

// el-tabs 回報的是 string | number：只收認得的分頁值。
function setTab(name: string | number) {
  const next = AREA_TABLE_TABS.find((tab) => tab === name)
  if (next) emit('update:tab', next)
}

// ---- 出生走勢 ----

const birthPeriods = computed(() => props.trends?.baseline?.births_series ?? [])
const radiusKm = computed(() => props.trends?.radius_km ?? 3)
// 沒有期別可畫時依原因寫，不能一律說「沒有里的資料」（各里頁籤明明列著里）：整塊用不了寫 trendsUnavailable 的原因；
// 有期別就畫；出生資料沒匯入；範圍內沒有里（沿用「里的變化」的無資料句）；其餘是每一期都不到最少月數。
const birthsEmptyText = computed(() => {
  const trends = props.trends
  if (!trends) return ''
  const unavailable = trendsUnavailable(trends)
  if (unavailable) return unavailable
  if (birthPeriods.value.length) return ''
  if (trends.sources.births.latest === null) return '各里出生資料尚未匯入。'
  if (trends.villages.length === 0) return `本校 ${radiusKm.value} 公里內沒有里的資料。`
  return '出生資料的月份還不夠一期，先不列近幾年的出生數。'
})

// ---- 參觀來源 ----

const placeColumns = (label: string): StatsColumn[] => [
  { key: 'place', label, sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]
const DISTRICT_COLUMNS = placeColumns('行政區')
const VILLAGE_COLUMNS = placeColumns('里')
const DISTANCE_COLUMNS: StatsColumn[] = [
  { key: 'band_label', label: '距本校', sticky: true },
  { key: 'visit', label: '參觀人數', kind: 'bar' },
  { key: 'deposit', label: '預繳人數', kind: 'count' },
  { key: 'visit_to_deposit_rate', label: '預繳率', kind: 'rate' },
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
]

const districtRows = computed(() => props.area.districts.map((row) => ({ ...row, place: row.district })))
// 依參觀人數多到少；同數保留後端的順序（Array.sort 是穩定排序）。
const visitVillageRows = computed(() =>
  [...props.area.villages]
    .sort((a, b) => b.visit - a.visit)
    .map((row) => ({ ...row, place: `${row.district}${row.village}`, key: `${row.district}/${row.village}` })),
)
// 後端以本校有沒有座標決定距離分組（沒有座標時全歸「無距離」），這裡跟著同一個判準。
const campusLocated = computed(() => props.area.campus.lat != null && props.area.campus.lng != null)
const distanceRows = computed(() =>
  campusLocated.value ? props.area.distance_bands.map((row) => ({ ...row, band_label: bandLabel(row.band) })) : [],
)
const distanceEmptyText = computed(
  () => `${campusNotLocatedReason(props.area.campus.locate_error ?? null) ?? '本校位置尚未確定'}，無法計算距離。`,
)
// 有訪視、但沒有任何可比對的地址（沒填或已依保存期限清除）：三張表全是 0 只會誤導，改寫原因（同頁尾那句）。
const noAddressText = computed(() => addressSummary(props.area).noAddress)

// StatsDimensionTable 是泛型：action 回傳的就是 rows 那一列的型別（後端列型別加上畫面用的欄位），不需要轉型。
function openDistrict({ district }: AreaDistrictRow) {
  emit('open-records', { area: areaQuery({ kind: 'place', district, village: null }) })
}
function openVillage({ district, village }: AreaVillageRow) {
  emit('open-records', { area: areaQuery({ kind: 'place', district, village }) })
}
</script>

<template>
  <section class="area-full-tables" :aria-labelledby="headingId">
    <h2 :id="headingId" class="area-full-tables__title">完整表格</h2>
    <el-tabs :model-value="tab" class="area-full-tables__tabs" @update:model-value="setTab">
      <el-tab-pane v-for="item in tabs" :key="item.name" :name="item.name">
        <template #label>
          <span>{{ item.label }}</span>
          <span v-if="item.count !== null" class="area-full-tables__count">{{ item.count }}</span>
        </template>

        <!-- 只畫目前那一頁：其他頁的面板不掛（el-tab-pane 的外框留著，aria-controls 才接得上）。 -->
        <template v-if="item.name === tab">
          <AreaVillageTable
            v-if="tab === 'village'"
            :trends="trends"
            :trends-failed="trendsFailed"
            :opportunity="opportunity"
            :opportunity-failed="opportunityFailed"
            :enrolled="enrolled"
            :boundaries="boundaries"
            :csv-name="csvName"
            @select-village="emit('select-village', $event)"
            @retry-trends="emit('retry', 'trends')"
            @retry-opportunity="emit('retry', 'opportunity')"
          />

          <PresalePanel
            v-else-if="tab === 'presale'"
            :data="presale"
            :failed="presaleFailed"
            :csv-name="csvName"
            @retry="emit('retry', 'presale')"
            @select-village="emit('select-village', $event)"
          />

          <!-- 國小學區與出生走勢共用「里的變化」那一份資料：讀取失敗的句子與重試在這裡寫一次（面板自己不重複）。 -->
          <template v-else-if="tab === 'school' || tab === 'births'">
            <el-alert v-if="trendsFailed" class="trends-error" type="error" :closable="false" show-icon title="無法讀取里的變化，請重新載入。">
              <el-button size="small" @click="emit('retry', 'trends')">重新載入</el-button>
            </el-alert>
            <el-skeleton v-else-if="!trends" :rows="4" animated />
            <SchoolDistrictPanel v-else-if="tab === 'school'" :data="trends" :failed="false" :csv-name="csvName" />
            <template v-else>
              <p v-if="birthsEmptyText" class="empty-note">{{ birthsEmptyText }}</p>
              <BirthSeries v-else :periods="birthPeriods" :radius-km="radiusKm" :csv-name="csvName('近幾年的出生數')" />
            </template>
          </template>

          <template v-else-if="tab === 'enrolled'">
            <p v-if="enrolled?.status === 'not_imported'" class="empty-note">尚未匯入在籍名冊。</p>
            <el-skeleton v-else-if="!enrolled && !enrolledFailed" :rows="4" animated />
            <EnrolledPanel
              v-else
              :data="enrolled"
              :failed="enrolledFailed"
              :grade-filter="gradeFilter"
              :csv-name="csvName"
              @retry="emit('retry', 'enrolled')"
            />
          </template>

          <PeerFeesPanel
            v-else-if="tab === 'fees'"
            :age="peerAge"
            :data="peerFees"
            :failed="peerFeesFailed"
            :csv-name="csvName"
            @update:age="emit('update:peerAge', $event)"
            @retry="emit('retry', 'peerFees')"
          />

          <template v-else>
            <p v-if="area.totals.visit === 0" class="empty-note">{{ emptyText }}</p>
            <p v-else-if="noAddressText" class="empty-note">{{ noAddressText }}</p>
            <div v-else class="area-full-tables__visits">
              <StatsDimensionTable
                title="行政區排行"
                :rows="districtRows"
                :columns="DISTRICT_COLUMNS"
                row-key="district"
                numbered
                empty-text="這個範圍還沒有比對到行政區的地址"
                :export-filename="csvName('行政區排行')"
                action-label="查看明細"
                @action="openDistrict"
              />
              <StatsDimensionTable
                title="里排行"
                :rows="visitVillageRows"
                :columns="VILLAGE_COLUMNS"
                row-key="key"
                numbered
                empty-text="這個範圍還沒有定位到里的地址"
                caption="里以門牌資料為準；只到區、未定位的訪視不在這張表。"
                :export-filename="csvName('里排行')"
                action-label="查看明細"
                @action="openVillage"
              />
              <!-- 距離分布沒有對應的明細篩選，不給「查看明細」（R13）。 -->
              <StatsDimensionTable
                title="距離分布"
                :rows="distanceRows"
                :columns="DISTANCE_COLUMNS"
                row-key="band"
                :empty-text="distanceEmptyText"
                :caption="campusLocated ? '從家長地址的門牌量到本校的直線距離；沒填地址、只到區、未定位的訪視算在「無距離」。' : ''"
                :export-filename="csvName('距離分布')"
              />
            </div>
          </template>
        </template>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.area-full-tables {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.area-full-tables__title {
  font-size: var(--text-xl);
  line-height: 1.35;
}

.area-full-tables__tabs {
  min-width: 0;
}

/* 標籤後的數字比標籤淡一階；和標籤之間的空隙用邊距，不靠空白字元（標籤文字才是「各里3」連著讀）。 */
.area-full-tables__count {
  margin-inline-start: 6px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

/* 一欄至少 36rem：里排行加上「可能範圍」與「查看明細」欄 1440 實測約 562px（2026-10-12），窄過這個寬度寧可換列、不要把欄擠出表框。
   1440 螢幕（側欄之外約 1124px）放不下兩欄，三張表各占一列；更寬的螢幕才兩張並排。min(100%, …) 讓窄螢幕自然變單欄，
   表格在自己的框內橫捲。 */
.area-full-tables__visits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 36rem), 1fr));
  gap: 24px;
  min-width: 0;
}
</style>
