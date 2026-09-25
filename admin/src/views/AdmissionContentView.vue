<script setup lang="ts">
import { onMounted } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { useTitleFontCoverage } from '../composables/useTitleFontCoverage'
import type { AdmissionContentPayload, AdmissionRefundPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { WEBSITE_ASSET_BASE } from '../config'

// 上限與後端 AdmissionContentPayload 相同（content/schemas.py）。
const MAX_STEPS = 10
const MAX_PHASES = 4
const MAX_DAYS = 7
const MAX_SUBSIDIES = 6
const MAX_ALLOWANCE = 6
const MAX_REFUNDS = 10
const MAX_GROUPS = 6

const EMPTY: AdmissionContentPayload = {
  notice: '', intro: '', steps: [], phases: [], uniform_week: [], uniform_note: '',
  pickup_notes: [], registration_notes: [], fee_intro: '', subsidies: [],
  allowance_title: '', allowance: [], allowance_note: '', refunds: [],
}

const editor = useContentItem<AdmissionContentPayload>('admission_content', EMPTY)
const missingGlyphs = useTitleFontCoverage()
const form = editor.form
// 草稿預覽讀的是最新「已儲存」的版本，未儲存的修改看不到。
const draftPreviewUrl = `${WEBSITE_ASSET_BASE}/preview?page=admission`

// 清單型文字（必備品、提醒、退費條文…）用「一行一項」編輯，空行由後端略過。
function toLines(list: string[]): string {
  return list.join('\n')
}
function fromLines(value: string): string[] {
  return value.split('\n')
}

function remove<T>(list: T[], index: number) {
  list.splice(index, 1)
}
function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item!)
}

