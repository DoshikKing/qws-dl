<script setup lang="ts">
import { audioFormats } from '#shared/audio-formats.mjs';
defineProps<{ prefix: string; disabled?: boolean }>();
const format = defineModel<string>({ required: true });
</script>
<template>
  <div class="field output-format">
    <label :for="`${prefix}-format`">Формат файла</label>
    <select :id="`${prefix}-format`" v-model="format" :disabled="disabled" :aria-describedby="`${prefix}-format-note`">
      <option v-for="(label, value) in audioFormats" :key="value" :value="value">{{ label }}</option>
    </select>
    <p :id="`${prefix}-format-note`" class="field-note">{{ format === 'original' ? 'Без конвертации: формат выбранного качества Qobuz.' : format === 'dsd' ? 'PCM → DSD64, с запасом уровня 6 дБ. Это не повышает качество исходника; обработка займёт больше времени.' : ['mp3', 'aac', 'vorbis', 'opus'].includes(format) ? 'Сжатие с потерями. Для конвертации лучше выбрать исходное качество FLAC.' : 'Без потерь относительно загруженного аудио. Конвертация из MP3 не восстановит утраченное качество.' }}</p>
  </div>
</template>
<style scoped>
.output-format { margin-top: 16px; }
</style>
