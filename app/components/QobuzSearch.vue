<script setup lang="ts">
type SearchType = "tracks" | "albums" | "artists";
type CatalogItem = {
  id: string;
  url: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  cover?: string | null;
  trackCount?: number | null;
  albumCount?: number | null;
  year?: string | null;
  streamable: boolean;
};
type Results = Partial<Record<SearchType, CatalogItem[]>> & {
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
const lyrics = defineModel<boolean>("lyrics", { required: true });
const emit = defineEmits<{ queued: [] }>();
const api = $fetch.create({
  baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, "/"),
});
const types: SearchType[] = ["tracks", "albums", "artists"];
const labels = { tracks: "Треки", albums: "Альбомы", artists: "Исполнители" };
const prompts = {
  tracks: "Название трека или исполнитель",
  albums: "Название альбома или исполнитель",
  artists: "Имя исполнителя",
};
const activeType = ref<SearchType>("tracks");
const query = ref("");
const newState = () => ({
  items: [] as CatalogItem[],
  selected: [] as string[],
  queued: [] as string[],
  failedCovers: [] as string[],
  searchedQuery: "",
  total: 0,
  offset: 0,
  hasMore: false,
  searched: false,
  error: "",
  notice: "",
});
const states = reactive({ tracks: newState(), albums: newState(), artists: newState() });
const state = computed(() => states[activeType.value]);
const searching = ref(false);
const adding = ref(false);
const added = ref(0);
const busy = computed(() => searching.value || adding.value);
const available = computed(() =>
  state.value.items.filter(item => item.streamable && !state.value.queued.includes(item.id)),
);
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const details = (item: CatalogItem) => {
  if (activeType.value === "tracks") return [item.album, duration(item.duration || 0)].filter(Boolean).join(" · ");
  if (activeType.value === "albums") return [item.year, item.trackCount == null ? "" : `Треков: ${item.trackCount}`].filter(Boolean).join(" · ");
  return item.albumCount == null ? "Исполнитель" : `Альбомов: ${item.albumCount}`;
};
const itemName = (item: CatalogItem) => [item.artist, item.title].filter(Boolean).join(" — ");
const message = (e: any) => e.data?.statusMessage || "Не удалось связаться с сервером.";
let controller: AbortController | null = null;
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
});
async function chooseType(type: SearchType) {
  if (busy.value || type === activeType.value) return;
  activeType.value = type;
  if (query.value.trim() && (!state.value.searched || state.value.searchedQuery !== query.value.trim())) await search();
}
function tabKeydown(event: KeyboardEvent) {
  const index = types.indexOf(activeType.value);
  const target = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  if (busy.value) return;
  void chooseType(types[target]!);
  nextTick(() => document.getElementById(`catalog-tab-${types[target]}`)?.focus());
}
async function search(more = false) {
  const target = state.value;
  const type = activeType.value;
  const text = more ? target.searchedQuery : query.value.trim();
  if (!text || busy.value || props.disabled) return;
  searching.value = true;
  target.error = target.notice = "";
  const requestController = new AbortController();
  controller = requestController;
  if (!more) {
    target.items = [];
    target.selected = [];
    target.queued = [];
    target.failedCovers = [];
    target.searched = false;
    target.hasMore = false;
  }
  try {
    const result = await api<Results>("/api/search", {
      method: "POST",
      body: { query: text, type, offset: more ? target.offset + 20 : 0 },
      signal: requestController.signal,
    });
    if (disposed) return;
    const known = new Set(target.items.map(item => item.id));
    target.items.push(...(result[type] || []).filter(item => {
      if (known.has(item.id)) return false;
      known.add(item.id);
      return true;
    }));
    target.searchedQuery = text;
    target.offset = result.offset;
    target.total = result.total;
    target.hasMore = result.hasMore;
    target.searched = true;
  } catch (e) {
    if (!requestController.signal.aborted) target.error = message(e);
  } finally {
    searching.value = false;
  }
}
function selectAvailable() {
  state.value.selected = state.value.selected.length ? [] : available.value.slice(0, 50).map(item => item.id);
}
async function addSelected() {
  const target = state.value;
  if (!target.selected.length || busy.value || props.disabled) return;
  const ids = [...target.selected];
  const options = { quality: quality.value, retentionHours: retention.value, lyrics: lyrics.value };
  adding.value = true;
  added.value = 0;
  target.error = target.notice = "";
  try {
    for (const id of ids) {
      if (disposed) break;
      const item = target.items.find(item => item.id === id)!;
      await api("/api/jobs", { method: "POST", body: { url: item.url, ...options } });
      target.queued.push(id);
      target.selected = target.selected.filter(value => value !== id);
      added.value++;
    }
  } catch (e) {
    target.error = message(e);
  } finally {
    if (added.value && !disposed) {
      target.notice = `Добавлено в очередь: ${added.value}.`;
      emit("queued");
    }
    adding.value = false;
  }
}
</script>
<template>
  <div class="qobuz-search">
    <div
      class="input-mode catalog-tabs"
      role="tablist"
      aria-label="Поиск по каталогу"
      @keydown="tabKeydown"
    >
      <button
        v-for="type in types"
        :id="`catalog-tab-${type}`"
        :key="type"
        type="button"
        role="tab"
        :aria-selected="activeType === type"
        :tabindex="activeType === type ? 0 : -1"
        aria-controls="catalog-search-panel"
        :aria-disabled="busy"
        @click="chooseType(type)"
      >{{ labels[type] }}</button>
    </div>
    <div
      id="catalog-search-panel"
      role="tabpanel"
      :aria-labelledby="`catalog-tab-${activeType}`"
      :aria-busy="searching"
    >
      <form class="catalog-search-form" @submit.prevent="search()">
        <div class="field">
          <label for="catalog-query">{{ prompts[activeType] }}</label>
          <div class="input-with-icon">
            <AppIcon name="search" /><input
              id="catalog-query"
              v-model="query"
              type="search"
              :placeholder="prompts[activeType]"
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
      <p v-if="activeType === 'artists'" class="field-note catalog-artist-note">Выбор исполнителя добавит в очередь всю его доступную дискографию.</p>
      <p v-if="state.error" class="form-error search-message" role="alert">
        {{ state.error }}
      </p>
      <p v-if="state.notice" class="form-success search-message" role="status">
        {{ state.notice }}
      </p>
      <template v-if="state.searched">
        <div class="catalog-heading">
          <h3 id="search-results-heading">
            Результаты <span class="item-count">{{ state.total }}</span>
          </h3>
          <button
            v-if="available.length"
            type="button"
            class="text-button"
            :disabled="busy"
            @click="selectAvailable"
          >
            {{ state.selected.length ? "Снять выбор" : "Выбрать доступные" }}
          </button>
        </div>
        <div v-if="!state.items.length" class="empty-state">
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
          <article v-for="item in state.items" :key="item.id" class="catalog-result">
            <label class="catalog-choice"
              ><input
                v-model="state.selected"
                type="checkbox"
                :value="item.id"
                :aria-label="`Выбрать ${itemName(item)}`"
                :disabled="
                  busy ||
                  !item.streamable ||
                  state.queued.includes(item.id) ||
                  (state.selected.length >= 50 && !state.selected.includes(item.id))
                "
              /><span class="catalog-artwork" :class="{ 'catalog-portrait': activeType === 'artists' }" aria-hidden="true">
                <img v-if="item.cover && !state.failedCovers.includes(item.id)" :src="item.cover" alt="" width="64" height="64"
                  loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="state.failedCovers.push(item.id)" />
                <AppIcon v-else :name="activeType === 'artists' ? 'user' : 'music'" />
              </span><span class="item-description"
                ><strong class="item-title">{{ item.title }}</strong
                ><span class="item-meta">{{ item.artist }}</span
                ><span v-if="details(item)" class="item-meta">{{ details(item) }}</span
                ><span v-if="!item.streamable" class="item-meta"
                  >Недоступно для скачивания</span
                ><span v-else-if="state.queued.includes(item.id)" class="form-success"
                  >Добавлено</span
                ></span
              ></label
            >
            <a
              class="icon-button"
              :href="item.url"
              target="_blank"
              rel="noreferrer"
              :aria-label="`Открыть в Qobuz: ${itemName(item)}`"
              ><AppIcon name="link"
            /></a>
          </article>
        </div>
        <button
          v-if="state.hasMore"
          type="button"
          class="quiet-button catalog-more"
          :disabled="busy"
          @click="search(true)"
        >
          Показать ещё
        </button>
        <p v-if="state.selected.length >= 50" class="field-note">
          Можно выбрать до 50 записей.
        </p>
        <div
          v-if="state.items.some((item) => item.streamable)"
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
              :disabled="busy || disabled || !state.selected.length"
              @click="addSelected"
            >
              <span v-if="adding" class="spinner" aria-hidden="true" /><AppIcon
                v-else
                name="plus"
              />{{
                adding
                  ? `Добавление: ${added} / ${added + state.selected.length}`
                  : activeType === 'artists' ? `Добавить дискографии (${state.selected.length})` : `Добавить в очередь (${state.selected.length})`
              }}
            </button>
          </div>
          <label class="lyrics-option">
            <input v-model="lyrics" type="checkbox" :disabled="busy" />
            <span>Добавлять тексты песен<span class="field-note">Синхронизированный текст и файл .lrc, если найдены.</span></span>
          </label>
          <p class="field-note">
            {{ activeType === 'tracks' ? 'Каждый трек' : activeType === 'albums' ? 'Каждый альбом' : 'Каждая дискография' }} — отдельное задание и ZIP. Архив хранится {{ retention }} ч после завершения.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
