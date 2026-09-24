<script setup lang="ts">
definePageMeta({ key: route => route.path })
const route = useRoute()
const key = route.params.key as string

const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const campus = computed(() => data.value?.content.campuses.find((c) => c.key === key))

if (!campus.value) {
  throw createError({ statusCode: 404, message: '找不到這個校區' })
}

usePageSeo(computed(() => data.value?.content), campus)
</script>

<template>
  <div v-if="data && campus">
    <SiteHeader :content="data.content" />
    <CampusPageMain :campus="campus" />
    <SiteFooter :content="data.content" />
  </div>
</template>