function newRefund(): AdmissionRefundPayload {
  return { title: '', groups: [{ label: '', lines: [] }], note: '' }
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      官網「入學資訊」頁（/admission）的內容：入學流程、新生入園須知、補助與退費規定。
      各區大標與「分班對照」的計算規則固定在官網上，這裡不用填。
      <strong>金額與規定請先向各校確認再發布。</strong>
      儲存草稿後可以先<a :href="draftPreviewUrl" target="_blank" rel="noopener">開草稿預覽 ↗</a>看效果（只有登入的管理者看得到）。
    </template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="頁面提醒（顯示在頁面上方；清空就不顯示）">
        <el-input v-model="form.notice" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" placeholder="例如：金額與補助依各校公告及最新政策為準" />
      </el-form-item>
      <el-form-item label="頁首介紹（大圖上的一句話）">
        <el-input v-model="form.intro" />
      </el-form-item>

      <!-- 入學流程 -->
      <div class="section__title" style="margin-top: 20px">
        <h2>入學流程</h2>
        <span class="hint">{{ form.steps.length }} / {{ MAX_STEPS }} 步</span>
      </div>
      <el-button :icon="Plus" :disabled="form.steps.length >= MAX_STEPS" @click="form.steps.push({ when: '', title: '', text: '' })">新增一個步驟</el-button>
      <div v-for="(step, index) in form.steps" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ step.title || '未命名步驟' }}</span>
          <span>
            <el-button text size="small" :disabled="index === 0" @click="move(form.steps, index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === form.steps.length - 1" @click="move(form.steps, index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" :disabled="form.steps.length <= 1" @click="remove(form.steps, index)">移除</el-button>
          </span>
        </div>
        <div class="field-row">
          <el-form-item label="時間點">
            <el-input v-model="step.when" placeholder="例如：開學前約一個月" />
          </el-form-item>
          <el-form-item label="步驟名稱">
            <el-input v-model="step.title" />
            <p v-if="missingGlyphs(step.title).length" class="glyph-hint">
              官網標題字型沒有「{{ missingGlyphs(step.title).join('') }}」，這幾個字會以系統字顯示。
            </p>
          </el-form-item>
        </div>
        <el-form-item label="說明">
          <el-input v-model="step.text" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
        </el-form-item>
      </div>

      <!-- 新生入園須知 -->
      <div class="section__title" style="margin-top: 28px">
        <h2>新生入園須知</h2>
        <span class="hint">{{ form.phases.length }} / {{ MAX_PHASES }} 個階段</span>
      </div>
      <el-button :icon="Plus" :disabled="form.phases.length >= MAX_PHASES" @click="form.phases.push({ tag: '', title: '', items: [], tips: [] })">新增一個階段</el-button>
      <div v-for="(phase, index) in form.phases" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ phase.title || '未命名階段' }}</span>
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(form.phases, index)">移除</el-button>
        </div>
        <div class="field-row">
          <el-form-item label="小標">
            <el-input v-model="phase.tag" placeholder="例如：首部曲" />
          </el-form-item>
          <el-form-item label="階段名稱">
            <el-input v-model="phase.title" />
            <p v-if="missingGlyphs(phase.title).length" class="glyph-hint">
              官網標題字型沒有「{{ missingGlyphs(phase.title).join('') }}」，這幾個字會以系統字顯示。
            </p>
          </el-form-item>
        </div>
        <el-form-item label="寶貝必備品（一行一項）">
          <el-input :model-value="toLines(phase.items)" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" @update:model-value="phase.items = fromLines($event)" />
        </el-form-item>
        <el-form-item label="給家長的提醒（一行一條）">
          <el-input :model-value="toLines(phase.tips)" type="textarea" :autosize="{ minRows: 3, maxRows: 14 }" @update:model-value="phase.tips = fromLines($event)" />
        </el-form-item>
      </div>

      <h3 class="sub-title">每天穿什麼</h3>
      <el-form-item label="說明">
        <el-input v-model="form.uniform_note" placeholder="例如：制服與運動服於註冊後發放。" />
      </el-form-item>
      <div class="day-grid">
        <div v-for="(day, index) in form.uniform_week" :key="index" class="day-cell">
          <el-input v-model="day.day" size="small" placeholder="星期一" />
          <el-input v-model="day.wear" size="small" placeholder="制服" />
          <el-button text size="small" type="danger" :icon="Delete" aria-label="移除這一天" @click="remove(form.uniform_week, index)" />
        </div>
      </div>
      <el-button size="small" :icon="Plus" :disabled="form.uniform_week.length >= MAX_DAYS" @click="form.uniform_week.push({ day: '', wear: '' })">新增一天</el-button>
      <p class="hint">穿「運動服」的日子官網用淺綠底、「便服」用黃底標示。整週都刪掉的話，官網不顯示這張卡。</p>

      <div class="field-row" style="margin-top: 16px">
        <el-form-item label="接送安全（一行一段）">
          <el-input :model-value="toLines(form.pickup_notes)" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" @update:model-value="form.pickup_notes = fromLines($event)" />
        </el-form-item>
        <el-form-item label="註冊須知（一行一段）">
          <el-input :model-value="toLines(form.registration_notes)" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" @update:model-value="form.registration_notes = fromLines($event)" />
        </el-form-item>
      </div>

      <!-- 收退費辦法 -->
      <div class="section__title" style="margin-top: 28px">
        <h2>收退費辦法</h2>
      </div>
      <el-form-item label="說明（大標旁的一段話）">
        <el-input v-model="form.fee_intro" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" />
      </el-form-item>

      <h3 class="sub-title">補助 <span class="hint">{{ form.subsidies.length }} / {{ MAX_SUBSIDIES }}</span></h3>
      <div v-for="(s, index) in form.subsidies" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ s.who || '未命名補助' }}</span>
          <el-button text size="small" type="danger" :icon="Delete" @click="remove(form.subsidies, index)">移除</el-button>
        </div>
        <div class="field-row">
          <el-form-item label="對象"><el-input v-model="s.who" placeholder="例如：大班學費" /></el-form-item>
          <el-form-item label="金額"><el-input v-model="s.amount" placeholder="15,000" /></el-form-item>
          <el-form-item label="單位"><el-input v-model="s.unit" placeholder="元／學期" /></el-form-item>
        </div>
        <el-form-item label="補助單位與條件"><el-input v-model="s.by" placeholder="例如：教育部補助" /></el-form-item>
      </div>
      <el-button :icon="Plus" :disabled="form.subsidies.length >= MAX_SUBSIDIES" @click="form.subsidies.push({ amount: '', unit: '元／學期', who: '', by: '' })">新增一項補助</el-button>

      <h3 class="sub-title">育兒津貼</h3>
      <div class="field-row">
        <el-form-item label="標題"><el-input v-model="form.allowance_title" /></el-form-item>
        <el-form-item label="附註"><el-input v-model="form.allowance_note" placeholder="例如：不含公立、準公共、非營利幼兒園" /></el-form-item>
      </div>
      <div class="day-grid">
        <div v-for="(a, index) in form.allowance" :key="index" class="day-cell">
          <el-input v-model="a.order" size="small" placeholder="第 1 胎" />
          <el-input v-model="a.amount" size="small" placeholder="5,000（元／月）" />
          <el-button text size="small" type="danger" :icon="Delete" aria-label="移除這一列" @click="remove(form.allowance, index)" />
        </div>
      </div>
      <el-button size="small" :icon="Plus" :disabled="form.allowance.length >= MAX_ALLOWANCE" @click="form.allowance.push({ order: '', amount: '' })">新增一列</el-button>
      <p class="hint">金額單位固定顯示「元／月」。全部刪掉的話官網不顯示這一區。</p>

      <h3 class="sub-title">退費規定 <span class="hint">{{ form.refunds.length }} / {{ MAX_REFUNDS }} 種情況</span></h3>
      <div v-for="(refund, index) in form.refunds" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ refund.title || '未命名情況' }}</span>
          <span>
            <el-button text size="small" :disabled="index === 0" @click="move(form.refunds, index, -1)">上移</el-button>
            <el-button text size="small" :disabled="index === form.refunds.length - 1" @click="move(form.refunds, index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" @click="remove(form.refunds, index)">移除</el-button>
          </span>
        </div>
        <el-form-item label="情況（官網上可點開的那一列）">
          <el-input v-model="refund.title" placeholder="例如：幼兒中途入園" />
        </el-form-item>
        <div v-for="(group, g) in refund.groups" :key="g" class="refund-group">
          <div class="field-row">
            <el-form-item label="項目">
              <el-input v-model="group.label" placeholder="例如：學費及雜費" />
            </el-form-item>
            <el-button text size="small" type="danger" :icon="Delete" :disabled="refund.groups.length <= 1" style="align-self: end; margin-bottom: 18px" @click="remove(refund.groups, g)">移除這組</el-button>
          </div>
          <el-form-item label="規定（一行一條）">
            <el-input :model-value="toLines(group.lines)" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" @update:model-value="group.lines = fromLines($event)" />
          </el-form-item>
        </div>
        <el-button size="small" :icon="Plus" :disabled="refund.groups.length >= MAX_GROUPS" @click="refund.groups.push({ label: '', lines: [] })">新增一組項目</el-button>
        <el-form-item label="備註（選填）" style="margin-top: 12px">
          <el-input v-model="refund.note" />
        </el-form-item>
      </div>
      <el-button :icon="Plus" :disabled="form.refunds.length >= MAX_REFUNDS" @click="form.refunds.push(newRefund())">新增一種情況</el-button>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.sub-title {
  margin: 24px 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.day-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.day-cell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}

.refund-group {
  padding: 12px 0 0 12px;
  border-left: 2px solid var(--line);
  margin-bottom: 8px;
}

.glyph-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}
</style>
