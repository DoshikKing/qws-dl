<script setup lang="ts">
type Track = { id: number; title: string; artist: string; duration: number | null };
const props = defineProps<{ token: string }>();
const base = useRuntimeConfig().app.baseURL.replace(/\/?$/, '/');
const tracks = ref<Track[]>([]), selected = ref(0), loading = ref(false), error = ref(''), expired = ref(false);
const player = ref<HTMLAudioElement | null>(null);
const current = computed(() => tracks.value.find(track => track.id === selected.value));
const labelId = useId();
let controller: AbortController | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
function stop() { player.value?.pause(); player.value?.removeAttribute('src'); player.value?.load(); }
async function open() {
  loading.value = true; error.value = '';
  controller?.abort(); controller = new AbortController();
  try {
    const result = await $fetch<{ tracks: Track[]; expiresAt: string }>(`${base}api/shared/${props.token}/tracks`, {
      credentials: 'omit', retry: 0, timeout: 30000, signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    tracks.value = result.tracks; selected.value = result.tracks[0]?.id ?? 0;
    if (!tracks.value.length) error.value = 'В архиве нет треков для прослушивания.';
    clearTimeout(deadline);
    deadline = setTimeout(() => { expired.value = true; stop(); tracks.value = []; }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
  } catch { if (!controller.signal.aborted) error.value = 'Не удалось подготовить прослушивание. Ссылка могла истечь или сервер занят. Повторите позже.'; }
  finally { loading.value = false; }
}
function change() { player.value?.pause(); error.value = ''; }
onBeforeUnmount(() => { controller?.abort(); clearTimeout(deadline); stop(); });
</script>
<template>
  <section class="shared-preview" :aria-labelledby="labelId">
    <h2 :id="labelId">Прослушивание</h2>
    <p class="field-note">До 60 секунд. Прослушивание не расходует лимит скачиваний ZIP.</p>
    <p v-if="expired" class="form-error" role="alert">Срок ссылки истёк.</p>
    <button v-else-if="!tracks.length" type="button" class="quiet-button" :disabled="loading" @click="open">{{ loading ? 'Получаем треки…' : 'Прослушать' }}</button>
    <template v-if="current && !expired">
      <div v-if="tracks.length > 1" class="field">
        <label :for="`${labelId}-track`">Трек</label>
        <select :id="`${labelId}-track`" v-model="selected" @change="change">
          <option v-for="track in tracks" :key="track.id" :value="track.id">{{ track.id + 1 }}. {{ track.title }}{{ track.artist ? ` · ${track.artist}` : '' }}</option>
        </select>
      </div>
      <p v-else class="preview-title">{{ current.title }}{{ current.artist ? ` · ${current.artist}` : '' }}</p>
      <audio :key="current.id" ref="player" controls preload="none" :src="`${base}api/shared/${token}/preview/${current.id}`" :aria-label="`Прослушать: ${current.title}`" @error="error = 'Не удалось воспроизвести фрагмент. Попробуйте другой трек или скачайте ZIP.'" />
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.shared-preview { margin-block: 24px; display: grid; gap: 12px; min-width: 0; }
.shared-preview h2 { font-size: 16px; }
.shared-preview .quiet-button { justify-self: start; }
.shared-preview audio { width: 100%; min-width: 0; height: 54px; }
.shared-preview select { width: 100%; max-width: 100%; }
.preview-title { font-size: 14px; overflow-wrap: anywhere; }
</style>
