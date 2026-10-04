<script setup lang="ts">
import { computed } from 'vue'
import MediaSlotField from './MediaSlotField.vue'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import type { MediaAssetOut, MediaSlotPayload } from '../api/types'

// 整頁內容的一個照片版位：從素材庫換照片（留空＝官網內建照片與內建說明）＋給看不到照片的人的說明。
// 換照片時說明換成新照片在素材庫的說明（altAfterPick），改回內建時清空。
// 選圖一律走 MediaSlotField（內部是 MediaFieldCard＋素材庫對話框），這裡不直接碰對話框。
// noFocus：作品照保留原本比例、不裁切，不需要焦點。
const photo = defineModel<MediaSlotPayload | null | undefined>('photo', { required: true })
const alt = defineModel<string | undefined>('alt', { required: true })
const props = withDefaults(
  defineProps<{ label: string; builtin: string; builtinSrc: string; ratio?: string; noFocus?: boolean; help?: string; disabled?: boolean }>(),
  { ratio: '4:3', noFocus: false, help: '', disabled: false },
)
const focusPreviews = computed(() =>
  props.noFocus ? [] : [{ label: `官網裁切（${props.ratio}）`, ratio: props.ratio.replace(':', ' / ') }],
)

function onPicked(asset: MediaAssetOut, previousId: string | null) {
  alt.value = altAfterPick(alt.value, previousId ?? BUILTIN_PHOTO, asset)
}
</script>

<template>
  <el-form-item :label="props.label">
    <MediaSlotField
      v-model="photo"
      :builtin="props.builtin"
      :builtin-src="props.builtinSrc"
      :focus="props.noFocus ? false : undefined"
      :focus-previews="focusPreviews"
      :disabled="props.disabled"
      @picked="onPicked"
      @cleared="alt = ''"
    />
    <span v-if="props.help" class="field-help">{{ props.help }}</span>
  </el-form-item>
  <el-form-item v-if="photo" :label="`${props.label}說明`">
    <el-input v-model="alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="200" />
    <span class="field-help">給看不到照片的家長，官網不會顯示出來；留空時官網用素材庫裡這張照片的說明。</span>
  </el-form-item>
</template>
