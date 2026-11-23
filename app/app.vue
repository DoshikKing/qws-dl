<script setup lang="ts">
import { describeFormat, normalizeFormatOptions } from "#shared/audio-formats.mjs";
type Job = {
  id: string;
  kind?: string;
  url: string;
  title?: string | null;
  quality: string;
  outputFormat?: string;
  formatOptions?: Record<string, string | number>;
  status: string;
  createdAt: string;
  log: string;
  error?: string;
  retentionHours: number;
  retentionMode?: string;
  downloadLimit?: number;
  downloadRetentionHours?: number;
  downloadCount?: number;
  lyrics?: boolean;
  expiresAt?: string | null;
  expiredAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  archiveError?: string;
  downloadWarning?: boolean;
  trackFailureOnly?: boolean;
  hasFiles: boolean;
  cleanupError?: string;
};
type Status = {
  installed: boolean;
  missing: string[];
  ready: boolean;
  quality: string;
  retentionHours: number;
  retentionMode?: string;
  downloadLimit?: number;
  downloadRetentionHours?: number;
  downloadCount?: number;
  lyrics?: boolean;
  oauthConnected: boolean;
  sessionNeedsLogin: boolean;
  lastRefreshedAt: string | null;
};
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/?$/, "/");
const api = $fetch.create({ baseURL });
type Account = {
  id: string;
  username: string;
  role: string;
  inviteCode: string;
  invitedCount: number;
  inviteLimit: number | null;
  invitesRemaining: number | null;
};
const account = ref<Account | null>(null);
const views = computed(() => [
  { id: "queue", label: "Загрузки", icon: "queue" },
  { id: "library", label: "Архивы", icon: "archive" },
  { id: "lyrics", label: "Тексты", icon: "music" },
  { id: "settings", label: "Настройки", icon: "settings" },
  ...(account.value?.role === "admin"
    ? [
        { id: "users", label: "Пользователи", icon: "users" },
        { id: "storage", label: "Хранилище", icon: "library" },
      ]
    : []),
]);
const authenticated = ref(false);
const checking = ref(true);
const busy = ref(false);
const error = ref("");
const tab = ref("queue");
const pageTitle = computed(
  () => views.value.find((view) => view.id === tab.value)?.label || "Загрузки",
);
const url = ref("");
const inputMode = ref<"link" | "search">("link");
const quality = ref("hifi");
const retentionHours = ref(24);
const outputFormat = ref('original');
const formatSettings = ref<Record<string, Record<string, string | number>>>({});
const retentionMode = ref('time');
const downloadLimit = ref(1);
const lyrics = ref(false);
const status = ref<Status | null>(null);
const qobuzResult = ref('');
const jobs = ref<Job[]>([]);
const selectedJob = ref<string | null>(null);
const activeJobs = computed(() =>
  jobs.value.filter((job) =>
    ["queued", "uploading", "running", "archiving"].includes(job.status),
  ),
);
const queueFilter = ref('all');
const queueFilters = [
  { id: 'all', label: 'Все задания' },
  { id: 'active', label: 'В работе' },
  { id: 'errors', label: 'С ошибками' },
];
const visibleJobs = computed(() => jobs.value.filter(job => queueFilter.value === 'all' ||
  (queueFilter.value === 'active' ? ['queued', 'uploading', 'running', 'archiving'].includes(job.status) : job.status === 'failed' || !!job.archiveError)));
const descriptions: Record<string, string> = {
  queue: 'Загрузка треков и альбомов Qobuz в выбранном качестве.',
  library: 'ZIP-архивы ваших загрузок и время их хранения.',
  lyrics: 'Текст песни в тегах аудиофайла и рядом в формате .lrc.',
  settings: 'Аккаунт, приглашения и подключение к Qobuz.',
  users: 'Аккаунты, приглашения и доступ к сервису.',
  storage: 'Архивы всех пользователей и управление хранением.',
};
const availableArchives = computed(() =>
  jobs.value.filter(
    (job) =>
      job.hasFiles &&
      !["running", "queued", "archiving"].includes(job.status) &&
      !job.expiredAt &&
      !job.deletedAt &&
      (job.retentionMode !== 'downloads' || (job.downloadCount || 0) < (job.downloadLimit || 1)) && job.expiresAt && Date.parse(job.expiresAt) > Date.now(),
  ),
);
const mediaTypes: Record<string, string> = {
  track: "Трек",
  album: "Альбом",
  playlist: "Плейлист",
  artist: "Исполнитель",
  interpreter: "Исполнитель",
};
const mediaType = (job: Job) =>
  job.kind === "lyrics-upload" ? "Свой файл" : mediaTypes[job.url.split("/")[3] || ""] || "Qobuz";
