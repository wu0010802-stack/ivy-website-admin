<script setup lang="ts">
import { computed } from 'vue'
import type { GapBlock, Roster } from '../../../api/roster'
import { GRADE_ORDER, gapText, monthDayText, tierText } from '../../../admissions/roster'

// 缺額統計（2026-11-15，規格 §6.3、§8.3）：兩個區塊由上往下加總，數字全由後端算好，前端只負責寫出來。
// Y(下) 的年級目標是各班目標加總（唯讀）；(Y+1)(上) 的年級目標與兩區塊的三段目標是可以直接改的格子，失焦時才送出。
const props = defineProps<{ roster: Roster; canWrite: boolean }>()
const emit = defineEmits<{
  'change-as-of': [date: string]
  'save-next-target': [grade: string, value: number | null]
  'save-tier': [block: 'current' | 'next', tiers: { base: number | null; boost: number | null; top: number | null }]
  snapshot: []
}>()

type RowSpec = { key: string; sign: string; label: string; result?: boolean; negative?: boolean }

const year = computed(() => props.roster.school_year)
const past = computed(() => props.roster.as_of !== props.roster.today)
const asOfText = computed(() => monthDayText(props.roster.as_of))
const minDate = computed(() => `${year.value + 1911}-08-01`)
// 最晚能選的統計日期：今天，但不超過學年最後一天；還沒開學的學年只能選開學日（後端 as_of_window 同一套）。
const latest = computed(() => {
  const end = `${year.value + 1912}-07-31`
  const capped = props.roster.today < end ? props.roster.today : end
  return capped > minDate.value ? capped : minDate.value
})
const latestLabel = computed(() => (latest.value === props.roster.today ? '今天' : latest.value === minDate.value ? '開學日' : '學年最後一天'))
const showSept = computed(() => props.roster.today >= `${year.value + 1911}-09-15`)
const showMarch = computed(() => props.roster.today >= `${year.value + 1912}-03-15`)

const currentRows = computed<RowSpec[]>(() => [
  { key: 'enrolled', sign: '', label: `${past.value ? '在籍' : '目前在籍'}（截至 ${asOfText.value}）` },
  { key: 'pending_s1', sign: '＋', label: '預繳生：12–1月入園' },
  { key: 'pending_s2', sign: '＋', label: '預繳生：2–7月入園' },
  { key: 'estimate', sign: '＝', label: `${year.value}(下) 預估人數`, result: true },
])
const nextRows = computed<RowSpec[]>(() => [
  { key: 'promoted', sign: '', label: '舊生升班（含 12–7月入園預繳生）' },
  { key: 'leaving', sign: '－', label: '舊生下學年不讀', negative: true },
  { key: 'repeating', sign: '＋', label: '大班重讀' },
  { key: 'pending_next', sign: '＋', label: `預繳生：${year.value + 1}/8月入園` },
  { key: 'estimate_next', sign: '＝', label: `${year.value + 1}(上) 預估人數`, result: true },
])

