<script setup lang="ts">
type Track = {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  streamable: boolean;
};
type Results = {
  tracks: Track[];
  total: number;
  offset: number;
  hasMore: boolean;
};
const props = defineProps<{
  disabled: boolean;
  qualities: Record<string, string>;
}>();
const quality = defineModel<string>("quality", { required: true });
const retention = defineModel<number>("retentionHours", { required: true });
const emit = defineEmits<{ queued: [] }>();
const api = $fetch.create({
  baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, "/"),
});
const query = ref("");
const searchedQuery = ref("");
const tracks = ref<Track[]>([]);
const selected = ref<string[]>([]);
const queued = ref<string[]>([]);
const total = ref(0);
const offset = ref(0);
const hasMore = ref(false);
const searched = ref(false);
const searching = ref(false);
const adding = ref(false);
const added = ref(0);
const error = ref("");
const notice = ref("");
const busy = computed(() => searching.value || adding.value);
const available = computed(() =>
  tracks.value.filter(
    (track) => track.streamable && !queued.value.includes(track.id),
  ),
);
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const message = (e: any) =>
  e.data?.statusMessage || "Не удалось связаться с сервером.";
let controller: AbortController | null = null;
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
});
async function search(more = false) {
  const text = more ? searchedQuery.value : query.value.trim();
  if (!text || busy.value) return;
  searching.value = true;
  error.value = notice.value = "";
  controller = new AbortController();
  if (!more) {
    tracks.value = [];
    selected.value = [];
    queued.value = [];
    searched.value = false;
  }
  try {
    const result = await api<Results>("/api/search", {
      method: "POST",
      body: { query: text, offset: more ? offset.value + 20 : 0 },
      signal: controller.signal,
    });
    const known = new Set(tracks.value.map((track) => track.id));
    tracks.value.push(
      ...result.tracks.filter((track) => {
        if (known.has(track.id)) return false;
        known.add(track.id);
        return true;
      }),
    );
    searchedQuery.value = text;
    offset.value = result.offset;
    total.value = result.total;
    hasMore.value = result.hasMore;
    searched.value = true;
  } catch (e) {
    if (!controller.signal.aborted) error.value = message(e);
  } finally {
    searching.value = false;
  }
}
function selectAvailable() {
  selected.value = selected.value.length
    ? []
    : available.value.slice(0, 50).map((track) => track.id);
}
async function addSelected() {
  if (!selected.value.length || busy.value) return;
  const ids = [...selected.value];
  adding.value = true;
  added.value = 0;
  error.value = notice.value = "";
  try {
    for (const id of ids) {
      if (disposed) break;
      const track = tracks.value.find((track) => track.id === id)!;
      await api("/api/jobs", {
        method: "POST",
        body: {
          url: track.url,
          quality: quality.value,
          retentionHours: retention.value,
        },
      });
      queued.value.push(id);
      selected.value = selected.value.filter((value) => value !== id);
      added.value++;
    }
  } catch (e) {
    error.value = message(e);
  } finally {
    if (added.value && !disposed) {
      notice.value = `Добавлено в очередь: ${added.value}.`;
      emit("queued");
    }
    adding.value = false;
  }
}
</script>
<template>
  <div class="qobuz-search">
    <form class="catalog-search-form" @submit.prevent="search()">
      <div class="field">
        <label for="catalog-query">Название песни или исполнитель</label>
        <div class="input-with-icon">
          <AppIcon name="search" /><input
            id="catalog-query"
            v-model="query"
            type="search"
            placeholder="Песня или исполнитель"
            required
            maxlength="200"
            autocomplete="off"
            :disabled="busy"
          />
        </div>
      </div>
      <button
        class="primary-button"
        :disabled="busy || disabled || !query.trim()"
      >
        <span v-if="searching" class="spinner" aria-hidden="true" /><AppIcon
          v-else
          name="search"
        />{{ searching ? "Поиск…" : "Найти" }}
      </button>
    </form>
    <p v-if="error" class="form-error search-message" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="form-success search-message" role="status">
      {{ notice }}
    </p>
    <template v-if="searched">
      <div class="catalog-heading">
        <h3 id="search-results-heading">
          Результаты <span class="item-count">{{ total }}</span>
        </h3>
        <button
          v-if="available.length"
          type="button"
          class="text-button"
          :disabled="busy"
          @click="selectAvailable"
        >
          {{ selected.length ? "Снять выбор" : "Выбрать доступные" }}
        </button>
      </div>
      <div v-if="!tracks.length" class="empty-state">
        <AppIcon name="search" />
        <h3>Ничего не найдено</h3>
        <p>Измените запрос.</p>
      </div>
      <div
        v-else
        class="catalog-results"
        role="group"
        aria-labelledby="search-results-heading"
        :aria-busy="searching"
      >
        <article v-for="track in tracks" :key="track.id" class="catalog-result">
          <label class="catalog-choice"
            ><input
              v-model="selected"
              type="checkbox"
              :value="track.id"
              :aria-label="`Выбрать ${track.artist} - ${track.title}`"
              :disabled="
                busy ||
                !track.streamable ||
                queued.includes(track.id) ||
                (selected.length >= 50 && !selected.includes(track.id))
              "
            /><span class="item-description"
              ><strong class="item-title">{{ track.title }}</strong
              ><span class="item-meta">{{ track.artist }}</span
              ><span class="item-meta"
                >{{ track.album }}<span v-if="track.album">·</span
                >{{ duration(track.duration) }}</span
              ><span v-if="!track.streamable" class="item-meta"
                >Недоступно для скачивания</span
              ><span v-else-if="queued.includes(track.id)" class="form-success"
                >Добавлено</span
              ></span
            ></label
          >
          <a
            class="icon-button"
            :href="track.url"
            target="_blank"
            rel="noreferrer"
            :aria-label="`Открыть в Qobuz: ${track.artist} - ${track.title}`"
            ><AppIcon name="link"
          /></a>
        </article>
      </div>
      <button
        v-if="hasMore"
        type="button"
        class="quiet-button catalog-more"
        :disabled="busy"
        @click="search(true)"
      >
        Показать ещё
      </button>
      <p v-if="selected.length >= 50" class="field-note">
        Можно выбрать до 50 треков.
      </p>
      <div
        v-if="tracks.some((track) => track.streamable)"
        class="catalog-download-options"
      >
        <div class="form-options">
          <div class="field">
            <label for="search-quality">Качество</label
            ><select id="search-quality" v-model="quality" :disabled="busy">
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
            <label for="search-retention">Хранить архив</label
            ><select
              id="search-retention"
              v-model.number="retention"
              :disabled="busy"
            >
              <option v-for="hours in 24" :key="hours" :value="hours">
                {{ hours }} ч
              </option>
            </select>
          </div>
          <button
            type="button"
            class="primary-button"
            :disabled="busy || disabled || !selected.length"
            @click="addSelected"
          >
            <span v-if="adding" class="spinner" aria-hidden="true" /><AppIcon
              v-else
              name="plus"
            />{{
              adding
                ? `Добавление: ${added} / ${added + selected.length}`
                : `Добавить в очередь (${selected.length})`
            }}
          </button>
        </div>
        <p class="field-note">
          Каждый трек — отдельное задание и ZIP. Архив хранится
          {{ retention }} ч после завершения.
        </p>
      </div>
    </template>
  </div>
</template>
