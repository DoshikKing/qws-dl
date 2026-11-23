<script setup lang="ts">
const emit = defineEmits<{ saved: [] }>();
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL });
const quality = ref('hifi');
const mode = ref('time');
const hours = ref(24);
const downloads = ref(1);
const downloadHours = ref(168);
const lyrics = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
type Defaults = { quality: string; retentionMode: string; retentionHours: number; downloadLimit: number; downloadRetentionHours: number; lyrics: boolean };
onMounted(async () => {
  try { const result = await api<Defaults>('/api/admin/settings');
    quality.value = result.quality; mode.value = result.retentionMode; hours.value = result.retentionHours;
    downloads.value = result.downloadLimit; downloadHours.value = result.downloadRetentionHours; lyrics.value = result.lyrics;
  } catch (e: any) { error.value = e.data?.statusMessage || 'Не удалось прочитать настройки.'; }
  finally { loading.value = false; }
});
async function save() {
  if (busy.value) return;
  busy.value = true; error.value = notice.value = '';
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { quality: quality.value, retentionMode: mode.value,
      retentionHours: hours.value, downloadLimit: downloads.value, downloadRetentionHours: downloadHours.value, lyrics: lyrics.value } });
    notice.value = 'Настройки сохранены. Они применяются к новым заданиям; уже созданные не изменены.';
    emit('saved');
  } catch (e: any) { error.value = e.data?.statusMessage || 'Не удалось сохранить настройки.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="section" aria-labelledby="defaults-heading">
    <div class="section-heading"><h2 id="defaults-heading">Настройки по умолчанию</h2></div>
    <form class="panel account-panel default-settings" :aria-busy="loading" @submit.prevent="save">
      <p class="section-note">Для новых загрузок всех пользователей. Параметры хранения каждого режима сохраняются отдельно.</p>
      <div class="field"><label for="default-quality">Качество</label><select id="default-quality" v-model="quality" :disabled="loading || busy">
        <option value="hifi">FLAC · до 192 кГц / 24 бит</option><option value="lossless">FLAC · 44,1 кГц / 16 бит</option><option value="high">MP3 · 320 кбит/с</option>
      </select></div>
      <div class="field"><label for="default-retention-mode">Режим по умолчанию</label>
        <select id="default-retention-mode" v-model="mode" :disabled="loading || busy"><option value="time">По времени</option><option value="downloads">По скачиваниям</option></select>
      </div>
      <fieldset class="retention-group" :disabled="loading || busy">
        <legend>По времени</legend>
        <div class="field"><label for="default-retention-hours">Хранить, часов</label>
          <input id="default-retention-hours" v-model.number="hours" type="number" min="1" max="24" step="1" required aria-describedby="time-retention-note" />
        </div>
        <p id="time-retention-note" class="field-note">От 1 до 24 часов после завершения. Для файлов с текстами — до 5 часов.</p>
      </fieldset>
      <fieldset class="retention-group" :disabled="loading || busy">
        <legend>По скачиваниям</legend>
        <div class="field"><label for="default-retention-downloads">Число скачиваний по умолчанию</label>
          <input id="default-retention-downloads" v-model.number="downloads" type="number" min="1" max="15" step="1" required />
        </div>
        <div class="field"><label for="default-download-hours">Максимальный срок хранения, часов</label>
          <input id="default-download-hours" v-model.number="downloadHours" type="number" min="1" max="720" step="1" required aria-describedby="download-retention-note" />
        </div>
        <p id="download-retention-note" class="field-note">От 1 часа до 30 дней (720 ч), по умолчанию неделя (168 ч). Архив удалится по сроку или после выбранного числа скачиваний — что наступит раньше. Пользователь может выбрать от 1 до 15 скачиваний; срок задаёт администратор.</p>
      </fieldset>
      <label class="lyrics-option"><input v-model="lyrics" type="checkbox" :disabled="loading || busy" /><span>Добавлять тексты песен</span></label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="notice" class="form-success" role="status">{{ notice }}</p>
      <button class="primary-button" :disabled="loading || busy">{{ busy ? 'Сохранение…' : 'Сохранить настройки' }}</button>
    </form>
  </section>
</template>
<style scoped>
.default-settings { display: grid; gap: 20px; }
.default-settings > .section-note, .default-settings .lyrics-option, .default-settings .field-note { margin-top: 0; }
.default-settings > .primary-button { justify-self: start; }
.retention-group { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: 8px; }
.retention-group legend { padding-inline: 4px; font-weight: 500; }
.retention-group .field-note { margin: 0; }
</style>
