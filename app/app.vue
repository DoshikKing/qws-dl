<script setup lang="ts">
type Job = {
  id: string;
  url: string;
  title?: string | null;
  quality: string;
  status: string;
  createdAt: string;
  log: string;
  error?: string;
  retentionHours: number;
  expiresAt?: string;
  expiredAt?: string;
  deletedAt?: string;
  archiveError?: string;
  hasFiles: boolean;
  cleanupError?: string;
};
type Status = {
  installed: boolean;
  missing: string[];
  ready: boolean;
  quality: string;
  authMode: "web" | "mobile" | "token";
  retentionHours: number;
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
const quality = ref("hifi");
const retentionHours = ref(24);
const status = ref<Status | null>(null);
const credentialNames = computed(() => [
  ...(status.value?.authMode === "token"
    ? ["QOBUZ_USER_ID", "QOBUZ_AUTH_TOKEN"]
    : ["QOBUZ_USERNAME", "QOBUZ_PASSWORD"]),
  ...(status.value?.authMode === "mobile"
    ? ["QOBUZ_APP_ID", "QOBUZ_APP_SECRET"]
    : []),
]);
const jobs = ref<Job[]>([]);
const selectedJob = ref<string | null>(null);
const activeJobs = computed(() =>
  jobs.value.filter((job) =>
    ["queued", "running", "archiving"].includes(job.status),
  ),
);
const availableArchives = computed(() =>
  jobs.value.filter(
    (job) =>
      job.hasFiles &&
      !["running", "queued", "archiving"].includes(job.status) &&
      !job.expiredAt &&
      !job.deletedAt &&
      job.expiresAt &&
      Date.parse(job.expiresAt) > Date.now(),
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
  mediaTypes[job.url.split("/")[3] || ""] || "Qobuz";
const jobTitle = (job: Job) =>
  job.title || `${mediaType(job)} · ${job.url.split("/").pop()}`;
const archiveUrl = (job: Job) => `${baseURL}api/jobs/${job.id}/archive`;
const labels: Record<string, string> = {
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
    const [state, queue, profile] = await Promise.all([
      api<Status>("/api/status"),
      api<Job[]>("/api/jobs"),
      api<Account>("/api/account"),
    ]);
    if (generation !== sessionGeneration) return;
    account.value = profile;
    status.value = state;
    jobs.value = queue;
    if (!authenticated.value) {
      quality.value = state.quality;
      retentionHours.value = state.retentionHours;
    }
    authenticated.value = true;
    error.value = "";
  } catch (e: any) {
    if (generation !== sessionGeneration) return;
    if (e.statusCode === 401) clearAccount();
    else error.value = message(e);
  } finally {
    checking.value = false;
  }
}
async function enterAccount() {
  sessionGeneration++;
  await refresh();
}
function clearAccount() {
  sessionGeneration++;
  url.value = "";
  selectedJob.value = null;
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
    <main v-if="!authenticated" key="login" class="login-screen">
      <div class="login-background" aria-hidden="true"><i /><i /><i /></div>
      <AuthScreen
        :checking="checking"
        :error="error"
        @authenticated="enterAccount"
      />
    </main>

    <div v-else key="application" class="app-shell">
      <aside class="sidebar">
        <a class="app-identity" :href="baseURL" aria-label="QWS — главная">
          <span class="app-mark"><AppIcon name="download" /></span
          ><span>QWS<small>OrpheusDL</small></span>
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
            :class="{ selected: tab === view.id }"
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
        <div class="sidebar-footer">
          <span class="connection-dot" :class="{ ready: status?.ready }" /><span
            >Qobuz</span
          ><small>{{ status?.ready ? "Настроен" : "Не настроен" }}</small>
        </div>
      </aside>

      <main class="main-content">
        <header class="toolbar">
          <span class="toolbar-title">QWS</span
          ><span class="toolbar-service">{{ account?.username }}</span
          ><button type="button" class="toolbar-button" @click="logout">
            <AppIcon name="logout" /><span>Выйти</span>
          </button>
        </header>
        <div class="content">
          <div class="page-heading">
            <h1>{{ pageTitle }}</h1>
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
            v-if="status && !status.ready && tab !== 'settings'"
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

          <Transition name="page" mode="out-in">
            <div :key="tab" class="page-content">
              <template v-if="tab === 'queue'">
                <section
                  class="panel compose-panel"
                  aria-labelledby="new-download"
                >
                  <h2 id="new-download">Новая загрузка</h2>
                  <form @submit.prevent="addJob">
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
                      <div class="field">
                        <label for="retention">Хранить файлы</label
                        ><select id="retention" v-model.number="retentionHours">
                          <option
                            v-for="hours in 24"
                            :key="hours"
                            :value="hours"
                          >
                            {{ hours }} ч
                          </option>
                        </select>
                      </div>
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
                    <p class="field-note">
                      ZIP удалится через {{ retentionHours }} ч после
                      завершения.
                    </p>
                  </form>
                </section>

                <section class="section" aria-labelledby="queue-heading">
                  <div class="section-heading">
                    <h2 id="queue-heading">
                      Задания <span class="item-count">{{ jobs.length }}</span>
                    </h2>
                  </div>
                  <div v-if="!jobs.length" class="empty-state">
                    <AppIcon name="queue" />
                    <h3>Заданий нет</h3>
                    <p>Добавьте ссылку Qobuz.</p>
                  </div>
                  <TransitionGroup
                    v-else
                    name="rows"
                    tag="div"
                    class="panel job-list"
                  >
                    <article
                      v-for="job in jobs"
                      :key="job.id"
                      class="job"
                      :data-status="job.status"
                    >
                      <div class="job-main">
                        <div class="item-icon" :data-status="job.status">
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
                          <a
                            class="item-title"
                            :href="job.url"
                            target="_blank"
                            rel="noreferrer"
                            >{{ jobTitle(job) }}</a
                          >
                          <p class="item-meta">
                            {{ mediaType(job) }}<span>·</span
                            >{{
                              qualities[job.quality]?.split(" · ")[0] ||
                              job.quality
                            }}<span>·</span>{{ date(job.createdAt) }}
                          </p>
                        </div>
                        <span
                          class="status-badge"
                          :data-status="
                            job.archiveError ? 'failed' : job.status
                          "
                          >{{
                            job.archiveError
                              ? "Ошибка архивации"
                              : labels[job.status]
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
                      <p class="job-retention">
                        {{
                          job.deletedAt
                            ? "Удалено администратором"
                            : job.expiredAt
                              ? "Архив удалён"
                              : job.expiresAt
                                ? `Доступны до ${date(job.expiresAt)}`
                                : `Хранение после завершения: ${job.retentionHours} ч`
                        }}
                      </p>
                      <p v-if="job.cleanupError" class="job-error" role="alert">
                        {{ job.cleanupError }}
                      </p>
                      <p v-if="job.archiveError" class="job-error" role="alert">
                        {{ job.archiveError }}
                      </p>
                      <p v-if="job.error" class="job-error" role="status">
                        {{ job.error }}
                      </p>
                      <Transition name="disclosure"
                        ><div
                          v-if="selectedJob === job.id"
                          :id="`log-${job.id}`"
                          class="log-container"
                        >
                          <pre
                            class="log"
                            tabindex="0"
                            aria-label="Журнал задания"
                            >{{ job.log || "Вывода пока нет." }}</pre>
                        </div></Transition
                      >
                    </article>
                  </TransitionGroup>
                </section>
              </template>

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
                        <span>Способ входа</span
                        ><span class="setting-value">{{
                          status?.authMode === "mobile"
                            ? "Мобильный API"
                            : status?.authMode === "token"
                              ? "Браузерная сессия"
                              : "Email и пароль"
                        }}</span>
                      </div>
                      <div
                        v-for="name in credentialNames"
                        :key="name"
                        class="setting-row"
                      >
                        <code>{{ name }}</code
                        ><span
                          class="setting-value"
                          :class="
                            status?.missing.includes(name)
                              ? 'value-warning'
                              : 'value-success'
                          "
                          ><AppIcon
                            :name="
                              status?.missing.includes(name) ? 'alert' : 'check'
                            "
                          />{{
                            status?.missing.includes(name)
                              ? "Не задано"
                              : "Задано"
                          }}</span
                        >
                      </div>
                    </div>
                    <p class="section-note">
                      Параметры задаются в <code>.env</code> на сервере. После
                      изменения перезапустите приложение. Вход в Qobuz
                      проверяется при загрузке.
                    </p>
                    <p v-if="status && !status.installed" class="section-note">
                      Установка: <code>npm run setup:orpheus</code>.
                    </p>
                  </section>
                  <section class="section" aria-labelledby="download-settings">
                    <div class="section-heading">
                      <h2 id="download-settings">Загрузки</h2>
                    </div>
                    <div class="panel settings-list">
                      <div class="setting-row">
                        <span>Качество по умолчанию</span
                        ><span class="setting-value">{{
                          qualities[status?.quality || "hifi"]
                        }}</span>
                      </div>
                      <div class="setting-row">
                        <span>Срок хранения по умолчанию</span
                        ><span class="setting-value"
                          >{{ status?.retentionHours || 24 }} ч</span
                        >
                      </div>
                      <div class="setting-row">
                        <span>Обработка заданий</span
                        ><span class="setting-value">По одному</span>
                      </div>
                    </div>
                    <p class="section-note">
                      ZIP удаляется по истечении выбранного срока. История
                      заданий сохраняется.
                    </p>
                  </section>
                </template>
              </template>
            </div>
          </Transition>
        </div>
      </main>
    </div>
  </Transition>
</template>
