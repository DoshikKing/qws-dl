<script setup lang="ts">
const emit = defineEmits<{ saved: [] }>();
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL });
const quality = ref('hifi');
const mode = ref('time');
const hours = ref(24);
const downloads = ref(1);
const lyrics = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
type Defaults = { quality: string; retentionMode: string; retentionHours: number; downloadLimit: number; lyrics: boolean };
onMounted(async () => {
  try { const result = await api<Defaults>('/api/admin/settings');
    quality.value = result.quality; mode.value = result.retentionMode; hours.value = result.retentionHours;
    downloads.value = result.downloadLimit; lyrics.value = result.lyrics;
  } catch (e: any) { error.value = e.data?.statusMessage || 'Не удалось прочитать настройки.'; }
  finally { loading.value = false; }
});
async function save() {
  if (busy.value) return;
  busy.value = true; error.value = notice.value = '';
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { quality: quality.value, retentionMode: mode.value,
      retentionHours: hours.value, downloadLimit: downloads.value, lyrics: lyrics.value } });
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
      <p class="section-note">Для новых загрузок всех пользователей. Перед добавлением задания эти значения можно изменить.</p>
      <div class="field"><label for="default-quality">Качество</label><select id="default-quality" v-model="quality" :disabled="loading || busy">
        <option value="hifi">FLAC · до 192 кГц / 24 бит</option><option value="lossless">FLAC · 44,1 кГц / 16 бит</option><option value="high">MP3 · 320 кбит/с</option>
      </select></div>
      <RetentionOptions prefix="default-retention" v-model:mode="mode" v-model:hours="hours" v-model:downloads="downloads" :disabled="loading || busy" />
      <label class="lyrics-option"><input v-model="lyrics" type="checkbox" :disabled="loading || busy" /><span>Добавлять тексты песен</span></label>
      <p v-if="mode === 'downloads'" class="field-note">Без ограничения по времени: архив хранится до указанного числа скачиваний. Квоты хранилища продолжают действовать.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="notice" class="form-success" role="status">{{ notice }}</p>
      <button class="primary-button" :disabled="loading || busy">{{ busy ? 'Сохранение…' : 'Сохранить настройки' }}</button>
    </form>
  </section>
</template>
<style scoped>
.default-settings { display: grid; gap: 20px; }
.default-settings > .section-note, .default-settings .lyrics-option, .default-settings .field-note { margin-top: 0; }
.default-settings > .primary-button { justify-self: start; }
</style>
