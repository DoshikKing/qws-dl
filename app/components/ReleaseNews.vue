<script setup lang="ts">
const props = defineProps<{ userId: string }>();
type Release = { id: string; date: string; title: string; summary: string; sections: { title: string; items: string[] }[] };
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL, timeout: 10000, retry: 0 });
const releases = ref<Release[]>([]);
const latest = computed(() => releases.value[0]);
const showToast = ref(false);
const loading = ref(false);
const error = ref('');
const dialog = ref<HTMLDialogElement | null>(null);
const newsButton = ref<HTMLButtonElement | null>(null);
const localRead = new Set<string>();
const storageKey = `qws-news-read:${props.userId}`;
const controller = new AbortController();
let openedVersion: string | undefined;
let disposed = false;
let dismissAfterLoad = false;
let timer: ReturnType<typeof setInterval>;
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) for (const id of saved.slice(-50)) if (typeof id === 'string' && id.length <= 80) localRead.add(id);
  } catch { /* Server-side acknowledgements also work when browser storage is unavailable. */ }
}
async function acknowledge(version: string) {
  localRead.add(version);
  try { localStorage.setItem(storageKey, JSON.stringify([...localRead].slice(-50))); } catch { /* Keep the in-memory and server state. */ }
  try { await api('/api/news/read', { method: 'POST', body: { version }, signal: controller.signal }); }
  catch { /* Retry an unconfirmed dismissal on the next refresh. */ }
}
async function refresh(force = false) {
  if (loading.value || disposed || (!force && dialog.value?.open)) return;
  loading.value = true;
  try {
    const result = await api<{ releases: Release[]; seen: boolean }>('/api/news', { signal: controller.signal });
    if (disposed) return;
    releases.value = result.releases;
    error.value = '';
    const release = latest.value;
    if (release) {
      if (dismissAfterLoad) { dismissAfterLoad = false; localRead.add(release.id); }
      showToast.value = !dialog.value?.open && !result.seen && !localRead.has(release.id);
      if (dialog.value?.open && (!openedVersion || force)) openedVersion = release.id;
      if (!result.seen && localRead.has(release.id)) await acknowledge(release.id);
    }
  } catch {
    if (!disposed) error.value = 'Не удалось загрузить новости. Повторите позже.';
  } finally { loading.value = false; }
}
function openNews() {
  showToast.value = false;
  openedVersion = latest.value?.id;
  // Start loading before opening; an existing initial request will populate the dialog.
  if (!releases.value.length) void refresh();
  dialog.value?.showModal();
}
function closeNews() { dialog.value?.close(); }
function closed() {
  if (disposed) return;
  showToast.value = false;
  if (openedVersion) void acknowledge(openedVersion);
  else if (!releases.value.length) dismissAfterLoad = true;
  openedVersion = undefined;
  newsButton.value?.focus({ preventScroll: true });
}
function dismissToast() {
  const version = latest.value?.id;
  showToast.value = false;
  if (version) void acknowledge(version);
  newsButton.value?.focus({ preventScroll: true });
}
function storageChanged(event: StorageEvent) {
  if (event.key !== storageKey) return;
  readLocal();
  if (latest.value && localRead.has(latest.value.id)) showToast.value = false;
}
function focused() { if (document.visibilityState === 'visible') void refresh(); }
function retry() { void refresh(true); }
onMounted(() => {
  readLocal();
  void refresh();
  timer = setInterval(refresh, 60000);
  window.addEventListener('storage', storageChanged);
  window.addEventListener('focus', focused);
});
onBeforeUnmount(() => {
  disposed = true;
  clearInterval(timer);
  controller.abort();
  window.removeEventListener('storage', storageChanged);
  window.removeEventListener('focus', focused);
  dialog.value?.close();
});
</script>
<template>
  <button ref="newsButton" type="button" class="toolbar-button news-button" aria-haspopup="dialog" aria-controls="release-news" @click="openNews">
    <AppIcon name="news" /><span>Новости</span>
  </button>
  <Teleport to="body">
    <Transition name="news-toast">
      <aside v-if="showToast && latest" class="news-toast" aria-label="Уведомление об обновлении">
        <button type="button" class="news-toast-open" @click="openNews">
          <span class="news-toast-label" role="status">Обновление QWS</span>
          <strong>{{ latest.title }}</strong><span>{{ latest.summary }}</span><span class="news-read-more">Подробнее <AppIcon name="arrow-right" /></span>
        </button>
        <button type="button" class="icon-button news-toast-close" aria-label="Закрыть уведомление об обновлении" @click="dismissToast"><AppIcon name="close" /></button>
      </aside>
    </Transition>
    <dialog id="release-news" ref="dialog" class="account-dialog news-dialog" aria-labelledby="news-heading" @close="closed">
      <header class="news-dialog-heading"><h2 id="news-heading">Новости</h2><button type="button" class="icon-button" aria-label="Закрыть сводку обновлений" autofocus @click="closeNews"><AppIcon name="close" /></button></header>
      <div class="news-dialog-body" :aria-busy="loading">
        <p v-if="loading && !releases.length" role="status">Загрузка новостей…</p>
        <div v-if="error" class="news-error"><p class="form-error" role="alert">{{ error }}</p><button type="button" class="quiet-button" :disabled="loading" @click="retry">Повторить</button></div>
        <article v-for="release in releases" :key="release.id" class="news-release">
          <time :datetime="release.date">{{ date(release.date) }}</time><h3>{{ release.title }}</h3><p>{{ release.summary }}</p>
          <section v-for="section in release.sections" :key="section.title" class="news-section"><h4>{{ section.title }}</h4><ul><li v-for="item in section.items" :key="item">{{ item }}</li></ul></section>
        </article>
      </div>
      <footer class="news-dialog-footer"><button type="button" class="primary-button" @click="closeNews">Понятно</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.news-button { flex-shrink: 0; }
