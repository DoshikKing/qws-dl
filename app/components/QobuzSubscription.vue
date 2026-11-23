<script setup lang="ts">
import type { QobuzSubscriptionStatus } from '#shared/qobuz-subscription';
const props = defineProps<{ subscription?: QobuzSubscriptionStatus; compact?: boolean }>();
const emit = defineEmits<{ open: []; refreshed: [] }>();
const state = computed(() => props.subscription?.requiresLogin ? 'login' : props.subscription?.stale ? 'stale' : props.subscription?.state || 'unknown');
const labels: Record<string, string> = { active: 'Период действует', expiring: 'Период скоро закончится', unconfirmed: 'Дата не подтверждена', inactive: 'Доступ не подтверждён',
  unknown: 'Дата неизвестна', disconnected: 'Нет подключения', login: 'Требуется вход', stale: 'Данные устарели' };
const date = (value: string, short = false) => new Date(`${value}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: short ? 'short' : 'long', ...(!short || Number(value.slice(0, 4)) !== new Date().getFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const checked = computed(() => props.subscription?.checkedAt ? new Date(props.subscription.checkedAt).toLocaleString('ru-RU', { year: 'numeric', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) : null);
const remaining = computed(() => {
  const days = props.subscription?.daysLeft;
  return days === 0 ? 'Сегодня' : days !== null && days !== undefined && days > 0 ? new Intl.NumberFormat('ru-RU', { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(days) : null;
});
const shortLabel = computed(() => state.value === 'active' && props.subscription?.endDate ? `до ${date(props.subscription.endDate, true)}`
  : state.value === 'expiring' ? remaining.value === 'Сегодня' ? 'Период до сегодня' : `Осталось ${remaining.value}` : labels[state.value]);
const api = $fetch.create({ baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, '/') });
const busy = ref(false);
const error = ref('');
const refreshed = ref(false);
async function refreshSubscription() {
  busy.value = true; error.value = ''; refreshed.value = false;
  try {
    await api('/api/admin/qobuz/refresh', { method: 'POST' });
    emit('refreshed'); refreshed.value = true;
  } catch (e: any) {
    error.value = e.data?.statusMessage || 'Не удалось обновить данные Qobuz.';
  } finally { busy.value = false; }
}
</script>
<template>
  <button v-if="compact" type="button" class="subscription-indicator" :data-state="state" :aria-label="`Подписка Qobuz: ${shortLabel}. Открыть настройки`" @click="emit('open')">
    <AppIcon :name="state === 'active' ? 'check' : 'alert'" /><span>Qobuz · {{ shortLabel }}</span><AppIcon name="arrow-right" />
  </button>
  <section v-else class="panel subscription-panel" aria-labelledby="subscription-heading" :data-state="state">
    <div class="subscription-heading"><h3 id="subscription-heading">Подписка Qobuz</h3><span class="subscription-state"><AppIcon :name="state === 'active' ? 'check' : 'alert'" />{{ labels[state] }}</span></div>
    <dl class="subscription-facts">
      <div v-if="subscription?.plan"><dt>Тариф</dt><dd>{{ subscription.plan }}</dd></div>
      <div><dt>Конец периода</dt><dd>{{ subscription?.endDate ? date(subscription.endDate) : 'Нет данных' }}</dd></div>
      <div v-if="!subscription?.endDate && subscription?.reportedEndDate"><dt>Дата в ответе Qobuz · не подтверждена</dt><dd>{{ date(subscription.reportedEndDate) }}</dd></div>
      <div v-if="remaining"><dt>До конца периода</dt><dd>{{ remaining }}</dd></div>
      <div><dt>Автопродление</dt><dd>{{ subscription?.autoRenew === true ? 'Включено' : subscription?.autoRenew === false ? 'Отключено' : 'Нет данных' }}</dd></div>
    </dl>
    <p v-if="state === 'disconnected'" class="field-note">Войдите в Qobuz, чтобы получить сведения о подписке.</p>
    <p v-else-if="state === 'login'" class="field-note">Сессия требует повторного входа. Срок показан по последним полученным данным.</p>
    <p v-else-if="state === 'stale'" class="field-note">Срок показан по последним полученным данным. Проверьте подключение к Qobuz; сведения обновляются вместе с сессией.</p>
    <p v-else-if="state === 'unconfirmed'" class="field-note">Qobuz вернул неподтверждённые сведения о периоде. Старая дата не означает, что подписка закончилась. Проверьте срок в аккаунте Qobuz.</p>
    <p v-else-if="state === 'inactive'" class="field-note">Профиль Qobuz не подтверждает права на потоковое воспроизведение. Проверьте подписку в аккаунте сервиса.</p>
    <p v-else-if="!subscription?.endDate" class="field-note">Qobuz не передал дату окончания периода. Проверьте её в аккаунте сервиса.</p>
    <p v-else class="field-note">Это дата конца текущего периода. При включённом автопродлении подписка может продолжиться.</p>
    <p v-if="checked" class="field-note subscription-checked">Последняя проверка Qobuz: {{ checked }} · мск</p>
    <button v-if="state !== 'disconnected'" type="button" class="quiet-button subscription-refresh" :disabled="busy || subscription?.requiresLogin" :aria-busy="busy" @click="refreshSubscription">{{ busy ? 'Проверяем…' : 'Обновить данные' }}</button>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="refreshed" class="field-note" role="status">Проверка завершена. Показаны последние сведения, полученные от Qobuz.</p>
  </section>
</template>
<style scoped>
.subscription-indicator { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; max-width: 100%; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--secondary); background: var(--panel); font-size: 13px; text-align: start; }
.subscription-indicator span { overflow-wrap: anywhere; }
.subscription-indicator .app-icon { width: 16px; height: 16px; flex-shrink: 0; }
.subscription-indicator[data-state="active"] > .app-icon:first-child { color: var(--success); }
.subscription-indicator[data-state="expiring"], .subscription-indicator[data-state="stale"], .subscription-indicator[data-state="login"] { color: var(--warning); background: var(--warning-fill); }
.subscription-indicator[data-state="inactive"] { color: var(--warning); background: var(--warning-fill); }
.subscription-indicator:hover { border-color: var(--accent); }
.subscription-refresh { margin-top: 16px; }
.subscription-panel { margin-block: 16px; padding: 24px; }
.subscription-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.subscription-heading h3 { margin: 0; font-size: 17px; font-weight: 500; }
.subscription-state { display: inline-flex; align-items: center; gap: 8px; color: var(--secondary); font-size: 13px; }
.subscription-state .app-icon { width: 16px; height: 16px; }
[data-state="active"] .subscription-state { color: var(--success); }
[data-state="expiring"] .subscription-state, [data-state="stale"] .subscription-state, [data-state="login"] .subscription-state { color: var(--warning); }
[data-state="inactive"] .subscription-state { color: var(--warning); }
.subscription-facts { display: grid; gap: 12px; margin: 0 0 20px; }
.subscription-facts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; }
.subscription-facts dt { color: var(--secondary); }
.subscription-facts dd { min-width: 0; overflow-wrap: anywhere; margin: 0; text-align: end; font-variant-numeric: tabular-nums; }
.subscription-panel .field-note { margin: 0; }
.subscription-panel .subscription-checked { margin-top: 8px; }
@media (max-width: 600px) { .subscription-panel { padding: 16px; } .subscription-facts > div { flex-direction: column; gap: 4px; } .subscription-facts dd { text-align: start; } }
</style>
