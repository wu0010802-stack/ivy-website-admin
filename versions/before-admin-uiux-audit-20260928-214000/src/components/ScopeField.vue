<script setup lang="ts">
import { computed } from 'vue'
import { campusLabel } from '../api/labels'
import type { ScopedEntry } from '../api/types'
import { CAMPUS_KEYS, scopeInvalid } from '../composables/newsContent'

// 全站消息、活動與共用常見問題的適用範圍（規格 3.4）：全校，或指定校區
// （至少一校）。只在全站內容用；各校自己的內容一定屬於那一校。直接改傳進來
// 的那一項（同其他清單編輯的寫法）。
const props = defineProps<{ entry: ScopedEntry; label?: string }>()

const invalid = computed(() => scopeInvalid(props.entry))
</script>

<template>
  <el-form-item :label="label ?? '適用校區'" :error="invalid ? '指定校區時至少要選一校' : ''" class="scope-field">
    <div class="scope-field__body">
      <el-radio-group v-model="entry.scope">
        <el-radio value="global">全校</el-radio>
        <el-radio value="campus">指定校區</el-radio>
      </el-radio-group>
      <el-checkbox-group v-if="entry.scope === 'campus'" v-model="entry.campus_keys" class="scope-field__campuses">
        <el-checkbox v-for="key in CAMPUS_KEYS" :key="key" :value="key">{{ campusLabel(key) }}</el-checkbox>
      </el-checkbox-group>
    </div>
  </el-form-item>
</template>

<style scoped>
.scope-field__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  min-width: 0;
}

.scope-field__campuses {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
}
</style>
