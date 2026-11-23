<script setup lang="ts">
defineProps<{ prefix: string; maxHours?: number; disabled?: boolean }>();
const mode = defineModel<string>('mode', { required: true });
const hours = defineModel<number>('hours', { required: true });
const downloads = defineModel<number>('downloads', { required: true });
</script>
<template>
  <div class="retention-options">
    <div class="field"><label :for="`${prefix}-mode`">Удаление архива</label>
      <select :id="`${prefix}-mode`" v-model="mode" :disabled="disabled">
        <option value="time">По времени</option><option value="downloads">По скачиваниям</option>
      </select>
    </div>
    <div v-if="mode === 'time'" class="field"><label :for="`${prefix}-hours`">Хранить, часов</label>
      <select :id="`${prefix}-hours`" v-model.number="hours" :disabled="disabled"><option v-for="n in maxHours || 24" :key="n" :value="n">{{ n }} ч</option></select>
    </div>
    <div v-else class="field"><label :for="`${prefix}-downloads`">Число скачиваний</label>
      <input :id="`${prefix}-downloads`" v-model.number="downloads" type="number" min="1" max="100" step="1" required :disabled="disabled" />
    </div>
  </div>
</template>
<style scoped>
.retention-options { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); align-items: end; gap: 12px; }
@media (max-width: 480px) { .retention-options { grid-template-columns: minmax(0, 1fr); } }
</style>
