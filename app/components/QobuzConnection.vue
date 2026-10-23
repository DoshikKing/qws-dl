<script setup lang="ts">
defineProps<{ connected: boolean; result: string; needsLogin: boolean }>();
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, '/') });
const busy = ref(false);
const error = ref('');
async function connect() {
  busy.value = true;
  error.value = '';
  try {
    const response = await api<{ url: string }>('/api/admin/qobuz/login', { method: 'POST' });
    window.location.assign(response.url);
  } catch (e: any) {
    error.value = e.data?.statusMessage || 'Не удалось начать вход в Qobuz.';
    busy.value = false;
  }
}
</script>

<template>
  <div class="panel" style="padding: 20px; margin-bottom: 16px">

      <p class="section-note" style="margin-top: 0">
        Введите email и пароль на сайте Qobuz. После входа вы вернётесь сюда.
      </p>
      <button class="primary-button" type="button" :disabled="busy" @click="connect">
        {{ busy ? 'Подключение…' : connected ? 'Войти заново' : 'Войти в Qobuz' }}
      </button>
      <p v-if="result === 'connected' && connected" class="section-note" role="status">Вход в Qobuz выполнен.</p>
      <p v-if="result === 'failed' || error || needsLogin" class="form-error" role="alert">
        {{ error || (needsLogin ? 'Сессия истекла или отозвана. Войдите снова в Qobuz.' : 'Не удалось завершить вход. Повторите вход в Qobuz из настроек.') }}
      </p>
  </div>
</template>
