<script setup lang="ts">
const props = defineProps<{ jobId: string; status: string; ready: boolean }>();
const emit = defineEmits<{ queued: [] }>();
type Track = {
  id: string; title: string; artist: string; number: number; status: string; error?: string;
  retry: { id: string; status: string; error?: string } | null;
};
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL });
const tracks = ref<Track[]>([]);
const open = ref(false);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const retrying = ref('');
const retryErrors = ref<Record<string, string>>({});
const loaded = ref(false);
let disposed = false;
let fetching = false;
const labels: Record<string, string> = {
  pending: 'Ожидает', running: 'Загружается', completed: 'Готово', failed: 'Ошибка',
  skipped: 'Пропущен', not_downloaded: 'Не загружен', queued: 'В очереди',
  archiving: 'Создаётся ZIP', cancelled: 'Отменено',
};
const active = (state: string) => ['pending', 'queued', 'running', 'archiving'].includes(state);
const message = (e: any) => e.data?.statusMessage || e.statusMessage || 'Не удалось связаться с сервером.';
async function load() {
  if (!open.value || fetching || disposed) return;
  fetching = true;
  loading.value = !loaded.value;
  try {
    const result = await api<{ tracks: Track[] }>(`/api/jobs/${props.jobId}/tracks`);
    if (disposed) return;
    tracks.value = result.tracks;
    loaded.value = true;
    error.value = '';
  } catch (e) {
    if (!disposed) error.value = message(e);
  } finally {
    loading.value = false;
    fetching = false;
  }
}
function toggle() {
  open.value = !open.value;
  clearInterval(timer);
  if (open.value) { load(); timer = setInterval(load, 3000); }
}
async function retry(track: Track) {
  if (retrying.value) return;
  retrying.value = track.id;
  retryErrors.value[track.id] = '';
  error.value = '';
  notice.value = '';
  try {
    const result = await api<{ id: string; status: string }>(`/api/jobs/${props.jobId}/tracks/${track.id}/retry`, { method: 'POST' });
    if (disposed) return;
    track.retry = result;
    notice.value = 'Трек добавлен в очередь. Результат будет отдельным ZIP.';
    emit('queued');
  } catch (e) {
    if (!disposed) retryErrors.value[track.id] = message(e);
  } finally {
    retrying.value = '';
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
onBeforeUnmount(() => { disposed = true; clearInterval(timer); });
watch(() => props.status, load);
</script>

<template>
  <section class="album-tracks">
    <button type="button" class="quiet-button tracks-toggle" :aria-expanded="open" :aria-controls="`tracks-${jobId}`" @click="toggle">
      <AppIcon name="arrow-right" :class="{ expanded: open }" />Список треков
    </button>
    <DisclosurePanel :id="`tracks-${jobId}`" :open="open">
      <p v-if="loading" class="section-note" role="status">Загрузка списка…</p>
      <p v-if="error" class="job-error" role="alert">{{ error }}</p>
      <button v-if="error" class="quiet-button" type="button" :disabled="loading" @click="load">Обновить список</button>
      <p v-if="notice" class="section-note" role="status">{{ notice }}</p>
      <p v-if="loaded && !tracks.length" class="section-note">
        {{ ['queued', 'running'].includes(status) ? 'Список появится после получения данных альбома.' : 'Список недоступен для этой загрузки. Он сохраняется для новых заданий.' }}
      </p>
      <template v-if="tracks.length">
        <p class="section-note">Повторный трек скачивается с настройками альбома и сохраняется отдельным ZIP в очереди.</p>
        <ol class="album-track-list">
          <li v-for="track in tracks" :key="track.id" class="album-track">
            <span class="track-number" aria-hidden="true">{{ track.number }}</span>
            <div class="track-description">
              <strong>{{ track.title }}</strong>
              <span v-if="track.artist">{{ track.artist }}</span>
              <span class="track-state">
                <span :data-status="track.status">{{ labels[track.status] || track.status }}</span><template v-if="track.retry"> · <span :data-status="track.retry.status">Повтор: {{ labels[track.retry.status] || track.retry.status }}</span></template>
              </span>
              <p v-if="track.status === 'failed' || track.status === 'not_downloaded'" class="track-error">{{ track.error || (track.status === 'failed' ? 'Не удалось скачать аудиофайл.' : 'Загрузка трека не завершена.') }}</p>
              <p v-if="retryErrors[track.id]" class="track-error" role="alert">{{ retryErrors[track.id] }}</p>
              <p v-if="track.retry?.status === 'failed'" class="track-error">Повтор: {{ track.retry.error || 'Не удалось скачать аудиофайл.' }}</p>
            </div>
            <button type="button" class="quiet-button" :disabled="!ready || !!retrying || active(track.status) || !!(track.retry && active(track.retry.status))"
              :aria-label="`Скачать повторно: ${track.title}`" @click="retry(track)">
              <span v-if="retrying === track.id" class="spinner" aria-hidden="true" />
              {{ retrying === track.id ? 'Добавление…' : track.retry && active(track.retry.status) ? labels[track.retry.status] : 'Повторить' }}
            </button>
          </li>
        </ol>
      </template>
    </DisclosurePanel>
  </section>
</template>

<style scoped>
.album-tracks { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.tracks-toggle .app-icon { transition: transform 240ms ease; }
.tracks-toggle .expanded { transform: rotate(90deg); }
.album-track-list { list-style: none; padding: 0; margin: 12px 0 0; }
.album-track { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 16px 0; border-top: 1px solid var(--line); }
.track-number { color: var(--secondary); font-size: 12px; }
.track-description { min-width: 0; display: grid; gap: 4px; overflow-wrap: anywhere; }
.track-description strong { font-size: 14px; font-weight: 500; }
.track-description span { font-size: 12px; color: var(--secondary); }
.track-state [data-status="failed"],
.track-state [data-status="not_downloaded"] { color: var(--danger); }
.track-state [data-status="completed"] { color: var(--success); }
.track-error { color: var(--danger); font-size: 12px; line-height: 1.5; }
@media (max-width: 480px) {
  .album-track { grid-template-columns: 20px minmax(0, 1fr); gap: 6px; }
  .album-track .quiet-button { grid-column: 2; justify-self: start; }
}
</style>
