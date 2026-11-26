<script setup lang="ts">
type Archive = {
  id: string;
  name: string;
  title: string;
  size: number;
  status: string;
  downloadWarning?: boolean;
  archiveError: string | null;
  expiresAt: string | null;
  retentionMode?: string; downloadLimit?: number; downloadCount?: number;
  owner?: string;
};
const props = defineProps<{ management?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/?$/, "/");
const api = $fetch.create({ baseURL });
const files = ref<Archive[]>([]);
const sharing = ref<Archive | null>(null);
const search = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const error = ref("");
const notice = ref("");
const loading = ref(true);
const busy = ref(false);
const dialog = ref<HTMLDialogElement | null>(null);
const selected = ref<Archive | null>(null);
const dialogError = ref("");
const filtered = computed(() =>
  files.value.filter((file) =>
    `${file.name} ${file.owner || ""}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} Б`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} КБ`
      : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    files.value = (
      await api<{ files: Archive[] }>(
        props.management ? "/api/admin/downloads" : "/api/files",
      )
    ).files;
    error.value = "";
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Не удалось получить архивы.";
  } finally {
    loading.value = false;
    refreshing = false;
  }
}
useVisiblePolling(refresh, 3000);
async function confirmDelete(file: Archive) {
  selected.value = file;
  dialogError.value = "";
  await nextTick();
  dialog.value?.showModal();
}
async function remove() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  dialogError.value = "";
  try {
    await api(props.management ? `/api/admin/downloads/${selected.value.id}` : `/api/jobs/${selected.value.id}/archive`, {
      method: "DELETE",
    });
    notice.value = `Удалено: ${selected.value.name}`;
    dialog.value?.close();
    await refresh();
    await nextTick();
    searchInput.value?.focus();
    emit("changed");
  } catch (e: any) {
    dialogError.value = e.data?.statusMessage || "Не удалось удалить файлы.";
  } finally {
    busy.value = false;
  }
}
async function retry(file: Archive) {
  busy.value = true;
  try {
    await api(`/api/jobs/${file.id}/archive`, { method: "POST" });
    await refresh();
    emit("changed");
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Не удалось запустить архивацию.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="section first-section" aria-labelledby="archive-list-heading">
    <div class="section-heading files-heading">
      <h2 id="archive-list-heading">
        {{ management ? "Архивы" : "ZIP-архивы" }}
        <span class="item-count">{{ files.length }}</span>
      </h2>
      <search class="search-control" aria-label="Поиск архивов">
        <AppIcon name="search" /><input
          ref="searchInput"
          v-model="search"
          type="search"
          aria-label="Поиск архивов"
          placeholder="Поиск"
          enterkeyhint="search"
        />
      </search>
    </div>
    <p class="section-note">
      {{
        management
          ? "Архивы всех пользователей. Удаление освободит место; история загрузок сохранится."
          : "Ваши архивы можно удалить вручную. История загрузок сохранится."
      }}
    </p>
    <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="section-note archive-notice" role="status">
      {{ notice }}
    </p>
    <div class="collection-content" :aria-busy="loading">
      <Transition name="collection" mode="out-in">
        <div v-if="loading" key="loading" class="collection-loading" role="status">
          <span class="spinner" aria-hidden="true" />Загрузка…
        </div>
        <div v-else key="results">
          <div v-if="!filtered.length" class="empty-state">
            <AppIcon name="archive" />
            <h3>{{ search ? "Ничего не найдено" : "Архивов нет" }}</h3>
          </div>
          <div v-else class="panel archive-list">
            <article
              v-for="file in filtered"
              :key="file.id"
              class="archive-item"
              :aria-label="file.name"
            >
              <div class="item-icon">
                <span v-if="file.status === 'archiving'" class="spinner" /><AppIcon
                  v-else
                  name="archive"
                />
              </div>
              <div class="item-description">
                <a
                  v-if="
                    !management && file.status !== 'archiving' && !file.archiveError
                  "
                  class="item-title"
                  :href="`${baseURL}api/jobs/${file.id}/archive`"
                  :aria-label="`Скачать ${file.name}`"
                  download
                  >{{ file.name }}</a
                >
                <h3 v-else class="item-title">{{ file.name }}</h3>
                <p v-if="file.owner" class="item-meta">{{ file.owner }}</p>
                <p class="item-meta">
                  {{
                    file.status === "archiving"
                      ? "Создаётся ZIP"
                      : file.archiveError
                        ? "Ошибка архивации"
                        : size(file.size)
                  }}<span>·</span><ArchiveRetention :job="file" />
                </p>
                <p v-if="file.downloadWarning" class="archive-warning"><AppIcon name="alert" />Загружено с ошибками</p>
                <p v-if="file.archiveError" class="form-error" role="status">
                  {{ file.archiveError }}
                </p>
              </div>
              <div class="archive-actions">
                <button
                  v-if="file.archiveError"
                  class="quiet-button"
                  :disabled="busy"
                  @click="retry(file)"
                >
                  Повторить
                </button>
                <button
                  class="icon-button danger-button"
                  :aria-label="`Удалить ${file.name}`"
                  :disabled="busy || file.status === 'archiving'"
                  @click="confirmDelete(file)"
                >
                  <AppIcon name="trash" />
                </button>
                <button v-if="!management && file.status !== 'archiving' && !file.archiveError" type="button" class="icon-button" :aria-label="`Поделиться: ${file.name}`" @click="sharing = file"><AppIcon name="link" /></button>
                <a
                  v-if="!management && file.status !== 'archiving' && !file.archiveError"
                  class="icon-button"
                  :href="`${baseURL}api/jobs/${file.id}/archive`"
                  :aria-label="`Скачать ZIP: ${file.name}`"
                  download
                  ><AppIcon name="download"
                /></a>
              </div>
            </article>
          </div>
        </div>
      </Transition>
    </div>
  </section>
  <dialog
    ref="dialog"
    class="account-dialog"
    aria-labelledby="delete-archive-title"
    aria-describedby="delete-archive-detail"
    @cancel="busy && $event.preventDefault()"
  >
    <form v-if="selected" @submit.prevent="remove">
      <h2 id="delete-archive-title">Удалить архив?</h2>
      <p class="delete-archive-name">{{ selected.name }}</p>
      <p v-if="selected.owner" class="section-note">
        Пользователь: {{ selected.owner }}
      </p>
      <p id="delete-archive-detail" class="section-note">
        ZIP и оставшиеся временные файлы этой загрузки будут удалены с сервера.
        Скачать их больше не получится. История загрузки сохранится.
      </p>
      <p v-if="dialogError" class="form-error" role="alert">
        {{ dialogError }}
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="quiet-button"
          autofocus
          :disabled="busy"
          @click="dialog?.close()"
        >
          Отмена</button
        ><button class="primary-button destructive-button" :disabled="busy">
          Удалить файлы
        </button>
      </div>
    </form>
  </dialog>
  <ShareArchive v-if="sharing" :job-id="sharing.id" :title="sharing.title" @close="sharing = null" />
</template>

<style scoped>
.archive-warning { display: flex; gap: 6px; align-items: center; color: var(--warning); font-size: 12px; margin-top: 6px; }
.archive-warning .app-icon { width: 16px; height: 16px; }
</style>
