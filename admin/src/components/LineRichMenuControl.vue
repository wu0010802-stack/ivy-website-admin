<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { notifyError } from '../composables/notify'
import { formatCount } from './analytics/format'
import { lineToolError, richMenuConfirmText, richMenuModeLabel, RICH_MENU_MODE_OPTIONS } from '../api/lineTools'
import type { LineAccountWithMenu, LineRichMenuInsightMenu, LineRichMenuInsightOut, LineRichMenuMode, LineSettingsOut } from '../api/types'

// 圖文選單（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4）：每個官方帳號三選一，
// 改選項前先講清楚後果；有選單時可以按了才查近 28 天的點擊。
const props = defineProps<{ account: LineAccountWithMenu; accountName: string }>()
const emit = defineEmits<{ updated: [settings: LineSettingsOut] }>()

const saving = ref(false)
// 按「先不要」後，原生的單選鈕已經停在被點的那顆；換 key 讓它重畫回目前的值。
const resetKey = ref(0)
const insight = ref<LineRichMenuInsightOut | null>(null)
const insightLoading = ref(false)
const insightError = ref<string | null>(null)

const menu = computed(() => props.account.rich_menu ?? null)
const currentValue = computed<'none' | LineRichMenuMode>(() => menu.value?.mode ?? 'none')

async function apply(mode: LineRichMenuMode | null, success: string) {
  saving.value = true
  try {
    const result = await api.put<LineSettingsOut>(`/admin/line/accounts/${encodeURIComponent(props.account.key)}/rich-menu`, { mode })
    emit('updated', result)
    insight.value = null
    insightError.value = null
    ElMessage.success(success)
  } catch (err) {
    notifyError(lineToolError(err, '更新失敗，請稍後再試'))
    resetKey.value += 1
  } finally {
    saving.value = false
  }
}

async function choose(value: string | number | boolean | undefined) {
  if (saving.value) return
  const mode = value === 'all' || value === 'booked' ? value : null
  if (mode === (menu.value?.mode ?? null)) return
  const text = richMenuConfirmText(mode)
  try {
    await ElMessageBox.confirm(text.body, text.title, {
      confirmButtonText: text.confirm,
      cancelButtonText: '先不要',
      type: 'warning',
      autofocus: false,
    })
  } catch {
    resetKey.value += 1
    return
  }
  await apply(mode, `${props.accountName}的圖文選單：${richMenuModeLabel(mode)}`)
}

function reapply() {
  if (saving.value || !menu.value) return Promise.resolve()
  return apply(menu.value.mode, `${props.accountName}的圖文選單已重新套用`)
}

async function loadInsight() {
  if (insightLoading.value) return
  insightLoading.value = true
  insightError.value = null
  try {
    insight.value = await api.get<LineRichMenuInsightOut>(`/admin/line/accounts/${encodeURIComponent(props.account.key)}/rich-menu/insight?days=28`)
  } catch (err) {
    insight.value = null
    insightError.value = lineToolError(err, '暫時查不到點擊統計，請稍後再試')
  } finally {
    insightLoading.value = false
  }
}

function menuKindLabel(kind: LineRichMenuInsightMenu['kind']): string {
  return kind === 'booked' ? '已預約家長的選單' : '所有好友的選單'
}

function menuLine(row: LineRichMenuInsightMenu): string {
  if (!row.available) return '點的人不到 20 位，或剛建好還沒有統計'
  const shown = `顯示 ${formatCount(row.impressions ?? 0)} 次（${formatCount(row.impression_users ?? 0)} 人）`
  const clicks = row.areas.map(area => `${area.label} ${formatCount(area.clicks)} 次`).join('，')
  return clicks ? `${shown}；點擊：${clicks}` : shown
}
</script>

<template>
  <div class="rich-menu" :data-test="`line-rich-menu-${account.key}`">
    <span :id="`rich-menu-label-${account.key}`" class="rich-menu__title">圖文選單</span>
    <el-radio-group
      :key="resetKey"
      :model-value="currentValue"
      :disabled="saving"
      :aria-labelledby="`rich-menu-label-${account.key}`"
      class="rich-menu__modes"
      @change="choose"
    >
      <el-radio v-for="option in RICH_MENU_MODE_OPTIONS" :key="option.value" :value="option.value" :data-test="`line-rich-menu-${account.key}-${option.value}`">{{ option.label }}</el-radio>
    </el-radio-group>

    <template v-if="menu">
      <div v-if="menu.outdated" class="rich-menu__outdated" data-test="line-rich-menu-outdated">
        <span>選單內容有更新（校區電話、地址或預約連結變了）</span>
        <el-button size="small" :loading="saving" :aria-label="`重新套用${accountName}的圖文選單`" data-test="line-rich-menu-reapply" @click="reapply">重新套用</el-button>
      </div>

      <div class="rich-menu__insight">
        <el-button size="small" :loading="insightLoading" :aria-label="`看${accountName}近 28 天的選單點擊`" data-test="line-rich-menu-insight-button" @click="loadInsight">看近 28 天點擊</el-button>
        <div role="status" aria-live="polite" class="rich-menu__insight-result">
          <p v-if="insightError" class="rich-menu__line is-bad" data-test="line-rich-menu-insight-error">{{ insightError }}</p>
          <template v-else-if="insight">
            <p v-if="insight.error_status !== null && insight.error_status !== undefined" class="rich-menu__line is-bad" data-test="line-rich-menu-insight-error">暫時查不到點擊統計，請稍後再試</p>
            <p v-else-if="!insight.menus.length" class="rich-menu__line">還沒有可以統計的選單</p>
            <template v-else>
              <p v-for="row in insight.menus" :key="row.kind" class="rich-menu__line" data-test="line-rich-menu-insight-row">
                <strong>{{ menuKindLabel(row.kind) }}</strong>：{{ menuLine(row) }}
              </p>
            </template>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rich-menu {
  display: grid;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--line);
}

.rich-menu__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink-2);
}

.rich-menu__modes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
}

.rich-menu__outdated {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  font-size: var(--text-sm);
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.rich-menu__insight {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
}

.rich-menu__insight-result {
  flex: 1 1 240px;
  min-width: 0;
}

.rich-menu__line {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-2);
  overflow-wrap: anywhere;
}

.rich-menu__line + .rich-menu__line {
  margin-top: 2px;
}

.rich-menu__line.is-bad {
  color: var(--brand-gold-ink);
  font-weight: 600;
}
</style>
