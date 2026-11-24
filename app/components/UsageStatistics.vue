<script setup lang="ts">
import type { UsageSummary, UserUsage } from '#shared/statistics';
const props = defineProps<{ management?: boolean }>();
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, '/') });
const personal = ref<UsageSummary | null>(null);
const users = ref<UserUsage[]>([]);
const selectedId = ref('');
const search = ref('');
const loading = ref(true);
const error = ref('');
const selected = computed(() => props.management ? users.value.find(user => user.id === selectedId.value) : personal.value);
const filtered = computed(() => users.value.filter(user => user.username.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));
const name = computed(() => props.management ? users.value.find(user => user.id === selectedId.value)?.username : null);
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const since = computed(() => selected.value?.since ? new Date(selected.value.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }) : null);
async function refresh() {
  loading.value = true; error.value = '';
  try {
    if (props.management) {
      const response = await api<{ users: UserUsage[] }>('/api/admin/statistics');
      users.value = response.users.sort((a, b) => b.archives - a.archives || a.username.localeCompare(b.username));
      if (!users.value.some(user => user.id === selectedId.value)) selectedId.value = users.value[0]?.id || '';
    } else personal.value = await api<UsageSummary>('/api/statistics');
  } catch (e: any) { error.value = e.data?.statusMessage || 'Не удалось получить статистику.'; }
  finally { loading.value = false; }
}
onMounted(refresh);
</script>
<template>
  <section class="section usage-section" :aria-labelledby="management ? 'users-usage-heading' : 'my-usage-heading'" :aria-busy="loading">
    <div class="section-heading">
      <h2 :id="management ? 'users-usage-heading' : 'my-usage-heading'">{{ management ? 'Статистика пользователей' : 'Ваша статистика' }}</h2>
      <button class="quiet-button" type="button" :disabled="loading" @click="refresh">{{ loading ? 'Обновляем…' : 'Обновить' }}</button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="loading && !selected" class="section-note" role="status">Загрузка статистики…</p>
    <template v-if="management && users.length">
      <div class="field usage-search"><label for="usage-user-search">Найти пользователя</label><input id="usage-user-search" v-model="search" type="search" placeholder="Логин" /></div>
      <div class="panel usage-users">
        <table>
          <caption class="usage-caption">Завершённые скачивания пользователей. Выберите логин для просмотра жанров.</caption>
          <thead><tr><th scope="col">Пользователь</th><th scope="col">Архивы</th><th scope="col">Треки</th></tr></thead>
          <tbody><tr v-for="user in filtered" :key="user.id" :data-selected="selectedId === user.id">
            <th scope="row"><button type="button" class="quiet-button usage-user" :aria-pressed="selectedId === user.id" :aria-label="`Статистика: ${user.username}`" @click="selectedId = user.id">{{ user.username }}<small v-if="user.disabled">Доступ отключён</small></button></th>
            <td>{{ number(user.archives) }}</td><td>{{ number(user.tracks) }}</td>
          </tr></tbody>
        </table>
        <p v-if="!filtered.length" class="section-note">Пользователи не найдены.</p>
      </div>
    </template>
    <div v-if="selected" class="panel usage-detail">
      <h3 v-if="management">{{ name }}</h3>
      <dl class="usage-totals">
        <div><dt>Скачано архивов</dt><dd>{{ number(selected.archives) }}</dd></div>
        <div><dt>Скачано треков</dt><dd>{{ number(selected.tracks) }}</dd></div>
      </dl>
      <div class="usage-genres">
        <h3>Жанры скачанных треков</h3>
        <p v-if="!selected.archives" class="section-note">Завершённых скачиваний пока нет.</p>
        <p v-else-if="!selected.genres.length" class="section-note">Данные о жанрах отсутствуют.</p>
        <ul v-else aria-label="Скачанные треки по жанрам">
          <li v-for="(genre, index) in selected.genres" :key="index">
            <div><span>{{ genre.name }}</span><span>{{ number(genre.tracks) }} · {{ Math.round(genre.tracks / selected.tracks * 100) }}%</span></div>
            <span class="usage-bar" aria-hidden="true"><span :style="{ width: `${genre.tracks / selected.tracks * 100}%` }" /></span>
          </li>
        </ul>
      </div>
      <p v-if="selected.unknownArchives" class="section-note">Архивов без сведений о треках: {{ number(selected.unknownArchives) }}. Они учтены только в числе архивов.</p>
      <p class="section-note usage-explanation">Учёт с {{ since }}. Считаются полностью отправленные ZIP с загрузками Qobuz; повторные скачивания учитываются повторно. Файлы из раздела «Тексты» не входят в статистику.</p>
      <p class="section-note">Жанр берётся из тегов аудио; при нескольких жанрах — первый. Старые скачивания до начала учёта восстановить нельзя.</p>
    </div>
  </section>
</template>
<style scoped>
.usage-section .section-heading { flex-wrap: wrap; gap: 12px; }
.usage-search { max-width: 360px; margin-bottom: 16px; color: var(--secondary); }
.usage-users { overflow-x: auto; margin-bottom: 20px; }
.usage-caption { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.usage-users table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.usage-users th, .usage-users td { padding: 12px 16px; text-align: end; border-bottom: 1px solid var(--line); font-weight: 400; }
.usage-users th:first-child { text-align: start; }
.usage-users thead th { color: var(--secondary); font-size: 13px; }
.usage-users tr:last-child > * { border-bottom: 0; }
.usage-users tr[data-selected="true"] { background: var(--neutral-fill); }
.usage-user { justify-content: flex-start; flex-direction: column; align-items: flex-start; max-width: 100%; text-align: start; overflow-wrap: anywhere; }
.usage-user small { color: var(--secondary); }
.usage-detail { padding: 24px; }
.usage-detail h3 { margin: 0 0 20px; font-size: 16px; font-weight: 500; overflow-wrap: anywhere; }
.usage-totals { display: grid; grid-template-columns: 1fr 1fr; margin: 0 0 28px; }
.usage-totals > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.usage-totals dt { color: var(--secondary); font-size: 14px; }
.usage-totals dd { margin: 0; font-size: clamp(28px, 4vw, 36px); font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-genres ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 16px; }
.usage-genres li > div { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; font-size: 14px; }
.usage-genres li > div > span:first-child { overflow-wrap: anywhere; min-width: 0; }
.usage-genres li > div > span:last-child { white-space: nowrap; color: var(--secondary); font-variant-numeric: tabular-nums; }
.usage-bar, .usage-bar > span { display: block; height: 4px; border-radius: 2px; }
.usage-bar { background: var(--line); }
.usage-bar > span { background: var(--accent); }
.usage-explanation { margin-top: 24px; }
@media (max-width: 600px) {
  .usage-detail { padding: 16px; }
  .usage-totals { gap: 16px; }
  .usage-users th, .usage-users td { padding: 8px; font-size: 13px; }
  .usage-user { padding-inline: 0; }
}
</style>
