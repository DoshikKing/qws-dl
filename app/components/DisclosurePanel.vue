<script setup lang="ts">
const props = defineProps<{ open: boolean }>();
const rendered = ref(props.open);
watch(() => props.open, (value) => { if (value) rendered.value = true; });
</script>

<template>
  <div class="disclosure-panel" :class="{ 'is-open': open }" :aria-hidden="!open" :inert="!open">
    <div class="disclosure-inner"><div v-if="rendered"><slot /></div></div>
  </div>
</template>

<style scoped>
.disclosure-panel {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition: grid-template-rows 240ms ease, opacity 200ms ease, visibility 0s 240ms;
}
.disclosure-panel.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
.disclosure-inner { min-height: 0; overflow: hidden; }
/* Native intrinsic sizing where supported; the grid above remains the fallback. */
@supports (interpolate-size: allow-keywords) {
  .disclosure-panel {
    display: block;
    interpolate-size: allow-keywords;
    block-size: 0;
    overflow: clip;
    transition: block-size 240ms ease, opacity 200ms ease, visibility 0s 240ms;
  }
  .disclosure-panel.is-open { block-size: auto; transition-delay: 0s; }
}
</style>