.news-toast { position: fixed; z-index: 60; inset-inline-end: 24px; bottom: 24px; width: 360px; max-width: calc(100vw - 32px); border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--text); box-shadow: 0 8px 24px rgb(0 0 0 / 12%); }
.news-toast-open { display: grid; gap: 8px; width: 100%; padding: 20px 52px 20px 20px; text-align: start; color: inherit; border-radius: 12px; font-size: 14px; line-height: 1.5; }
.news-toast-open, .news-dialog-body { overflow-wrap: anywhere; }
.news-toast-open strong { font-weight: 500; }
.news-toast-label { color: var(--secondary); font-size: 12px; }
.news-read-more { display: flex; align-items: center; gap: 8px; color: var(--accent); }
.news-read-more .app-icon { width: 16px; height: 16px; }
.news-toast-close { position: absolute; inset-inline-end: 4px; top: 4px; }
.news-dialog { width: 680px; padding: 0; border-radius: 12px; }
.news-dialog[open] { display: flex; flex-direction: column; }
.news-dialog-heading, .news-dialog-footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; }
.news-dialog-heading { border-bottom: 1px solid var(--line); }
.news-dialog-heading h2 { margin: 0; font-size: 20px; font-weight: 500; }
.news-dialog-body { overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 24px; font-size: 15px; line-height: 1.65; }
.news-release + .news-release { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--line); }
.news-release time { color: var(--secondary); font-size: 13px; }
.news-release h3 { margin: 8px 0 12px; font-size: 20px; font-weight: 500; }
.news-release p { margin: 0 0 24px; color: var(--secondary); }
.news-section + .news-section { margin-top: 24px; }
.news-section h4 { margin: 0 0 8px; font-size: 16px; font-weight: 500; }
.news-section ul { margin: 0; padding-inline-start: 20px; }
.news-section li + li { margin-top: 12px; }
.news-dialog-footer { justify-content: flex-end; border-top: 1px solid var(--line); }
.news-error { margin-bottom: 16px; }
.news-toast-enter-active, .news-toast-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.news-toast-enter-from, .news-toast-leave-to { opacity: 0; transform: translateY(8px); }
@media (max-width: 760px) {
  .news-toast { inset-inline-end: 16px; bottom: calc(88px + env(safe-area-inset-bottom)); }
  .news-dialog-heading, .news-dialog-footer { padding: 12px 16px; }
  .news-dialog-body { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { .news-toast-enter-active, .news-toast-leave-active { transition: none; } }
</style>
