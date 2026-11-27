<script setup lang="ts">
import { ROLE_LABELS, ROLE_ORDER } from '../api/labels'
import { GRANT_LABELS, PERMISSION_GROUPS, permissionState, type PermissionRow } from '../api/permissionLabels'

// 各角色的權限對照（2026-11-27）：規則來自後端 GET /admin/permission-table，這裡只排版。
// 每格三種：可以、要授權（總管理者逐人勾選才有）、不行。只用文字與符號區分，不單靠顏色。
defineProps<{ rows: Map<string, PermissionRow> }>()

const STATE_TEXT = { yes: '可以', grant: '要授權', no: '不行' } as const
</script>

<template>
  <div class="perm-matrix" tabindex="0" role="region" aria-label="各角色的權限對照表">
    <table>
      <thead>
        <tr>
          <th scope="col" class="perm-matrix__what">可以做的事</th>
          <th v-for="role in ROLE_ORDER" :key="role" scope="col">{{ ROLE_LABELS[role] }}</th>
        </tr>
      </thead>
      <tbody v-for="group in PERMISSION_GROUPS" :key="group.label">
        <tr class="perm-matrix__group">
          <th :colspan="ROLE_ORDER.length + 1" scope="colgroup">{{ group.label }}</th>
        </tr>
        <tr v-for="item in group.items" :key="item.key" :data-test="`perm-row-${item.key}`">
          <th scope="row" class="perm-matrix__what">{{ item.label }}</th>
          <td v-for="role in ROLE_ORDER" :key="role" :data-state="permissionState(rows.get(item.key), role)">
            <template v-if="permissionState(rows.get(item.key), role) === 'yes'"><span aria-hidden="true">✓</span><span class="sr-only">{{ STATE_TEXT.yes }}</span></template>
            <span v-else-if="permissionState(rows.get(item.key), role) === 'grant'" class="perm-matrix__grant" :title="`總管理者在「角色與校區」勾選「${GRANT_LABELS[rows.get(item.key)?.grant ?? ''] ?? '授權'}」才有`">{{ STATE_TEXT.grant }}</span>
            <template v-else><span aria-hidden="true">—</span><span class="sr-only">{{ STATE_TEXT.no }}</span></template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.perm-matrix { overflow-x: auto; max-width: 100%; }
.perm-matrix:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
table { width: 100%; min-width: 620px; border-collapse: collapse; font-size: var(--text-sm); }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--el-border-color-lighter); text-align: center; line-height: 1.45; }
thead th { position: sticky; top: 0; background: var(--el-bg-color); font-weight: 600; white-space: nowrap; z-index: 1; }
.perm-matrix__what { text-align: left; font-weight: 400; min-width: 220px; }
thead .perm-matrix__what { font-weight: 600; }
.perm-matrix__group th { padding-top: 16px; text-align: left; font-weight: 600; color: var(--ink-3); font-size: var(--text-xs); border-bottom-color: var(--el-border-color); }
td[data-state='yes'] { color: var(--el-color-success-dark-2); font-weight: 600; }
td[data-state='no'] { color: var(--ink-3); }
.perm-matrix__grant { display: inline-block; padding: 1px 8px; border: 1px dashed var(--el-color-warning-dark-2); border-radius: 999px; color: var(--el-color-warning-dark-2); font-size: var(--text-xs); white-space: nowrap; }
/* 手機：第一欄固定在左邊、縮窄並允許換行，角色欄左右捲。 */
@media (max-width: 700px) {
  table { min-width: 560px; }
  th, td { padding: 8px 6px; }
  .perm-matrix__what { position: sticky; left: 0; min-width: 0; width: 148px; max-width: 148px; background: var(--el-bg-color); box-shadow: 1px 0 0 var(--el-border-color-lighter); }
  thead .perm-matrix__what { z-index: 2; }
  .perm-matrix__group th { position: sticky; left: 0; }
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
