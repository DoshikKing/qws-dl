<script setup lang="ts">
type Archive = {
  id: string;
  name: string;
  title: string;
  size: number;
  status: string;
  archiveError: string | null;
  expiresAt: string;
  owner?: string;
};
const props = defineProps<{ management?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/?$/, "/");
const api = $fetch.create({ baseURL });
const files = ref<Archive[]>([]);
const search = ref("");
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
let timer: ReturnType<typeof setInterval>;
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
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 3000);
});
onBeforeUnmount(() => clearInterval(timer));
async function confirmDelete(file: Archive) {
  selected.value = file;
  dialogError.value = "";
  await nextTick();
  dialog.value?.showModal();
}
async function remove() {
  if (!selected.value) return;
  busy.value = true;
  dialogError.value = "";
  try {
    await api(`/api/admin/downloads/${selected.value.id}`, {
      method: "DELETE",
    });
    notice.value = `Удалено: ${selected.value.name}`;
    dialog.value?.close();
    await refresh();
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
      <div class="search-control">
        <AppIcon name="search" /><input
          v-model="search"
          type="search"
          aria-label="Поиск архивов"
          placeholder="Поиск"
        />
      </div>
    </div>
    <p class="section-note">
      {{
        management
          ? "Архивы всех пользователей. Удаление освободит место; история загрузок сохранится."
          : "Срок хранения — до 24 часов после завершения загрузки."
      }}
    </p>
    <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="section-note archive-notice" role="status">
      {{ notice }}
    </p>
    <p v-if="loading" class="section-note" role="status">Загрузка…</p>
    <div v-else-if="!filtered.length" class="empty-state">
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
            }}<span>·</span>До {{ date(file.expiresAt) }}
          </p>
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
            v-if="management"
            class="icon-button danger-button"
            :aria-label="`Удалить ${file.name}`"
            :disabled="busy || file.status === 'archiving'"
            @click="confirmDelete(file)"
          >
            <AppIcon name="trash" />
          </button>
          <a
            v-else-if="file.status !== 'archiving' && !file.archiveError"
            class="icon-button"
            :href="`${baseURL}api/jobs/${file.id}/archive`"
            :aria-label="`Скачать ZIP: ${file.name}`"
            download
            ><AppIcon name="download"
          /></a>
        </div>
      </article>
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
</template>