const jobTitle = (job: Job) =>
  job.title || `${mediaType(job)} · ${job.url.split("/").pop()}`;
const archiveUrl = (job: Job) => `${baseURL}api/jobs/${job.id}/archive`;
const labels: Record<string, string> = {
  uploading: "Файл загружается",
  queued: "В очереди",
  running: "Загружается",
  archiving: "Создаётся ZIP",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
};
const qualities: Record<string, string> = {
  hifi: "FLAC · до 192 кГц / 24 бит",
  lossless: "FLAC · 44,1 кГц / 16 бит",
  high: "MP3 · 320 кбит/с",
};
const message = (e: any) =>
  e.data?.statusMessage ||
  e.statusMessage ||
  "Не удалось связаться с сервером.";
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
let sessionGeneration = 0;
async function refresh() {
  const generation = sessionGeneration;
  try {
    const profile = await api<Account>("/api/account");
    if (generation !== sessionGeneration) return;
    const entering = !authenticated.value;
    account.value = profile;
    authenticated.value = true;
    const [state, queue] = await Promise.all([
      api<Status>("/api/status"),
      api<Job[]>("/api/jobs"),
    ]);
    if (generation !== sessionGeneration) return;
    const previous = status.value;
    const useDefaults = entering || (previous && quality.value === previous.quality && retentionHours.value === previous.retentionHours &&
      retentionMode.value === (previous.retentionMode || 'time') && downloadLimit.value === (previous.downloadLimit || 1) && lyrics.value === (previous.lyrics === true));
    status.value = state;
    jobs.value = queue;
    if (entering) { outputFormat.value = 'original'; formatSettings.value = {}; }
    if (useDefaults) {
      quality.value = state.quality;
      retentionHours.value = state.retentionHours;
      retentionMode.value = state.retentionMode || 'time';
      downloadLimit.value = state.downloadLimit || 1;
      lyrics.value = state.lyrics === true;
    }
    error.value = "";
  } catch (e: any) {
    if (generation !== sessionGeneration) return;
    if (e.statusCode === 401) clearAccount();
    else error.value = message(e);
  } finally {
    checking.value = false;
  }
}
async function defaultsSaved() {
  await refresh();
  if (!status.value) return;
  quality.value = status.value.quality;
  retentionHours.value = status.value.retentionHours;
  retentionMode.value = status.value.retentionMode || 'time';
  downloadLimit.value = status.value.downloadLimit || 1;
  lyrics.value = status.value.lyrics === true;
}
async function enterAccount() {
  sessionGeneration++;
  await refresh();
}
function clearAccount() {
  sessionGeneration++;
  url.value = "";
  selectedJob.value = null;
  queueFilter.value = 'all';
  authenticated.value = false;
  account.value = null;
  jobs.value = [];
  status.value = null;
  tab.value = "queue";
  error.value = "";
}
async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    clearAccount();
  } catch (e) {
    error.value = message(e);
  }
}
async function addJob() {
  busy.value = true;
  try {
    await api("/api/jobs", {
      method: "POST",
      body: {
        url: url.value,
        quality: quality.value,
        retentionHours: retentionHours.value,
        retentionMode: retentionMode.value, downloadLimit: downloadLimit.value, outputFormat: outputFormat.value,
        formatOptions: normalizeFormatOptions(outputFormat.value, formatSettings.value[outputFormat.value] || {}),
        lyrics: lyrics.value,
      },
    });
    url.value = "";
    tab.value = "queue";
    await refresh();
  } catch (e) {
    error.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function cancel(job: Job) {
  try {
    await api(`/api/jobs/${job.id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    error.value = message(e);
  }
}
async function retryArchive(job: Job) {
  busy.value = true;
  try {
    await api(`/api/jobs/${job.id}/archive`, { method: "POST" });
    await refresh();
  } catch (e) {
    error.value = message(e);
  } finally {
    busy.value = false;
  }
}
let timer: ReturnType<typeof setInterval>;
let refreshing = false;
onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get('qobuz');
  if (outcome === 'connected' || outcome === 'failed') {
    qobuzResult.value = outcome;
    tab.value = 'settings';
    params.delete('qobuz');
    window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params : '') + window.location.hash);
  }
  await refresh();
  timer = setInterval(async () => {
    if (!authenticated.value || refreshing) return;
    refreshing = true;
    try {
      await refresh();
    } finally {
      refreshing = false;
    }
  }, 3000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <Transition name="screen" mode="out-in">
    <main v-if="checking" key="checking" class="startup-screen" aria-busy="true">
      <span class="spinner" aria-hidden="true" />
      <span role="status">Загрузка…</span>
    </main>
    <main v-else-if="!authenticated" key="login" class="login-screen">
      <div class="auth-shell">
        <div class="auth-brand"><span class="app-mark record-mark" aria-hidden="true" /><span>QWS<small>Загрузки и архивы</small></span></div>
      <AuthScreen
        :checking="checking"
        :error="error"
        @authenticated="enterAccount"
      />
      </div>
    </main>

    <div v-else key="application" class="app-shell">
      <a class="skip-link" href="#main-content">К содержимому</a>
      <aside class="sidebar">
        <a class="app-identity" :href="baseURL" aria-label="QWS — главная">
          <span class="app-mark record-mark" aria-hidden="true" /><span>QWS<small>Музыкальная библиотека</small></span>
        </a>
        <nav
          class="navigation"
          aria-label="Разделы"
          :style="{ '--nav-count': views.length }"
        >
          <button
            v-for="view in views"
            :key="view.id"
            type="button"
            :class="{ selected: tab === view.id, 'admin-nav-start': view.id === 'users' }"
            :aria-current="tab === view.id ? 'page' : undefined"
            :aria-label="view.label"
            @click="tab = view.id"
          >
            <AppIcon :name="view.icon" /><span
              :class="{ 'nav-label-wide': view.id === 'users' }"
              >{{ view.label }}</span
            ><span
              v-if="view.id === 'users'"
              class="nav-label-compact"
              aria-hidden="true"
              >Аккаунты</span
            >
            <span
              v-if="view.id === 'queue' && activeJobs.length"
              class="nav-count"
              >{{ activeJobs.length }}</span
            >
          </button>
        </nav>
      </aside>

      <main id="main-content" class="main-content" tabindex="-1">
        <header class="toolbar">
          <span class="toolbar-title"><AppIcon name="music" />Музыкальная библиотека</span>
          <ReleaseNews v-if="account" :key="account.id" :user-id="account.id" />
          <span class="account-avatar" aria-hidden="true">{{ account?.username.slice(0, 1).toUpperCase() }}</span>
          <span class="toolbar-service">{{ account?.username }}<small>{{ account?.role === 'admin' ? 'Администратор' : 'Пользователь' }}</small></span
          ><button type="button" class="toolbar-button" @click="logout">
            <AppIcon name="logout" /><span>Выйти</span>
          </button>
        </header>
        <div class="content">
          <div class="page-heading">
            <div><h1>{{ pageTitle }}</h1><p class="page-description">{{ descriptions[tab] }}</p></div>
            <span
              v-if="tab === 'queue' && activeJobs.length"
              class="heading-detail"
              >В работе: {{ activeJobs.length }}</span
            >
          </div>
          <Transition name="notice"
            ><div v-if="error" class="notice notice-error" role="alert">
              <AppIcon name="alert" />
              <p>{{ error }}</p>
              <button
                class="icon-button"
                aria-label="Закрыть сообщение"
                @click="error = ''"
              >
                <AppIcon name="close" />
              </button></div
          ></Transition>
          <div
            v-if="status && !status.ready && tab !== 'settings' && tab !== 'lyrics'"
            class="notice notice-warning"
            role="status"
          >
            <AppIcon name="alert" />
            <p>
              {{
                account?.role !== "admin"
                  ? "Загрузки недоступны. Обратитесь к администратору."
                  : status.installed
                    ? "Qobuz не настроен."
                    : "OrpheusDL не установлен."
              }}
            </p>
            <button
              v-if="account?.role === 'admin'"
              class="text-button"
              @click="tab = 'settings'"
            >
              Настройки
            </button>
          </div>

          <div class="view-frame">
            <Transition name="view" @before-leave="(element) => element.setAttribute('inert', '')">
              <div :key="tab" class="page-content">
                <template v-if="tab === 'queue'">
                  <section
                    class="panel compose-panel"
                    aria-labelledby="new-download"
                  >
                    <div class="compose-heading">
                      <h2 id="new-download">Новая загрузка</h2>
                      <div
                        class="input-mode"
                        role="group"
                        aria-label="Способ добавления"
                      >
                        <button
                          type="button"
                          :aria-pressed="inputMode === 'link'"
                          @click="inputMode = 'link'"
                        >
                          По ссылке</button
                        ><button
                          type="button"
                          :aria-pressed="inputMode === 'search'"
                          @click="inputMode = 'search'"
                        >
                          Поиск Qobuz
                        </button>
                      </div>
                    </div>
                    <form v-if="inputMode === 'link'" @submit.prevent="addJob">
                      <div class="field">
                        <label for="url">Ссылка Qobuz</label>
                        <div class="input-with-icon">
                          <AppIcon name="link" /><input
                            id="url"
                            v-model="url"
                            type="url"
                            placeholder="https://play.qobuz.com/album/…"
                            required
                            maxlength="2048"
                            autocomplete="off"
                          />
                        </div>
                      </div>
                      <OutputFormat prefix="download" v-model="outputFormat" v-model:settings="formatSettings" :disabled="busy" />
                      <div class="form-options">
                        <div class="field">
                          <label for="quality">Качество</label
                          ><select id="quality" v-model="quality">
                            <option
                              v-for="(label, value) in qualities"
                              :key="value"
                              :value="value"
                            >
                              {{ label }}
                            </option>
                          </select>
                        </div>
                        <RetentionOptions prefix="retention" v-model:mode="retentionMode" v-model:hours="retentionHours" v-model:downloads="downloadLimit" :disabled="busy" />
                        <button
                          class="primary-button"
                          :disabled="busy || !status?.ready"
                        >
                          <span
                            v-if="busy"
                            class="spinner"
                            aria-hidden="true"
                          /><AppIcon v-else name="plus" />{{
                            busy ? "Добавление…" : "Добавить в очередь"
                          }}
                        </button>
                      </div>
                      <label class="lyrics-option">
                        <input v-model="lyrics" type="checkbox" :disabled="busy" />
                        <span>Добавлять тексты песен<span class="field-note">Синхронизированный текст и файл .lrc, если найдены.</span></span>
                      </label>
                      <p class="field-note">
                        {{ retentionMode === 'downloads' ? `ZIP удалится после ${downloadLimit} скачиваний или через ${status?.downloadRetentionHours || 168} ч — что наступит раньше.` : `ZIP удалится через ${retentionHours} ч после завершения.` }}
                      </p>
                    </form>
                    <QobuzSearch :download-retention-hours="status?.downloadRetentionHours || 168"
                      v-else
                      v-model:lyrics="lyrics"
                      v-model:quality="quality"
                      v-model:output-format="outputFormat"
                      v-model:format-settings="formatSettings"
                      v-model:retention-hours="retentionHours"
                      v-model:retention-mode="retentionMode"
                      v-model:download-limit="downloadLimit"
                      :qualities="qualities"
                      :disabled="!status?.ready"
                      @queued="refresh"
                    />
                  </section>

                  <section class="section" aria-labelledby="queue-heading">
                    <div class="section-heading">
                      <h2 id="queue-heading">
                        Задания <span class="item-count">{{ jobs.length }}</span>
                      </h2>
                    </div>
                    <div v-if="jobs.length" class="queue-filters" role="group" aria-label="Фильтр заданий">
                      <button v-for="filter in queueFilters" :key="filter.id" type="button" :aria-pressed="queueFilter === filter.id" @click="queueFilter = filter.id">{{ filter.label }}</button>
                    </div>
                    <div v-if="!jobs.length" class="empty-state">
                      <AppIcon name="queue" />
                      <h3>Заданий нет</h3>
                      <p>
                        {{
                          inputMode === "search"
                            ? "Выберите треки и добавьте их в очередь."
                            : "Добавьте ссылку Qobuz."
                        }}
                      </p>
                    </div>
                    <p v-else-if="!visibleJobs.length" class="queue-filter-empty" role="status">{{ queueFilter === 'active' ? 'Сейчас нет заданий в работе' : 'Заданий с ошибками нет' }}</p>
                    <TransitionGroup
                      v-else
                      name="rows"
                      tag="div"
                      class="panel job-list"
                    >
                      <article
                        v-for="job in visibleJobs"
                        :key="job.id"
                        class="job"
                        :data-status="job.status"
                      >
                        <div class="job-main">
                          <div class="item-icon" :data-status="job.archiveError ? 'failed' : job.downloadWarning ? 'warning' : job.status">
                            <span
                              v-if="['running', 'archiving'].includes(job.status)"
                              class="spinner"
                            /><AppIcon
                              v-else
                              :name="
                                job.archiveError
                                  ? 'alert'
                                  : job.status === 'completed'
                                    ? 'check'
                                    : job.status === 'failed'
                                      ? 'alert'
                                      : job.status === 'cancelled'
                                        ? 'close'
                                        : 'download'
                              "
                            />
                          </div>
                          <div class="item-description">
                            <strong v-if="job.kind === 'lyrics-upload'" class="item-title">{{ jobTitle(job) }}</strong>
                            <a
                              v-else
                              class="item-title"
                              :href="job.url"
                              target="_blank"
                              rel="noreferrer"
                              >{{ jobTitle(job) }}</a
                            >
                            <p class="item-meta">
                              {{ mediaType(job) }}<span>·</span
                              >{{
                                job.kind === 'lyrics-upload' ? 'Текст' : qualities[job.quality]?.split(" · ")[0] ||
                                job.quality
                              }}<span>·</span>{{ date(job.createdAt) }}
                            </p>
                          </div>
                          <span
                            class="status-badge"
                            :data-status="
                              job.archiveError ? 'failed' : job.downloadWarning ? 'warning' : job.status
                            "
                            >{{
                              job.archiveError
                                ? "Ошибка архивации"
                                : job.downloadWarning ? "Загружено с ошибками" : labels[job.status]
                            }}</span
                          >
                          <div class="job-actions">
                            <a
                              v-if="
                                availableArchives.some(
                                  (item) => item.id === job.id,
                                )
                              "
                              class="quiet-button"
                              :href="archiveUrl(job)"
                              :aria-label="`Скачать ZIP: ${jobTitle(job)}`"
                              download
                              ><AppIcon name="download" /><span>ZIP</span></a
                            >
                            <button
                              v-if="
                                job.archiveError &&
                                !job.deletedAt &&
                                !job.expiredAt
                              "
                              type="button"
                              class="quiet-button"
                              :disabled="busy"
                              @click="retryArchive(job)"
                            >
                              Повторить архивацию
                            </button>
                            <button
                              type="button"
                              class="quiet-button"
                              :aria-expanded="selectedJob === job.id"
                              :aria-controls="`log-${job.id}`"
                              @click="
                                selectedJob =
                                  selectedJob === job.id ? null : job.id
                              "
                            >
                              <AppIcon name="terminal" /><span>Журнал</span>
                            </button>
                            <button
                              v-if="['queued', 'running'].includes(job.status)"
                              type="button"
                              class="icon-button cancel-button"
                              :aria-label="`Отменить ${jobTitle(job)}`"
                              @click="cancel(job)"
                            >
                              <AppIcon name="close" />
                            </button>
                          </div>
                        </div>
                        <p v-if="job.outputFormat && job.outputFormat !== 'original'" class="item-meta">Формат: {{ describeFormat(job.outputFormat, job.formatOptions || {}) }}</p>
                        <p class="job-retention"><ArchiveRetention :job="job" /></p>
                        <p v-if="job.cleanupError" class="job-error" role="alert">
                          {{ job.cleanupError }}
                        </p>
                        <p v-if="job.archiveError" class="job-error" role="alert">
                          {{ job.archiveError }}
                        </p>
                        <p v-if="job.error && !job.trackFailureOnly" class="job-error" role="status">
                          {{ job.error }}
                        </p>
                        <AlbumTracks
                          v-if="job.kind !== 'lyrics-upload' && job.url.includes('/album/')"
                          :job-id="job.id" :status="job.status" :ready="status?.ready || false"
                          @queued="refresh"
                        />
                        <DisclosurePanel :id="`log-${job.id}`" :open="selectedJob === job.id">
                          <div class="log-container"><JobLog :log="job.log" /></div>
                        </DisclosurePanel>
                      </article>
                    </TransitionGroup>
                  </section>
                </template>

                <LyricsUpload
                  v-else-if="tab === 'lyrics'"
                  :jobs="jobs.filter(job => job.kind === 'lyrics-upload')"
                  :download-retention-hours="status?.downloadRetentionHours || 168" :default-mode="status?.retentionMode || 'time'" :default-downloads="status?.downloadLimit || 1" :default-hours="Math.min(status?.retentionHours || 1, 5)"
                  @changed="refresh"
                />
                <ArchiveLibrary
                  v-else-if="tab === 'library'"
                  @changed="refresh"
                />
                <ArchiveLibrary
                  v-else-if="tab === 'storage' && account?.role === 'admin'"
                  management
                  @changed="refresh"
                />

                <UserManagement
                  v-else-if="tab === 'users' && account?.role === 'admin'"
                />
                <template v-else>
                  <AccountSettings v-if="account" :account="account" />
                  <template v-if="account?.role === 'admin'">
                    <section class="section" aria-labelledby="qobuz-settings">
                      <div class="section-heading">
                        <h2 id="qobuz-settings">Qobuz</h2>
                        <span
                          class="status-badge"
                          :data-status="status?.ready ? 'completed' : 'failed'"
                          >{{ status?.ready ? "Настроен" : "Не настроен" }}</span
                        >
                      </div>
                      <QobuzConnection :connected="status?.oauthConnected || false" :result="qobuzResult" :needs-login="status?.sessionNeedsLogin || false" />
                      <div class="panel settings-list">
                        <div class="setting-row">
                          <span>OrpheusDL и модуль Qobuz</span
                          ><span
                            class="setting-value"
                            :class="{ 'value-success': status?.installed }"
                            >{{
                              status?.installed ? "Установлены" : "Не установлены"
                            }}</span
                          >
                        </div>
                        <div class="setting-row">
                          <span>Способ входа</span><span class="setting-value">Сайт Qobuz</span>
                        </div>
                        <div v-if="status?.lastRefreshedAt" class="setting-row">
                          <span>Сессия обновлена</span><span class="setting-value">{{ date(status.lastRefreshedAt) }}</span>
                        </div>
                      </div>
                      <p class="section-note">
                        Сессия обновляется автоматически. Если Qobuz запросит
                        повторную проверку, войдите снова на сайте сервиса.
                      </p>
                      <p v-if="status && !status.installed" class="section-note">
                        Установка: <code>npm run setup:orpheus</code>.
                      </p>
                    </section>
                    <AppDefaults @saved="defaultsSaved" />
                  </template>
                </template>
              </div>
            </Transition>
          </div>
        </div>
      </main>
    </div>
  </Transition>
</template>