const cellOf = (block: GapBlock, key: string, grade: string) => block.rows[key]?.[grade] ?? 0
const numText = (value: number, negative = false) => (value ? `${negative ? '−' : ''}${value}` : String(value))
const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`)

const parse = (event: Event): number | null => {
  const raw = (event.target as HTMLInputElement).value.trim()
  return raw === '' ? null : Math.max(0, Math.trunc(Number(raw)))
}
function changeTier(block: 'current' | 'next', key: 'base' | 'boost' | 'top', event: Event) {
  const tier = block === 'current' ? props.roster.current.tier : props.roster.next.tier
  emit('save-tier', block, { base: tier.base, boost: tier.boost, top: tier.top, [key]: parse(event) })
}
function changeDate(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (value) emit('change-as-of', value)
}

const TIERS = [['base', '基礎'], ['boost', '激勵'], ['top', '超越']] as const
</script>

<template>
  <div class="roster-gap">
    <div class="roster-asof">
      <label>統計日期
        <input type="date" :value="roster.as_of" :min="minDate" :max="latest" @change="changeDate" />
      </label>
      <button type="button" @click="emit('change-as-of', latest)">{{ latestLabel }}</button>
      <button v-if="showSept" type="button" @click="emit('change-as-of', `${year + 1911}-09-15`)">9/15 結算日</button>
      <button v-if="showMarch" type="button" @click="emit('change-as-of', `${year + 1912}-03-15`)">3/15 結算日</button>
      <button v-if="canWrite" type="button" class="roster-asof__save" @click="emit('snapshot')">存成結算紀錄</button>
    </div>

    <div class="roster-gap__scroll">
      <table>
        <thead>
          <tr>
            <th class="roster-sg"></th>
            <th scope="col" class="roster-gap__item">項目</th>
            <th v-for="grade in GRADE_ORDER" :key="grade" scope="col">{{ grade }}</th>
            <th scope="col">合計</th>
          </tr>
        </thead>
        <tbody>
          <!-- Y(下)：這學期 -->
          <tr class="roster-blk"><td colspan="7"><b>{{ year }}(下)</b><span>這學期的預估人數（班別＝現在就讀的班級）</span></td></tr>
          <tr v-for="row in currentRows" :key="row.key" :class="{ 'is-result': row.result }">
            <td class="roster-sg">{{ row.sign }}</td>
            <th scope="row">{{ row.label }}</th>
            <td v-for="grade in GRADE_ORDER" :key="grade">{{ numText(cellOf(roster.current, row.key, grade)) }}</td>
            <td class="is-total">{{ numText(cellOf(roster.current, row.key, 'total')) }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">目標人數<small>各班目標加總</small></th>
            <td v-for="grade in GRADE_ORDER" :key="grade">
              <template v-if="roster.current.targets[grade] === null || roster.current.targets[grade] === undefined"><span class="roster-muted">未設定</span></template>
              <template v-else>{{ roster.current.targets[grade] }}</template>
            </td>
            <td class="is-total">{{ roster.current.targets.total ?? '—' }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">達成率（預估÷目標）</th>
            <td v-for="grade in GRADE_ORDER" :key="grade">{{ percent(roster.current.achievement[grade]) }}</td>
            <td class="is-total">{{ percent(roster.current.achievement.total) }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">缺額／超額（預估－目標）</th>
            <td v-for="grade in GRADE_ORDER" :key="grade"><span :class="`is-gap-${gapText(roster.current.gap[grade] ?? null).kind}`">{{ gapText(roster.current.gap[grade] ?? null).text }}</span></td>
            <td class="is-total"><span :class="`is-gap-${gapText(roster.current.gap.total ?? null).kind}`">{{ gapText(roster.current.gap.total ?? null).text }}</span></td>
          </tr>
          <tr class="roster-tier">
            <td class="roster-sg"></td>
            <th scope="row">全校三段目標</th>
            <td colspan="4">
              <label v-for="[key, name] in TIERS" :key="key">{{ name }}
                <input v-if="canWrite" type="number" min="0" inputmode="numeric" :aria-label="`${year}下 ${name}目標`" :value="roster.current.tier[key] ?? ''" @change="changeTier('current', key, $event)" />
                <b v-else>{{ roster.current.tier[key] ?? '—' }}</b>
              </label>
              <span class="roster-tier__text">{{ tierText(roster.current.tier) }}</span>
            </td>
            <td class="is-total">{{ cellOf(roster.current, 'estimate', 'total') }}</td>
          </tr>

          <!-- (Y+1)(上)：下學年開學 -->
          <tr class="roster-blk"><td colspan="7"><b>{{ year + 1 }}(上)</b><span>下學年開學的預估人數（班別＝升班後的班級；現在的大班畢業，不列入）</span></td></tr>
          <tr class="roster-from">
            <td class="roster-sg"></td>
            <th scope="row">這些人從哪裡來</th>
            <td>現在的中班升上來</td><td>現在的小班升上來</td><td>現在的幼幼班升上來</td><td>現在的幼幼班不足齡</td><td></td>
          </tr>
          <tr v-for="row in nextRows" :key="row.key" :class="{ 'is-result': row.result }">
            <td class="roster-sg">{{ row.sign }}</td>
            <th scope="row">{{ row.label }}</th>
            <td v-for="grade in GRADE_ORDER" :key="grade">{{ numText(cellOf(roster.next, row.key, grade), row.negative) }}</td>
            <td class="is-total">{{ numText(cellOf(roster.next, row.key, 'total'), row.negative) }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">目標人數</th>
            <td v-for="grade in GRADE_ORDER" :key="grade">
              <input v-if="canWrite" type="number" min="0" inputmode="numeric" placeholder="未設定" :aria-label="`${year + 1}上 ${grade}目標人數`" :value="roster.next.targets[grade] ?? ''" @change="emit('save-next-target', grade, parse($event))" />
              <template v-else>{{ roster.next.targets[grade] ?? '—' }}</template>
            </td>
            <td class="is-total">{{ roster.next.targets.total ?? '—' }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">達成率（預估÷目標）</th>
            <td v-for="grade in GRADE_ORDER" :key="grade">{{ percent(roster.next.achievement[grade]) }}</td>
            <td class="is-total">{{ percent(roster.next.achievement.total) }}</td>
          </tr>
          <tr>
            <td class="roster-sg"></td>
            <th scope="row">缺額／超額（預估－目標）</th>
            <td v-for="grade in GRADE_ORDER" :key="grade"><span :class="`is-gap-${gapText(roster.next.gap[grade] ?? null).kind}`">{{ gapText(roster.next.gap[grade] ?? null).text }}</span></td>
            <td class="is-total"><span :class="`is-gap-${gapText(roster.next.gap.total ?? null).kind}`">{{ gapText(roster.next.gap.total ?? null).text }}</span></td>
          </tr>
          <tr class="roster-tier">
            <td class="roster-sg"></td>
            <th scope="row">全校三段目標</th>
            <td colspan="4">
              <label v-for="[key, name] in TIERS" :key="key">{{ name }}
                <input v-if="canWrite" type="number" min="0" inputmode="numeric" :aria-label="`${year + 1}上 ${name}目標`" :value="roster.next.tier[key] ?? ''" @change="changeTier('next', key, $event)" />
                <b v-else>{{ roster.next.tier[key] ?? '—' }}</b>
              </label>
              <span class="roster-tier__text">{{ tierText(roster.next.tier) }}</span>
            </td>
            <td class="is-total">{{ cellOf(roster.next, 'estimate_next', 'total') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="roster-gap-note">
      <template v-if="past">這是回算到 {{ asOfText }} 的數字（依入園日、離園日、預繳日期）；上方編班表顯示的是現在的名單。</template>
      不足齡由生日自動判定：{{ year + 1 }} 年 9 月 1 日還沒滿 3 歲（{{ year - 2 }} 年 9 月 2 日以後出生）的幼幼班幼生，下學年不能升小班（在籍 {{ roster.underage_enrolled }} 人、預繳 {{ roster.underage_pending }} 人）。
      <template v-if="roster.missing_birthday > 0">還有 {{ roster.missing_birthday }} 位幼幼班幼生沒填生日，暫時算可以升小班。</template>
      <template v-if="roster.incomplete > 0">有 {{ roster.incomplete }} 位預繳生缺班別或入學學期，還沒算進來。</template>
    </p>
  </div>
</template>

<style scoped>
.roster-asof {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.roster-asof label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.roster-asof input,
.roster-asof button {
  height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
}

.roster-asof input {
  padding: 0 8px;
}

.roster-asof button {
  padding: 0 10px;
  cursor: pointer;
}

.roster-asof__save {
  margin-left: auto;
  border-color: var(--admin-accent-strong);
  background: var(--admin-accent-strong);
  color: var(--surface);
}

.roster-gap__scroll {
  overflow-x: auto;
}

.roster-gap table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
}

.roster-gap th,
.roster-gap td {
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.roster-gap thead th {
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.roster-gap th[scope='row'],
.roster-gap__item {
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}

.roster-gap th[scope='row'] small {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.roster-sg {
  width: 34px;
  padding-right: 0 !important;
  color: var(--ink-3);
  font-weight: 600;
  text-align: center !important;
}

.roster-blk td {
  padding-top: 12px;
  padding-bottom: 10px;
  background: var(--surface-2);
  text-align: left;
}

.roster-blk b {
  margin-right: 8px;
  font-size: var(--text-md);
}

.roster-blk span {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.is-result th,
.is-result td {
  border-top: 1px solid var(--line-strong);
  font-weight: 700;
}

.roster-from td,
.roster-from th {
  padding-top: 6px;
  padding-bottom: 2px;
  border-bottom: 0;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.is-total {
  border-left: 1px solid var(--line);
  font-weight: 600;
}

.roster-gap input[type='number'] {
  width: 76px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--warn-bg);
  color: var(--ink);
  font: inherit;
  text-align: right;
}

.roster-muted {
  color: var(--ink-3);
}

.roster-tier td {
  text-align: left;
}

.roster-tier td.is-total {
  text-align: right;
}

.roster-tier label {
  margin-right: 14px;
  color: var(--ink-2);
  white-space: nowrap;
}

.roster-tier input[type='number'] {
  width: 64px;
  height: 30px;
  margin-left: 4px;
}

.roster-tier__text {
  color: var(--ink);
  font-weight: 600;
}

.is-gap-short { color: var(--danger-ink); font-weight: 700; }
.is-gap-over { color: var(--status-live-ink); font-weight: 700; }
.is-gap-full { font-weight: 700; }

.roster-gap-note {
  margin: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
