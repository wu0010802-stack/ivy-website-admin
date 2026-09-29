<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeAboutPayload, MediaAssetOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { altAfterPick } from '../composables/mediaThumbs'

const editor = useContentItem<HomeAboutPayload>('home_about', {
  title: '',
  since_label: '',
  body_text: '',
  caption: '',
  photo: null,
  photo_alt: '',
})

// 帶入素材庫的說明；換成另一張時換成新照片的說明（沒填就清空），不留舊照片的。
function onPickPhoto(asset: MediaAssetOut, previousId: string | null) {
  editor.form.value.photo_alt = altAfterPick(editor.form.value.photo_alt, previousId, asset)
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁第二屏的理念介紹。標題會用大字顯示，內文分段請用空一行。</template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標題">
        <el-input v-model="editor.form.value.title" />
        <LengthHint :value="editor.form.value.title" rule="aboutTitle" />
        <GlyphHint :value="editor.form.value.title" />
      </el-form-item>
      <el-form-item label="創校標籤">
        <el-input v-model="editor.form.value.since_label" placeholder="例如：Since 1997" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="editor.form.value.body_text" type="textarea" :autosize="{ minRows: 6, maxRows: 16 }" />
        <LengthHint :value="editor.form.value.body_text" rule="aboutBody" />
      </el-form-item>
      <el-form-item label="照片">
        <MediaSlotField
          v-model="editor.form.value.photo"
          builtin="官網內建的孩子與長輩合照"
          builtin-src="/assets/about-together.webp"
          :focus-previews="[{ label: '官網裁切（3:2）', ratio: '3 / 2' }]"
          :disabled="editor.readOnly.value"
          @picked="onPickPhoto"
        />
        <span class="field-help">這一區放一張圓角照片，官網裁成 3:2 橫式，建議寬 1200 以上。</span>
      </el-form-item>
      <el-form-item v-if="editor.form.value.photo" label="圖片說明（給看不到照片的人）">
        <el-input v-model="editor.form.value.photo_alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="200" placeholder="例如：孩子們笑著圍在長輩身邊" />
        <span class="field-help">給看不見照片的家長，官網不會顯示出來；換照片時會換成素材庫裡新照片的說明，留空時官網也用素材庫的說明。</span>
      </el-form-item>
      <el-form-item label="照片下方文字">
        <el-input v-model="editor.form.value.caption" />
        <LengthHint :value="editor.form.value.caption" rule="aboutCaption" />
        <span class="field-help">顯示在孩子照片下方、家長看得到的一句話。</span>
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
