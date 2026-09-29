<script setup lang="ts">
import { computed } from 'vue'
import { campusLabel } from '../api/labels'

// 校區選單。只有一個可見校區時（校區管理者）改成一個唯讀標籤，不讓人
// 點開只有一個選項的下拉。`allLabel` 給列表頁「全部校區」用。
const props = defineProps<{
  modelValue: string
  keys: readonly string[]
  allLabel?: string
  size?: 'small' | 'default' | 'large'
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v ?? ''),
})

const single = computed(() => props.keys.length === 1 && !props.allLabel)
</script>

<template>
  <span v-if="single" class="campus-single">
    <span class="campus-single__label">校區</span>
    <strong>{{ campusLabel(keys[0]) }}</strong>
  </span>
  <el-select
    v-else
    v-model="value"
    :placeholder="allLabel ?? '選擇校區'"
    :clearable="Boolean(allLabel)"
    :size="size"
    :disabled="disabled"
    aria-label="校區"
  >
    <el-option v-for="key in keys" :key="key" :label="campusLabel(key)" :value="key" />
  </el-select>
</template>

<style scoped>
.campus-single {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
}

.campus-single__label {
  font-size: 12px;
  color: var(--ink-3);
}
</style>
