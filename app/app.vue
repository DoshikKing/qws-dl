<script setup lang="ts">
const base=useRuntimeConfig().app.baseURL.replace(/\/?$/, '/');
const path=useRequestURL().pathname;
const relative=path.startsWith(base)?path.slice(base.length):'';
const publicPage=relative.startsWith('s/');
const token=relative.match(/^s\/([A-Za-z0-9_-]{43})$/)?.[1]||'';
</script>
<template><PublicShare v-if="publicPage" :token="token" /><Workspace v-else /></template>
