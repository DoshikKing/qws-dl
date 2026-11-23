<script setup lang="ts">
import { audioFormats, formatFields, normalizeFormatOptions } from '#shared/audio-formats.mjs';
defineProps<{ prefix: string; disabled?: boolean }>();
const format = defineModel<string>({ required: true });
type Value = string | number;
type Field = { label: string; default: Value; choices: Value[][]; when?: string[] };
const settings = defineModel<Record<string, Record<string, Value>>>('settings', { required: true });
const options = computed(() => normalizeFormatOptions(format.value, settings.value[format.value] || {}));
const fields = computed(() => Object.entries((formatFields as Record<string, Record<string, Field>>)[format.value] || {})
  .filter(([, field]) => !field.when || options.value[field.when[0]!] === field.when[1]));
function update(key: string, field: Field, event: Event) {
  const value = field.choices.find(([choice]) => String(choice) === (event.target as HTMLSelectElement).value)?.[0];
  if (value === undefined) return;
  settings.value = { ...settings.value, [format.value]: { ...options.value, [key]: value } };
}
function reset() {
  const next = { ...settings.value };
  delete next[format.value];
  settings.value = next;
}
</script>
<template>
  <div class="field output-format">
    <label :for="`${prefix}-format`">Формат файла</label>
    <select :id="`${prefix}-format`" v-model="format" :disabled="disabled" :aria-describedby="`${prefix}-format-note`">
      <option v-for="(label, value) in audioFormats" :key="value" :value="value">{{ label }}</option>
    </select>
    <p :id="`${prefix}-format-note`" class="field-note">{{ format === 'original' ? 'Без конвертации: формат выбранного качества Qobuz.' : format === 'dsd' ? 'PCM → DSD. Это не повышает качество исходника; высокая частота увеличивает размер и время обработки.' : ['mp3', 'aac', 'vorbis', 'opus'].includes(format) ? 'Сжатие с потерями. Для конвертации лучше выбрать исходное качество FLAC.' : 'Снижение битности или частоты меняет аудио. Увеличение не улучшает качество исходника.' }}</p>
    <details v-if="format !== 'original'" :key="format" class="format-settings">
      <summary>Настройки формата</summary>
      <fieldset :disabled="disabled" class="format-settings-fields" aria-label="Параметры конвертации">
        <div v-for="([key, field]) in fields" :key="key" class="field">
          <label :for="`${prefix}-option-${key}`">{{ field.label }}</label>
          <select :id="`${prefix}-option-${key}`" :value="options[key]" @change="update(key, field, $event)">
            <option v-for="([value, label]) in field.choices" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <p v-if="format === 'opus'" class="field-note">Opus выдаётся с частотой 48 кГц. Битность не задаётся для форматов с потерями.</p>
        <p v-if="format === 'ape'" class="field-note">Более сильное сжатие требует больше времени; при одинаковой битности и частоте звук не меняется.</p>
        <button type="button" class="quiet-button" @click="reset">Сбросить настройки формата</button>
      </fieldset>
    </details>
  </div>
</template>
<style scoped>
.output-format { margin-top: 16px; }
.format-settings { margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; }
.format-settings summary { min-height: 44px; padding: 12px 16px; cursor: pointer; }
.format-settings summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.format-settings-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-width: 0; margin: 0; padding: 4px 16px 16px; border: 0; }
.format-settings-fields .field-note, .format-settings-fields button { grid-column: 1 / -1; margin: 0; }
.format-settings-fields button { justify-self: start; }
@media (max-width: 600px) { .format-settings-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
