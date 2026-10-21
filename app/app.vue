<script setup lang="ts">
type Job = {
  id: string;
  url: string;
  quality: string;
  status: string;
  createdAt: string;
  log: string;
  error?: string;
  retentionHours: number;
  expiresAt?: string;
  expiredAt?: string;
  hasFiles: boolean;
  cleanupError?: string;
};
type LibraryFile = {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
};
type Status = {
  installed: boolean;
  missing: string[];
  ready: boolean;
  quality: string;
  authMode: "web" | "mobile";
  retentionHours: number;
};
const baseURL = useRuntimeConfig().app.baseURL.replace(/\/?$/, "/");
const api = $fetch.create({ baseURL });
const authenticated = ref(false);
const checking = ref(true);
const password = ref("");
const loginError = ref("");
const busy = ref(false);
const error = ref("");
const tab = ref("queue");
const url = ref("");
const quality = ref("hifi");
const retentionHours = ref(24);
const status = ref<Status | null>(null);
const credentialNames = computed(() => [
  "QOBUZ_USERNAME",
  "QOBUZ_PASSWORD",
  ...(status.value?.authMode === "mobile"
    ? ["QOBUZ_APP_ID", "QOBUZ_APP_SECRET"]
    : []),
]);
const jobs = ref<Job[]>([]);
const files = ref<LibraryFile[]>([]);
const truncated = ref(false);
const selectedJob = ref<string | null>(null);
const search = ref("");
const activeJobs = computed(() =>
  jobs.value.filter((job) => ["queued", "running"].includes(job.status)),
);
const completed = computed(
  () => jobs.value.filter((job) => job.status === "completed").length,
);
const filteredFiles = computed(() =>
  files.value.filter((file) =>
    file.path.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const availableArchives = computed(() =>
  jobs.value.filter(
    (job) =>
      job.hasFiles &&
      !["running", "queued"].includes(job.status) &&
      !job.expiredAt &&
      job.expiresAt &&
      Date.parse(job.expiresAt) > Date.now(),
  ),
);
const archiveUrl = (job: Job) => `${baseURL}api/jobs/${job.id}/archive`;
const labels: Record<string, string> = {
  queued: "В очереди",
  running: "Загружается",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
};
const qualities: Record<string, string> = {
  hifi: "Hi-Res · до 192 кГц / 24 бит",
  lossless: "CD · 44,1 кГц / 16 бит",
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
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

async function refresh() {
  try {
    const [state, queue, library] = await Promise.all([
      api<Status>("/api/status"),
      api<Job[]>("/api/jobs"),
      api<{ files: LibraryFile[]; truncated: boolean }>("/api/files"),
    ]);
    status.value = state;
    jobs.value = queue;
    files.value = library.files;
    truncated.value = library.truncated;
    if (!authenticated.value) {
      quality.value = state.quality;
      retentionHours.value = state.retentionHours;
    }
    authenticated.value = true;
    error.value = "";
  } catch (e: any) {
    if (e.statusCode === 401) authenticated.value = false;
    else error.value = message(e);
  } finally {
    checking.value = false;
  }
}
async function login() {
  busy.value = true;
  loginError.value = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: { password: password.value },
    });
    password.value = "";
    await refresh();
  } catch (e) {
    loginError.value = message(e);
  } finally {
    busy.value = false;
  }
}
async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    authenticated.value = false;
    jobs.value = [];
    files.value = [];
    status.value = null;
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
  <div v-if="!authenticated" class="login-shell">
    <div class="login-art" aria-hidden="true">
      <div class="record">
        <div class="record-label">q<span>ws</span></div>
      </div>
      <p>СОХРАНЯЙТЕ ТО, ЧТО ЗВУЧИТ.</p>
    </div>
    <main class="login-panel">
      <a class="brand" :href="baseURL"
        >qws<span class="brand-dot">.</span><small>ORPHEUS DL</small></a
      >
      <span class="eyebrow">ВАША ЛИЧНАЯ МУЗЫКАЛЬНАЯ БИБЛИОТЕКА</span>
      <h1>Хороший звук.<br /><em>В вашей коллекции.</em></h1>
      <p class="muted">Загрузки из Qobuz, без лишних действий.</p>
      <form class="login-form" @submit.prevent="login">
        <label for="password">Пароль интерфейса</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="Введите WEB_PASSWORD"
          required
          :disabled="checking"
        />
        <p v-if="loginError || error" class="error" role="alert">
          {{ loginError || error }}
        </p>
        <button class="primary" :disabled="busy || checking">
          {{ checking ? "Проверяем сессию…" : busy ? "Входим…" : "Войти →" }}
        </button>
      </form>
      <p class="fine">OrpheusDL + Qobuz · Для вашей личной коллекции</p>
    </main>
  </div>
  <div v-else class="dashboard">
    <aside class="sidebar">
      <a class="brand" :href="baseURL"
        >qws<span class="brand-dot">.</span><small>ORPHEUS DL</small></a
      >
      <div class="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Главное меню">
        <button :class="{ active: tab === 'queue' }" @click="tab = 'queue'">
          <AppIcon name="queue" /> Загрузки
          <b>{{ activeJobs.length }}</b>
        </button>
        <button :class="{ active: tab === 'library' }" @click="tab = 'library'">
          <AppIcon name="library" /> Моя библиотека
        </button>
        <button
          :class="{ active: tab === 'settings' }"
          @click="tab = 'settings'"
        >
          <AppIcon name="settings" /> Настройки
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="service">
          <span class="service-icon">Q</span>
          <div>
            <strong>Qobuz</strong
            ><small
              ><i :class="{ ready: status?.ready }" />{{
                status?.ready ? "Настроен" : "Нужна настройка"
              }}</small
            >
          </div>
        </div>
        <button class="logout" @click="logout">Выйти из интерфейса →</button>
        <div class="sidebar-foot">POWERED BY ORPHEUSDL</div>
      </div>
    </aside>
    <main class="workspace">
      <header>
        <span>ВАША МУЗЫКА. ВАШ АРХИВ.</span>
        <div class="local-badge"><i /> Личное пространство</div>
        <button class="mobile-logout" @click="logout">Выйти</button>
      </header>
      <div class="content">
        <div class="page-heading">
          <div>
            <span class="eyebrow"
              >QWS /
              {{
                tab === "queue"
                  ? "ЗАГРУЗКИ"
                  : tab === "library"
                    ? "БИБЛИОТЕКА"
                    : "НАСТРОЙКИ"
              }}</span
            >
            <h1>
              {{
                tab === "queue"
                  ? "Соберите свою коллекцию"
                  : tab === "library"
                    ? "Ваша библиотека"
                    : "Всё на своих местах"
              }}<span class="brand-dot">.</span>
            </h1>
            <p class="muted">
              {{
                tab === "queue"
                  ? "Любимые релизы — в оригинальном качестве, рядом с вами."
                  : tab === "library"
                    ? "Музыка и материалы, сохранённые на вашем сервере."
                    : "Состояние подключения и параметры загрузки."
              }}
            </p>
          </div>
          <span class="edition">EST. 2026<br />LOSSLESS BY DESIGN</span>
        </div>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <div v-if="status && !status.ready" class="notice warning">
          {{
            !status.installed
              ? "Установите OrpheusDL командой npm run setup:orpheus."
              : `Заполните в .env: ${status.missing.join(", ")}. Затем перезапустите сервер.`
          }}
          <button class="text-button" @click="tab = 'settings'">
            Открыть настройки →
          </button>
        </div>

        <template v-if="tab === 'queue'">
          <section class="download-card">
            <div class="card-top">
              <span class="eyebrow">НОВАЯ ЗАГРУЗКА</span
              ><span class="quality-tag">QOBUZ → ВАША БИБЛИОТЕКА</span>
            </div>
            <h2>Одна ссылка.<br /><span>Чистый звук.</span></h2>
            <form @submit.prevent="addJob">
              <label for="url"
                >Ссылка на трек, альбом, плейлист или исполнителя</label
              >
              <div class="url-input">
                <AppIcon name="link" />
                <input
                  id="url"
                  v-model="url"
                  type="url"
                  placeholder="https://open.qobuz.com/album/…"
                  required
                  maxlength="2048"
                  autocomplete="off"
                />
              </div>
              <div class="form-bottom">
                <div>
                  <label for="quality">Качество загрузки</label
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
                <div>
                  <label for="retention">Хранить файлы</label>
                  <select id="retention" v-model.number="retentionHours">
                    <option v-for="hours in 24" :key="hours" :value="hours">
                      {{ hours }} ч
                    </option>
                  </select>
                </div>
                <button class="primary" :disabled="busy || !status?.ready">
                  {{ busy ? "Добавляем…" : "Добавить в очередь" }}
                  <AppIcon name="download" />
                </button>
              </div>
            </form>
            <div class="card-note">
              <span aria-hidden="true">◈</span> Оригинальные файлы, обложки и
              метаданные от OrpheusDL
            </div>
            <p class="retention-note">
              Файлы и ZIP автоматически удалятся через {{ retentionHours }} ч
              после завершения задания.
            </p>
          </section>
          <div class="stats">
            <div>
              <span>В очереди и в работе</span
              ><strong
                >{{ String(activeJobs.length).padStart(2, "0")
                }}<i class="mint">↙</i></strong
              >
            </div>
            <div>
              <span>Завершено в истории</span
              ><strong>{{ String(completed).padStart(2, "0") }}<i>✓</i></strong>
            </div>
            <div>
              <span>Файлов в библиотеке</span
              ><strong
                >{{ String(files.length).padStart(2, "0") }}<i>▦</i></strong
              >
            </div>
          </div>
          <section class="queue-section">
            <div class="section-heading">
              <h2>
                Очередь загрузок <span>{{ jobs.length }}</span>
              </h2>
              <span class="live"><i /> ОБНОВЛЯЕТСЯ АВТОМАТИЧЕСКИ</span>
            </div>
            <div v-if="!jobs.length" class="empty">
              <div class="empty-icon" aria-hidden="true">↓</div>
              <h3>Здесь начинается ваша коллекция</h3>
              <p>Скопируйте ссылку из Qobuz и добавьте первую загрузку.</p>
              <span>ТРЕКИ · АЛЬБОМЫ · ПЛЕЙЛИСТЫ · ИСПОЛНИТЕЛИ</span>
            </div>
            <article v-for="job in jobs" :key="job.id" class="job">
              <div class="job-main">
                <div class="job-icon" :class="job.status" aria-hidden="true">
                  {{
                    job.status === "completed"
                      ? "✓"
                      : job.status === "running"
                        ? "↓"
                        : "♫"
                  }}
                </div>
                <div class="job-title">
                  <a :href="job.url" target="_blank" rel="noreferrer">{{
                    job.url.replace("https://open.qobuz.com/", "")
                  }}</a
                  ><small
                    >{{ job.quality.toUpperCase() }} <span>·</span>
                    {{ date(job.createdAt) }}</small
                  >
                </div>
                <span class="status" :class="job.status">{{
                  labels[job.status]
                }}</span>
                <a
                  v-if="availableArchives.some((item) => item.id === job.id)"
                  class="zip-link"
                  :href="archiveUrl(job)"
                  download
                  >↓ ZIP</a
                >
                <button
                  class="text-button"
                  :aria-expanded="selectedJob === job.id"
                  @click="selectedJob = selectedJob === job.id ? null : job.id"
                >
                  Журнал</button
                ><button
                  v-if="['queued', 'running'].includes(job.status)"
                  class="cancel"
                  :aria-label="`Отменить ${job.url}`"
                  @click="cancel(job)"
                >
                  ×
                </button>
              </div>
              <p class="job-retention">
                {{
                  job.expiredAt
                    ? "Файлы и архив удалены"
                    : job.expiresAt
                      ? `Файлы доступны до ${date(job.expiresAt)}`
                      : `Хранение: ${job.retentionHours} ч после завершения`
                }}
              </p>
              <p v-if="job.cleanupError" class="job-error" role="alert">
                {{ job.cleanupError }}
              </p>
              <p v-if="job.error" class="job-error" role="status">
                {{ job.error }}
              </p>
              <pre v-if="selectedJob === job.id" class="log" tabindex="0">{{
                job.log || "Ожидание вывода OrpheusDL…"
              }}</pre>
            </article>
          </section>
        </template>

        <section v-else-if="tab === 'library'" class="library">
          <div v-if="availableArchives.length" class="archive-list">
            <h2>Архивы загрузок</h2>
            <a
              v-for="job in availableArchives"
              :key="job.id"
              class="archive-card"
              :href="archiveUrl(job)"
              download
            >
              <div>
                <strong>{{
                  job.url.replace("https://open.qobuz.com/", "")
                }}</strong
                ><small>Доступен до {{ date(job.expiresAt!) }}</small>
              </div>
              <span>Скачать ZIP ↓</span>
            </a>
          </div>
          <p class="library-note">
            Файлы и архивы хранятся выбранное время, максимум 24 часа после
            завершения загрузки. Скачайте их до указанного срока.
          </p>
          <div class="section-heading">
            <h2>
              Сохранённые файлы <span>{{ files.length }}</span>
            </h2>
            <input
              v-model="search"
              type="search"
              aria-label="Поиск файлов"
              placeholder="Найти в библиотеке…"
            />
          </div>
          <p v-if="truncated" class="notice warning">
            Показаны первые 1000 файлов. Полная коллекция доступна в папке
            downloads.
          </p>
          <div v-if="!filteredFiles.length" class="empty">
            <div class="empty-icon" aria-hidden="true">▦</div>
            <h3>
              {{ search ? "Ничего не найдено" : "Место для любимой музыки" }}
            </h3>
            <p>
              {{
                search
                  ? "Попробуйте другое название."
                  : "Загруженные файлы появятся здесь автоматически."
              }}
            </p>
          </div>
          <a
            v-for="file in filteredFiles"
            :key="file.path"
            class="file"
            :href="`${baseURL}api/file?path=${encodeURIComponent(file.path)}`"
            download
            ><span class="file-icon" aria-hidden="true">♫</span>
            <div>
              <strong>{{ file.name }}</strong
              ><small>{{
                file.path.split("/").slice(1, -1).join(" / ") ||
                "Загрузка OrpheusDL"
              }}</small>
            </div>
            <span>{{ size(file.size) }}</span
            ><b aria-hidden="true">↓</b></a
          >
        </section>

        <section v-else class="settings">
          <div class="section-heading">
            <h2>Подключение Qobuz</h2>
            <span
              class="status"
              :class="status?.ready ? 'completed' : 'failed'"
              >{{ status?.ready ? "Настроено" : "Требуется настройка" }}</span
            >
          </div>
          <p class="muted">
            Секреты задаются в файле <code>.env</code> на сервере. После
            изменения перезапустите приложение. Значения не передаются в
            браузер.
          </p>
          <div class="setting-row">
            <span>OrpheusDL + модуль Qobuz</span
            ><strong>{{
              status?.installed ? "Установлены" : "Не установлены"
            }}</strong>
          </div>
          <div class="setting-row">
            <span>Способ входа</span>
            <strong>{{
              status?.authMode === "mobile"
                ? "Мобильный API"
                : "Веб-вход · параметры автоматически"
            }}</strong>
          </div>
          <div v-for="name in credentialNames" :key="name" class="setting-row">
            <code>{{ name }}</code
            ><strong
              :class="status?.missing.includes(name) ? 'missing' : 'configured'"
              >{{
                status?.missing.includes(name) ? "Не задано" : "Задано"
              }}</strong
            >
          </div>
          <div class="setting-row">
            <span>Качество по умолчанию</span
            ><strong>{{ qualities[status?.quality || "hifi"] }}</strong>
          </div>
          <div class="settings-note">
            <h3>Перед первой загрузкой</h3>
            <p>
              Для веб-входа нужны email, обычный пароль и подписка Qobuz с
              доступом к загрузкам. Параметры веб-клиента приложение получает
              автоматически. Ручные app_id / app_secret нужны только для режима
              mobile. Статус «Настроено» означает наличие настроек; вход в Qobuz
              проверяется во время загрузки.
            </p>
            <p>
              Файлы сохраняются в downloads, история — в data. Задания
              выполняются по одному. При перезапуске прерванная загрузка
              отмечается ошибкой, ожидающие задания продолжаются.
            </p>
          </div>
        </section>
        <footer>
          <span>QWS <b>·</b> Ваша музыка остаётся с вами.</span
          ><span>ORPHEUSDL / QOBUZ</span>
        </footer>
      </div>
    </main>
  </div>
</template>
