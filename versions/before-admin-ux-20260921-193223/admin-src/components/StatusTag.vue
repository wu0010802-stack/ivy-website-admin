<script setup lang="ts">
import type { StatusMeta } from '../api/labels'

defineProps<{ meta: StatusMeta; size?: 'small' | 'default' | 'large' }>()
</script>

<template>
  <el-tag :type="meta.tone" :size="size" effect="light" round>{{ meta.label }}</el-tag>
</template>
