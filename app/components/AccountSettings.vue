<script setup lang="ts">
const props = defineProps<{
  account: {
    username: string;
    role: string;
    inviteCode: string;
    invitedCount: number;
    inviteLimit: number | null;
    invitesRemaining: number | null;
  };
}>();
const api = $fetch.create({
  baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, "/"),
});
const current = ref("");
const password = ref("");
const confirmation = ref("");
const busy = ref(false);
const error = ref("");
const success = ref("");
const copied = ref(false);
const codeInput = ref<HTMLInputElement | null>(null);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.account.inviteCode);
    copied.value = true;
  } catch {
    codeInput.value?.focus();
    codeInput.value?.select();
  }
}
async function changePassword() {
  error.value = success.value = "";
  if (password.value !== confirmation.value) {
    error.value = "Пароли не совпадают.";
    return;
  }
  busy.value = true;
  try {
    await api("/api/account/password", {
      method: "POST",
      body: { currentPassword: current.value, password: password.value },
    });
    current.value = password.value = confirmation.value = "";
    success.value = "Пароль изменён. Остальные сеансы завершены.";
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Не удалось изменить пароль.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="section first-section" aria-labelledby="account-heading">
    <div class="section-heading"><h2 id="account-heading">Аккаунт</h2></div>
    <div class="panel settings-list">
      <div class="setting-row">
        <span>Логин</span
        ><span class="setting-value">{{ account.username }}</span>
      </div>
      <div class="setting-row">
        <span>Роль</span
        ><span class="setting-value">{{
          account.role === "admin" ? "Администратор" : "Пользователь"
        }}</span>
      </div>
    </div>
  </section>
  <section class="section" aria-labelledby="invite-heading">
    <div class="section-heading"><h2 id="invite-heading">Приглашения</h2></div>
    <div class="panel account-panel">
      <label for="invite-code" class="control-label">Ваш код приглашения</label>
      <div class="invite-code-control">
        <input
          id="invite-code"
          ref="codeInput"
          :value="account.inviteCode"
          readonly
          spellcheck="false"
          @focus="($event.target as HTMLInputElement).select()"
        /><button
          type="button"
          class="quiet-button"
          :disabled="account.invitesRemaining === 0"
          @click="copy"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" /><span>{{
            copied ? "Скопировано" : "Копировать"
          }}</span>
        </button>
      </div>
      <p class="field-note" role="status">
        Приглашено: {{ account.invitedCount }}.
        {{
          account.invitesRemaining === null
            ? "Без ограничений."
            : `Осталось приглашений: ${account.invitesRemaining}.`
        }}
      </p>
    </div>
  </section>
  <section
    v-if="account.role !== 'admin'"
    class="section"
    aria-labelledby="password-heading"
  >
    <div class="section-heading"><h2 id="password-heading">Пароль</h2></div>
    <form
      class="panel account-panel password-settings"
      @submit.prevent="changePassword"
    >
      <div class="field">
        <label for="current-password">Текущий пароль</label
        ><input
          id="current-password"
          v-model="current"
          type="password"
          autocomplete="current-password"
          required
          maxlength="256"
          :disabled="busy"
        />
      </div>
      <div class="field">
        <label for="new-password">Новый пароль</label
        ><input
          id="new-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          minlength="10"
          maxlength="256"
          :disabled="busy"
        />
        <p class="field-note">От 10 до 256 символов.</p>
      </div>
      <div class="field">
        <label for="confirm-password">Повторите пароль</label
        ><input
          id="confirm-password"
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          required
          minlength="10"
          maxlength="256"
          :disabled="busy"
        />
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="success" class="form-success" role="status">{{ success }}</p>
      <button class="primary-button" :disabled="busy">
        <span v-if="busy" class="spinner" aria-hidden="true" />Изменить пароль
      </button>
    </form>
  </section>
  <p v-else class="section-note">
    Логин и пароль администратора задаются в .env: ADMIN_USERNAME и
    ADMIN_PASSWORD.
  </p>
</template>
