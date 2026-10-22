<script setup lang="ts">
const props = defineProps<{ checking: boolean; error: string }>();
const emit = defineEmits<{ authenticated: [] }>();
const api = $fetch.create({
  baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, "/"),
});
const mode = ref<"invite" | "register" | "login">("invite");
const form = ref<HTMLFormElement | null>(null);
const code = ref("");
const username = ref("");
const password = ref("");
const confirmation = ref("");
const busy = ref(false);
const failure = ref("");
const disabled = computed(() => props.checking || busy.value);
function focus() {
  if (!disabled.value)
    form.value?.querySelector("input")?.focus({ preventScroll: true });
}
function switchMode(value: typeof mode.value) {
  mode.value = value;
  password.value = confirmation.value = failure.value = "";
  if (value === "invite") code.value = "";
  nextTick(focus);
}
watch(
  () => props.checking,
  () => nextTick(focus),
);
onMounted(focus);
async function submit() {
  failure.value = "";
  if (mode.value === "register" && password.value !== confirmation.value) {
    failure.value = "Пароли не совпадают.";
    return;
  }
  busy.value = true;
  try {
    if (mode.value === "invite") {
      await api("/api/invitations/check", {
        method: "POST",
        body: { code: code.value.trim() },
      });
      switchMode("register");
    } else {
      await api(mode.value === "login" ? "/api/login" : "/api/register", {
        method: "POST",
        body: {
          username: username.value,
          password: password.value,
          inviteCode: code.value.trim(),
        },
      });
      password.value = confirmation.value = code.value = "";
      emit("authenticated");
    }
  } catch (error: any) {
    failure.value =
      error.data?.statusMessage || "Не удалось связаться с сервером.";
  } finally {
    busy.value = false;
    nextTick(focus);
  }
}
</script>

<template>
  <div class="auth-form">
    <Transition name="page" mode="out-in" @after-enter="focus">
      <form
        v-if="mode === 'invite'"
        key="invite"
        ref="form"
        class="invite-form"
        aria-label="Приглашение"
        @submit.prevent="submit"
      >
        <div
          class="password-control"
          :class="{ 'has-error': failure || error }"
        >
          <AppIcon name="key" />
          <input
            v-model="code"
            aria-label="Код приглашения"
            :aria-invalid="Boolean(failure)"
            :aria-describedby="failure || error ? 'auth-error' : undefined"
            placeholder="Код приглашения"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="64"
            required
            :disabled="disabled"
          />
          <button
            class="password-submit"
            type="submit"
            aria-label="Продолжить"
            :disabled="disabled || !code.trim()"
          >
            <span v-if="disabled" class="spinner" aria-hidden="true" /><AppIcon
              v-else
              name="arrow-right"
            />
          </button>
        </div>
        <button
          type="button"
          class="auth-switch text-button"
          :disabled="disabled"
          @click="switchMode('login')"
        >
          Уже есть аккаунт? Войти
        </button>
      </form>
      <form
        v-else
        :key="mode"
        ref="form"
        class="auth-card panel"
        :aria-label="mode === 'login' ? 'Вход' : 'Регистрация'"
        @submit.prevent="submit"
      >
        <h1>{{ mode === "login" ? "Вход" : "Регистрация" }}</h1>
        <div class="field">
          <label for="account-username">Логин</label
          ><input
            id="account-username"
            v-model="username"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            minlength="3"
            maxlength="32"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}"
            required
            :disabled="disabled"
            :aria-describedby="
              mode === 'register' ? 'username-hint' : undefined
            "
          />
          <p v-if="mode === 'register'" id="username-hint" class="field-note">
            3–32 символа: латинские буквы, цифры, . _ -
          </p>
        </div>
        <div class="field">
          <label for="account-password">Пароль</label
          ><input
            id="account-password"
            v-model="password"
            name="password"
            type="password"
            :autocomplete="
              mode === 'login' ? 'current-password' : 'new-password'
            "
            :minlength="mode === 'register' ? 10 : undefined"
            maxlength="256"
            required
            :disabled="disabled"
            :aria-describedby="
              mode === 'register' ? 'password-hint' : undefined
            "
          />
          <p v-if="mode === 'register'" id="password-hint" class="field-note">
            От 10 до 256 символов.
          </p>
        </div>
        <div v-if="mode === 'register'" class="field">
          <label for="account-confirm">Повторите пароль</label
          ><input
            id="account-confirm"
            v-model="confirmation"
            name="confirm"
            type="password"
            autocomplete="new-password"
            minlength="10"
            maxlength="256"
            required
            :disabled="disabled"
          />
        </div>
        <button type="submit" class="primary-button" :disabled="disabled">
          <span v-if="busy" class="spinner" aria-hidden="true" />{{
            mode === "login" ? "Войти" : "Создать аккаунт"
          }}
        </button>
        <button
          type="button"
          class="text-button"
          :disabled="disabled"
          @click="switchMode('invite')"
        >
          {{
            mode === "login"
              ? "Регистрация по приглашению"
              : "Другой код приглашения"
          }}
        </button>
      </form>
    </Transition>
    <p v-if="failure || error" id="auth-error" class="auth-error" role="alert">
      {{ failure || error }}
    </p>
  </div>
</template>
