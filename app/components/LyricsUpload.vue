<script setup lang="ts">
type UploadJob = {
  id: string; title?: string | null; status: string; error?: string | null;
  archiveError?: string | null;
  log: string; hasFiles: boolean; expiresAt?: string | null; expiredAt?: string | null; deletedAt?: string | null;
};
const props = defineProps<{ jobs: UploadJob[] }>();
const emit = defineEmits<{ changed: [] }>();
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/?$/, "/");
const api = $fetch.create({ baseURL });
const file = ref<File | null>(null);
const retention = ref(1);
const artist = ref("");
const title = ref("");
const album = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");
const input = ref<HTMLInputElement | null>(null);
let controller: AbortController | null = null;
onBeforeUnmount(() => controller?.abort());
const labels: Record<string, string> = {
  uploading: "Файл загружается", queued: "В очереди", running: "Ищем текст",
  archiving: "Создаём ZIP", completed: "Готово", failed: "Ошибка", cancelled: "Отменено",
};
function chooseFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null;
  error.value = notice.value = "";
  if (file.value && (file.value.size > 100 * 1024 * 1024 || !file.value.size)) {
    error.value = "Выберите непустой файл размером до 100 МиБ.";
    file.value = null;
  }
}
async function upload() {
  if (!file.value || busy.value) return;
  busy.value = true;
  error.value = notice.value = "";
  controller = new AbortController();
  try {
    await api("/api/lyrics", {
      method: "POST", body: file.value, signal: controller.signal,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.value.name),
        "X-Retention-Hours": String(retention.value),
        "X-Artist": encodeURIComponent(artist.value.trim()),
        "X-Title": encodeURIComponent(title.value.trim()),
        "X-Album": encodeURIComponent(album.value.trim()),
      },
    });
    notice.value = "Файл принят. Ищем текст; результат появится ниже.";
    file.value = null;
    if (input.value) input.value.value = "";
    emit("changed");
  } catch (cause: any) {
    if (!controller.signal.aborted)
      error.value = cause.data?.statusMessage || "Не удалось загрузить файл. Проверьте соединение.";
  } finally {
    busy.value = false;
  }
}
const available = (job: UploadJob) => job.hasFiles && !job.expiredAt && !job.deletedAt &&
  !!job.expiresAt && Date.parse(job.expiresAt) > Date.now();
const expires = (value: string) => new Date(value).toLocaleString("ru-RU");
</script>
<template>
  <section class="panel compose-panel" aria-labelledby="lyrics-upload-heading">
    <h2 id="lyrics-upload-heading">Текст для своего файла</h2>
    <p class="field-note">Загрузите трек. Найденный текст запишем в теги и .lrc; аудио и .lrc можно скачать одним ZIP. Обычный текст сохраняется без временных меток.</p>
    <form class="lyrics-upload-form" @submit.prevent="upload">
      <div class="field">
        <label for="lyrics-file">Аудиофайл</label>
        <input id="lyrics-file" ref="input" type="file" accept=".flac,.mp3,.m4a,.ogg,.opus" required
          :disabled="busy" aria-describedby="lyrics-file-note" @change="chooseFile" />
        <p id="lyrics-file-note" class="field-note">FLAC, MP3, M4A, Ogg или Opus. Один файл, до 100 МиБ.</p>
      </div>
      <details class="lyrics-upload-metadata">
        <summary>Уточнить данные для поиска</summary>
      <p class="field-note">Исполнитель, название и альбом берутся из тегов. Заполните поля, если тегов нет или их нужно уточнить.</p>
      <div class="field"><label for="lyrics-artist">Исполнитель</label><input id="lyrics-artist" v-model="artist" maxlength="500" :disabled="busy" /></div>
      <div class="field"><label for="lyrics-title">Название трека</label><input id="lyrics-title" v-model="title" maxlength="500" :disabled="busy" /></div>
      <div class="field"><label for="lyrics-album">Альбом</label><input id="lyrics-album" v-model="album" maxlength="500" :disabled="busy" /></div>
      </details>
      <div class="form-options">
        <div class="field"><label for="lyrics-retention">Хранить архив</label>
          <select id="lyrics-retention" v-model.number="retention" :disabled="busy">
            <option v-for="hours in 5" :key="hours" :value="hours">{{ hours }} ч</option>
          </select>
        </div>
        <button class="primary-button" :disabled="busy || !file">
          <span v-if="busy" class="spinner" aria-hidden="true" /><AppIcon v-else name="music" />
          {{ busy ? "Загрузка файла…" : "Найти и добавить текст" }}
        </button>
      </div>
      <p class="field-note">После обработки оригинал на сервере удаляется. ZIP удалится через {{ retention }} ч после завершения.</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="form-success" role="status">{{ notice }}</p>
    </form>
  </section>
  <section class="section" aria-labelledby="lyrics-results-heading">
    <div class="section-heading"><h2 id="lyrics-results-heading">Результаты</h2></div>
    <div v-if="!props.jobs.length" class="empty-state"><AppIcon name="music" /><h3>Пока нет файлов</h3><p>Загрузите трек, чтобы найти для него текст.</p></div>
    <article v-for="job in props.jobs" :key="job.id" class="panel lyrics-result">
      <strong class="item-title">{{ job.title }}</strong>
      <p class="item-meta" role="status">{{ job.expiredAt || job.deletedAt ? "Файлы удалены" : job.archiveError ? 'Ошибка архивации' : labels[job.status] || job.status }}</p>
      <p v-if="job.error || job.archiveError" class="form-error" role="status">{{ job.error || job.archiveError }}</p>
      <template v-if="available(job)">
        <p class="field-note">{{ job.log.includes('без временных меток') ? 'Обычный текст без синхронизации.' : 'Синхронизированный текст.' }} Хранится до {{ expires(job.expiresAt!) }}.</p>
        <a class="primary-button" :href="`${baseURL}api/jobs/${job.id}/archive`"><AppIcon name="download" />Скачать ZIP</a>
      </template>
    </article>
  </section>
</template>
