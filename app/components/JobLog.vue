<script setup lang="ts">
const props = defineProps<{ log: string }>();
const output = ref<HTMLPreElement | null>(null);
let following = true;

function scrollToLatest() {
  if (following && output.value) {
    output.value.scrollTop = output.value.scrollHeight;
  }
}

function updateFollowing() {
  const element = output.value!;
  following = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
}

onMounted(scrollToLatest);
watch(() => props.log, scrollToLatest, { flush: "post" });
</script>

<template>
  <pre
    ref="output"
    class="log"
    tabindex="0"
    aria-label="Журнал задания"
    @scroll="updateFollowing"
  >{{ log || "Вывода пока нет." }}</pre>
</template>
