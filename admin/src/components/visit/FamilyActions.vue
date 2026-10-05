<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { updateFollowUp } from '../../api/admissions'
import { apiErrorMessage, isVersionConflict } from '../../api/errors'
import type { AdmissionsStaff, ContactLog, RecruitmentVisit } from '../../api/types'
import { STAGE_LABELS, isStage, moveTargets, stageMeta, type Stage, type TransitionTarget } from '../../admissions/constants'
import { followUpText, isDue, isOpenStage, lastContactText, ownerLabel } from '../../admissions/followUp'
import { notifyError, notifyWarning } from '../../composables/notify'
import { usePermissions } from '../../composables/usePermissions'
import StatusTag from '../StatusTag.vue'
import ContactLogDialog, { type ContactTarget } from '../admissions/ContactLogDialog.vue'
import FollowUpDialog, { type FollowUpTarget } from '../admissions/FollowUpDialog.vue'
import TransitionDialog from '../admissions/TransitionDialog.vue'

// 預約明細家庭版面的處理區（2026-10-05 家庭頁規格 5.6）：招生階段、下次聯絡、最近聯絡；
// 記錄聯絡／排下次聯絡／移到…（同看板與歷程抽屜的對話框與權限）；招生負責人；重新預約。
const props = defineProps<{ visit: RecruitmentVisit; staff: readonly AdmissionsStaff[]; latest: ContactLog | null; rebookable: boolean }>()
const emit = defineEmits<{ changed: [visit: RecruitmentVisit]; stale: []; rebook: [] }>()

const { can } = usePermissions()
const editable = computed(() => !props.visit.anonymized_at && can('admissions.write'))
const tracking = computed(() => isOpenStage(props.visit.stage))
const ownerEditable = computed(() => editable.value && tracking.value)
const moveOptions = computed<Stage[]>(() =>
  props.visit.anonymized_at || !isStage(props.visit.stage) ? [] : moveTargets(props.visit.stage, can),
)
// ownerLabel 的參數型別是可變陣列，這裡複製一份給它。
const staffList = computed(() => [...props.staff])
// 名單還沒讀到（空的）時不能判定負責人已停用。
const ownerUnresolved = computed(() => Boolean(props.visit.follow_up_owner_id) && props.staff.length === 0)
const ownerMissing = computed(() => Boolean(props.visit.follow_up_owner_id) && !props.staff.some((person) => person.id === props.visit.follow_up_owner_id))

// ---- 記錄聯絡、排下次聯絡、移到… ----
const contactOpen = ref(false)
const contactTarget = ref<ContactTarget | null>(null)
const followUpOpen = ref(false)
const followUpTarget = ref<FollowUpTarget | null>(null)
const transitionOpen = ref(false)
const transitionTarget = ref<TransitionTarget | null>(null)

function openContact() {
  const v = props.visit
  contactTarget.value = { id: v.id, version: v.version, child_name: v.child_name, stage: v.stage, grade: v.grade, contact_name: v.contact_name, phone: v.phone }
  contactOpen.value = true
}

function openFollowUp() {
  const v = props.visit
  followUpTarget.value = { id: v.id, version: v.version, child_name: v.child_name, stage: v.stage, follow_up_at: v.follow_up_at ?? null, follow_up_owner_id: v.follow_up_owner_id ?? null }
  followUpOpen.value = true
}

function openTransition(to: Stage) {
  const v = props.visit
  if (!isStage(v.stage)) return
  transitionTarget.value = { card: v, from: v.stage, to }
  transitionOpen.value = true
}

// 對話框遇到 409 時父層重讀；還開著的記錄聯絡對話框換成新版本（內容保留，同歷程抽屜）。
watch(() => props.visit, (v) => {
  if (contactOpen.value && contactTarget.value?.id === v.id) contactTarget.value = { ...contactTarget.value, version: v.version, stage: v.stage }
})

// ---- 招生負責人（只改負責人，下次聯絡不動）----
const savingOwner = ref(false)
async function setOwner(ownerId: string | null) {
  if (savingOwner.value || ownerId === (props.visit.follow_up_owner_id ?? null)) return
  savingOwner.value = true
  try {
    emit('changed', await updateFollowUp(props.visit.id, { expected_version: props.visit.version, follow_up_owner_id: ownerId }))
  } catch (err) {
    if (isVersionConflict(err)) {
      notifyWarning('這筆招生訪視剛被其他人修改，已載入最新的內容，請確認後再改負責人')
      emit('stale')
    } else {
      notifyError(apiErrorMessage(err, '改負責人失敗'))
    }
  } finally {
    savingOwner.value = false
  }
}
</script>

