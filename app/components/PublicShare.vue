<script setup lang="ts">
type SharedArchive={title:string;artist:string;duration:number|null;tracks:number;size:number;sharedBy:string;expiresAt:string;hasCover:boolean};
const props=defineProps<{token:string}>();
const base=useRuntimeConfig().app.baseURL.replace(/\/?$/,'/');
// Preserve per-client public limits during SSR without forwarding account cookies.
const requestEvent = useRequestEvent();
const fetchOptions = {
  credentials: 'omit' as const, retry: 0, timeout: 10000,
  ...(import.meta.server ? { context: { _platform: {
    publicShareRemoteAddress: requestEvent?.node.req.socket.remoteAddress,
    publicShareForwardedAddress: useRequestHeader('x-real-ip'),
  } } } : {}),
};
const { data: archive, error, status } = await useAsyncData(
  `shared-archive:${props.token}`,
  () => /^[A-Za-z0-9_-]{43}$/.test(props.token)
    ? $fetch<SharedArchive>(`${base}api/shared/${props.token}`, fetchOptions)
    : Promise.reject(new Error('Invalid share link')),
);
const loading = computed(() => status.value === 'pending');
const coverFailed = ref(false);
const duration=computed(()=>{const seconds=archive.value?.duration;if(!seconds)return 'Не указана';const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=String(seconds%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;});
const expiry=computed(()=>archive.value?new Date(archive.value.expiresAt).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}):'');
useHead({title:'Скачивание архива · QWS',meta:[{name:'robots',content:'noindex, nofollow, noarchive'},{name:'referrer',content:'no-referrer'}]});
</script>
<template>
  <main class="shared-page">
    <div class="shared-brand"><span class="app-mark record-mark" aria-hidden="true" />QWS</div>
    <p v-if="loading" class="section-note" role="status">Получаем сведения об архиве…</p>
    <section v-else-if="error || !archive" class="panel shared-unavailable" aria-labelledby="shared-error">
      <AppIcon name="lock" /><h1 id="shared-error">Ссылка недоступна</h1><p class="section-note">Срок ссылки мог закончиться, доступ мог быть отозван или архив удалён.</p>
    </section>
    <section v-else class="panel shared-card" aria-labelledby="shared-title">
      <div class="shared-art"><img v-if="archive.hasCover && !coverFailed" :src="`${base}api/shared/${token}/cover`" alt="Обложка" width="480" height="480" fetchpriority="high" referrerpolicy="no-referrer" @error="coverFailed = true" /><AppIcon v-else name="music" /></div>
      <div class="shared-info">
        <p class="shared-eyebrow">С вами поделился {{ archive.sharedBy }}</p>
        <h1 id="shared-title">{{ archive.title }}</h1>
        <p class="shared-artist">{{ archive.artist || 'Исполнитель не указан' }}</p>
        <dl class="shared-facts">
          <div><dt>{{ archive.tracks > 1 ? 'Общая длительность' : 'Длительность' }}</dt><dd>{{ duration }}</dd></div>
          <div v-if="archive.tracks > 1"><dt>Треков</dt><dd>{{ archive.tracks }}</dd></div>
          <div><dt>Архив ZIP</dt><dd>{{ (archive.size / 1024 / 1024).toLocaleString('ru-RU',{maximumFractionDigits:1}) }} МБ</dd></div>
        </dl>
        <a class="primary-button shared-download" :href="`${base}api/shared/${token}/download`" download rel="noreferrer"><AppIcon name="download" />Скачать ZIP</a>
        <p class="section-note shared-expiry">Доступ до {{ expiry }} · мск. Владелец может закрыть его раньше.</p>
      </div>
    </section>
  </main>
</template>
<style scoped>
.shared-page { width: min(900px, 100%); margin: 0 auto; padding: 48px 24px; min-height: 100dvh; }
.shared-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 48px; font-size: 18px; font-weight: 500; }
.shared-card { display: grid; grid-template-columns: minmax(200px,1fr) minmax(0,1.2fr); padding: 28px; gap: 36px; align-items: start; }
.shared-art { aspect-ratio: 1; display: grid; place-items: center; background: var(--neutral-fill); border-radius: 8px; overflow: hidden; }
.shared-art img { width: 100%; height: 100%; object-fit: cover; }
.shared-art .app-icon { width: 64px; height: 64px; color: var(--secondary); }
.shared-eyebrow { margin: 0 0 16px; color: var(--secondary); font-size: 13px; overflow-wrap: anywhere; }
.shared-info h1 { margin: 0 0 12px; font-size: clamp(24px,3vw,32px); line-height: 1.2; font-weight: 500; overflow-wrap: anywhere; }
.shared-artist { margin: 0 0 28px; color: var(--secondary); overflow-wrap: anywhere; }
.shared-facts { margin: 0 0 28px; display: grid; gap: 12px; font-size: 14px; }
.shared-facts > div { display: flex; justify-content: space-between; gap: 16px; }
.shared-facts dt { color: var(--secondary); }
.shared-facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.shared-download { display: inline-flex; text-decoration: none; gap: 8px; }
.shared-expiry { margin-top: 16px; }
.shared-unavailable { max-width: 520px; padding: 28px; }
.shared-unavailable h1 { font-size: 24px; font-weight: 500; margin-block: 20px 12px; }
@media(max-width:600px) { .shared-page { padding: 24px 16px; } .shared-brand { margin-bottom: 28px; } .shared-card { grid-template-columns: minmax(0,1fr); padding: 20px; gap: 24px; } .shared-art { max-width: 360px; width: 100%; justify-self: center; } .shared-download { width: 100%; justify-content: center; } }
</style>
