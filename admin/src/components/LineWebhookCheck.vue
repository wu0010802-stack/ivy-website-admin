<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../api/client'
import { lineToolError, webhookCheckMessages } from '../api/lineTools'
import type { LineWebhookCheckOut } from '../api/types'

// 檢查連線（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §2）：按了才查，結果寫在這一列下面。
const props = defineProps<{ accountKey: string; accountName: string }>()

const checking = ref(false)
const result = ref<LineWebhookCheckOut | null>(null)
const failure = ref<string | null>(null)

const verdict = computed(() => (result.value ? webhookCheckMessages(result.value) : null))

async function check() {
  if (checking.value) return
  checking.value = true
  failure.value = null
  try {
    result.value = await api.post<LineWebhookCheckOut>(`/admin/line/accounts/${encodeURIComponent(props.accountKey)}/webhook-check`)
  } catch (err) {
    result.value = null
    failure.value = lineToolError(err, '檢查失敗，請稍後再試', '檢查太多次了，請稍後再試')
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="webhook-check" :data-test="`line-webhook-check-${accountKey}`">
    <el-button size="small" :loading="checking" :aria-label="`檢查${accountName}的連線`" data-test="line-webhook-check-button" @click="check">檢查連線</el-button>
    <div class="webhook-check__result" role="status" aria-live="polite">
      <p v-if="failure" class="webhook-check__line is-bad" data-test="line-webhook-check-error">{{ failure }}</p>
      <template v-else-if="verdict">
        <p v-for="message in verdict.messages" :key="message" class="webhook-check__line" :class="verdict.ok ? 'is-ok' : 'is-bad'" data-test="line-webhook-check-line">{{ message }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.webhook-check {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
}

.webhook-check__result {
  flex: 1 1 240px;
  min-width: 0;
}

.webhook-check__line {
  margin: 0;
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.webhook-check__line + .webhook-check__line {
  margin-top: 2px;
}

.webhook-check__line.is-ok {
  color: var(--ink-2);
}

.webhook-check__line.is-bad {
  color: var(--brand-gold-ink);
  font-weight: 600;
}
</style>