<template>
  <div class="family-actions">
    <dl class="family-actions__facts">
      <div><dt>招生階段</dt><dd><StatusTag :meta="stageMeta(visit)" /></dd></div>
      <div>
        <dt>下次聯絡</dt>
        <dd class="num family-actions__next" :class="{ 'is-due': tracking && isDue(visit.follow_up_at) }">{{ tracking ? followUpText(visit.follow_up_at) : '—' }}</dd>
      </div>
      <div>
        <dt>最近聯絡</dt>
        <dd class="num">{{ latest ? lastContactText(latest.contacted_at, latest.channel, latest.reached) : lastContactText(visit.last_contacted_at ?? null) }}</dd>
      </div>
    </dl>
    <el-button v-if="editable" type="primary" class="family-actions__record" @click="openContact">記錄聯絡</el-button>
    <div v-if="(editable && tracking) || moveOptions.length" class="family-actions__row">
      <el-button v-if="editable && tracking" @click="openFollowUp">{{ visit.follow_up_at ? '改期／負責人' : '排下次聯絡' }}</el-button>
      <el-dropdown v-if="moveOptions.length" trigger="click" :persistent="false" popper-class="family-move-menu" @command="(to: Stage) => openTransition(to)">
        <el-button class="family-actions__move">移到…<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="to in moveOptions" :key="to" :command="to">{{ STAGE_LABELS[to] }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div class="family-actions__owner">
      <label v-if="ownerEditable" for="family-owner">負責人</label>
      <span v-else class="family-actions__owner-label">負責人</span>
      <el-select
        v-if="ownerEditable"
        id="family-owner"
        :model-value="visit.follow_up_owner_id ?? ''"
        :loading="savingOwner"
        :disabled="savingOwner"
        placeholder="未指派"
        clearable
        style="width: 100%"
        @change="(value: string) => setOwner(value || null)"
      >
        <el-option v-if="ownerMissing" :value="visit.follow_up_owner_id!" :label="ownerLabel(visit.follow_up_owner_id, staffList)" disabled />
        <el-option v-for="person in staff" :key="person.id" :value="person.id" :label="person.display_name || person.email" />
      </el-select>
      <span v-else>{{ ownerUnresolved ? '—' : ownerLabel(visit.follow_up_owner_id, staffList) }}</span>
    </div>
    <div v-if="rebookable" class="family-actions__rebook">
      <span class="hint">家長想再約別的時間？</span>
      <el-button link type="primary" @click="emit('rebook')">重新預約（另建新案）</el-button>
    </div>

    <ContactLogDialog v-model="contactOpen" :target="contactTarget" @saved="(saved: RecruitmentVisit) => emit('changed', saved)" @stale="emit('stale')" />
    <FollowUpDialog v-model="followUpOpen" :target="followUpTarget" :campus-key="visit.campus_key" @saved="(saved: RecruitmentVisit) => emit('changed', saved)" @stale="emit('stale')" />
    <TransitionDialog v-model="transitionOpen" :target="transitionTarget" @done="(done: RecruitmentVisit) => emit('changed', done)" @stale="emit('stale')" />
  </div>
</template>

<style scoped>
.family-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.family-actions__facts {
  display: grid;
  gap: 6px;
  margin: 0;
  font-size: var(--text-sm);
}

.family-actions__facts > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.family-actions__facts dt {
  color: var(--ink-3);
}

.family-actions__facts dd {
  margin: 0;
  color: var(--ink);
}

.family-actions__facts .is-due {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}

.family-actions__record {
  width: 100%;
}

.family-actions__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 8px;
}

.family-actions__row .el-button,
.family-actions__row .el-dropdown,
.family-actions__row .family-actions__move {
  width: 100%;
  margin-left: 0;
}

.family-actions__owner,
.family-actions__rebook {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
}

.family-actions__owner label,
.family-actions__owner-label {
  color: var(--ink-2);
}

.family-actions__rebook .el-button {
  align-self: flex-start;
}
</style>
