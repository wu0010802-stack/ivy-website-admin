<script setup lang="ts">
import type { AreaBabycare, AreaKindergartens, AreaPeerFees } from '../../../api/types'
import NearbyBabycare from './NearbyBabycare.vue'
import NearbyKindergartens from './NearbyKindergartens.vue'
import { NEARBY_KINDS, type NearbyKind, type RadiusKm } from './areaFormat'
import type { PeerAge } from './peerFeesFormat'

// 「附近幼兒園」卡片（2026-10-14 規格 7.1）：頂端加一組切換——幼兒園（預設）／托嬰中心，半徑兩邊共用。
// 兩份清單各自讀取、各自有狀態（骨架、失敗重試、尚未匯入），這裡只負責切換與把事件轉送出去。
defineProps<{
  kind: NearbyKind
  radiusKm: RadiusKm
  kindergartens: AreaKindergartens | null
  kindergartensFailed: boolean
  babycare: AreaBabycare | null
  babycareFailed: boolean
  peerFees?: AreaPeerFees | null
  peerAge?: PeerAge
}>()
const emit = defineEmits<{
  'update:kind': [value: NearbyKind]
  'update:radiusKm': [value: RadiusKm]
  'select-kindergarten': [id: string]
  'select-babycare': [id: string]
  'retry-kindergartens': []
  'retry-babycare': []
}>()

function setKind(value: string | number | boolean | undefined) {
  if (value === 'kindergarten' || value === 'babycare') emit('update:kind', value)
}
</script>

<template>
  <div class="nearby-panel">
    <el-radio-group :model-value="kind" size="small" aria-label="名單種類" @update:model-value="setKind">
      <el-radio-button v-for="option in NEARBY_KINDS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
    </el-radio-group>
    <NearbyKindergartens
      v-if="kind === 'kindergarten'"
      :radius-km="radiusKm"
      :data="kindergartens"
      :failed="kindergartensFailed"
      :fees="peerFees"
      :fee-age="peerAge"
      @update:radius-km="emit('update:radiusKm', $event)"
      @select="emit('select-kindergarten', $event)"
      @retry="emit('retry-kindergartens')"
    />
    <NearbyBabycare
      v-else
      :radius-km="radiusKm"
      :data="babycare"
      :failed="babycareFailed"
      @update:radius-km="emit('update:radiusKm', $event)"
      @select="emit('select-babycare', $event)"
      @retry="emit('retry-babycare')"
    />
  </div>
</template>

<style scoped>
.nearby-panel {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}
</style>
