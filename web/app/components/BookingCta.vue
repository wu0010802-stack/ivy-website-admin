<script setup lang="ts">
import { resolveBookingAction } from '~/utils/booking-action'
import type { BookingActionKind } from '~/utils/booking-action'
import { reportBookingActionClick } from '~/utils/cta-analytics'

const runtimeConfig = useRuntimeConfig()

const props = defineProps<{
  campusKey: string
  label?: string
  buttonClass?: string
}>()

const { data: config, pending, error } = useCampusBooking(computed(() => props.campusKey))

const action = computed(() => resolveBookingAction(props.campusKey, config.value ?? null, Boolean(error.value)))
const displayLabel = computed(() => props.label ?? action.value.label)

// 點擊只回報去識別化的計數，不代表「已預約」——LINE/電話/外部網址
// 點擊都不算成功預約，這裡也不會因為點擊就自動建案。失敗就安靜略過，
// 不影響使用者原本要做的事（跳去 LINE／撥號／開外部網站）。表單模式是
// 站內連結，由 plugins/telemetry.client.ts 統一記 booking_cta_clicked。
function trackClick(kind: BookingActionKind, event: MouseEvent) {
  reportBookingActionClick(kind, props.campusKey, event.currentTarget as Element | null, runtimeConfig.public.telemetryEnabled)
}
</script>

<template>
  <NuxtLink
    v-if="!pending && action.kind === 'unavailable'"
    :class="buttonClass"
    :to="`/visit/${campusKey}`"
  >
    {{ action.label }}
  </NuxtLink>
  <NuxtLink
    v-else-if="!pending && action.kind === 'form'"
    :class="buttonClass"
    :to="action.href!"
  >
    <slot>{{ displayLabel }}</slot>
  </NuxtLink>
  <a
    data-booking-cta
    v-else-if="!pending && (action.kind === 'line' || action.kind === 'external') && action.href"
    :class="buttonClass"
    :href="action.href"
    target="_blank"
    rel="noopener noreferrer"
    @click="trackClick(action.kind, $event)"
  >
    <slot>{{ displayLabel }}</slot>
  </a>
  <a
    data-booking-cta
    v-else-if="!pending && action.kind === 'phone' && action.href"
    :class="buttonClass"
    :href="action.href"
    @click="trackClick(action.kind, $event)"
  >
    <slot>{{ displayLabel }}</slot>
  </a>
  <span v-else-if="!pending" class="booking-status" role="note">
    {{ action.message || displayLabel }}
  </span>
</template>

<style scoped>
.booking-status{display:block;max-width:36em;font-size:var(--fs-md);line-height:1.8;color:inherit;font-weight:400;text-wrap:pretty}
</style>
