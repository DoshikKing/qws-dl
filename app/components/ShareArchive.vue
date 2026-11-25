<script setup lang="ts">
const props=defineProps<{jobId:string;title:string}>();
const emit=defineEmits<{close:[]}>();
const base=useRuntimeConfig().app.baseURL.replace(/\/?$/,'/');
const api=$fetch.create({baseURL:base});
const dialog=ref<HTMLDialogElement|null>(null),busy=ref(false),loading=ref(true),error=ref(''),hours=ref(24),url=ref(''),copied=ref(false);
const links=ref<{id:string;title:string;expiresAt:string}[]>([]);
const expiry=ref(''),createdId=ref('');let previous:HTMLElement|null=null;
const date=(value:string)=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});
async function refresh(){try{const result=await api<any>(`api/jobs/${props.jobId}/shares`);links.value=result.links;expiry.value=result.expiresAt;}catch(e:any){error.value=e.data?.statusMessage||'Не удалось получить ссылки.';}finally{loading.value=false;}}
async function create(){busy.value=true;error.value='';copied.value=false;try{const result=await api<any>(`api/jobs/${props.jobId}/shares`,{method:'POST',body:{hours:hours.value}});createdId.value=result.id;url.value=new URL(base+result.path,window.location.origin).href;await refresh();}catch(e:any){error.value=e.data?.statusMessage||'Не удалось создать ссылку.';}finally{busy.value=false;}}
async function revoke(id:string){busy.value=true;error.value='';try{await api(`api/shares/${id}`,{method:'DELETE'});if(createdId.value===id){url.value='';createdId.value='';copied.value=false;}await refresh();}catch(e:any){error.value=e.data?.statusMessage||'Не удалось отозвать ссылку.';}finally{busy.value=false;}}
async function copy(){try{await navigator.clipboard.writeText(url.value);copied.value=true;}catch{document.getElementById('share-url')?.focus();}}
onMounted(()=>{previous=document.activeElement as HTMLElement;dialog.value?.showModal();void refresh();});
onBeforeUnmount(()=>{dialog.value?.close();previous?.focus();});
</script>
<template>
  <dialog ref="dialog" class="account-dialog share-dialog" aria-labelledby="share-heading" @close="emit('close')" @cancel="busy && $event.preventDefault()">
    <div class="share-content">
      <h2 id="share-heading">Поделиться архивом</h2>
      <p class="share-name">{{ title }}</p>
      <p class="section-note">По ссылке любой получатель сможет скачать весь этот ZIP. Доступ к аккаунту и другим архивам она не открывает.</p>
      <p v-if="expiry" class="section-note">Архив хранится до {{ date(expiry) }} · мск. Скачивания по ссылке расходуют его общий лимит.</p>
      <form @submit.prevent="create">
        <div class="field"><label for="share-hours">Срок ссылки</label><select id="share-hours" v-model="hours" :disabled="busy"><option :value="1">1 час</option><option :value="6">6 часов</option><option :value="24">24 часа</option></select></div>
        <p class="field-note">Срок не превышает время хранения архива. Ссылку можно отозвать.</p>
        <button class="primary-button" type="submit" :disabled="busy||loading">{{ busy ? 'Обработка…' : 'Создать ссылку' }}</button>
      </form>
      <div v-if="url" class="field share-result"><label for="share-url">Внешняя ссылка</label><input id="share-url" :value="url" readonly @focus="($event.target as HTMLInputElement).select()" /><button class="quiet-button" type="button" @click="copy">{{ copied ? 'Скопировано' : 'Копировать ссылку' }}</button><p class="field-note">Сохраните ссылку сейчас. После закрытия окна её можно только отозвать.</p></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="loading" class="section-note" role="status">Получаем ссылки…</p>
      <div v-if="links.length" class="share-links"><h3>Действующие ссылки</h3><ul><li v-for="link in links" :key="link.id"><span>{{ link.id === createdId ? 'Новая ссылка · ' : '' }}До {{ date(link.expiresAt) }} · мск</span><button class="quiet-button" type="button" :disabled="busy" @click="revoke(link.id)">Отозвать</button></li></ul></div>
      <div class="dialog-actions"><button class="quiet-button" type="button" :disabled="busy" @click="dialog?.close()">Закрыть</button></div>
    </div>
  </dialog>
</template>
<style scoped>
.share-content { padding: 28px; }
.share-content h2 { font-size: 22px; font-weight: 500; margin: 0 0 16px; }
.share-name { overflow-wrap: anywhere; }
.share-content form { margin-top: 24px; }
.share-content form .primary-button { margin-top: 16px; }
.share-result { margin-top: 24px; }
.share-links { margin-top: 24px; }
.share-links h3 { font-size: 16px; font-weight: 500; }
.share-links ul { padding: 0; list-style: none; }
.share-links li { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--line); padding-block: 8px; font-size: 13px; }
@media(max-width:600px) { .share-content { padding: 20px; } }
</style>
