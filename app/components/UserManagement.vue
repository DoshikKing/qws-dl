<script setup lang="ts">
type ManagedUser = {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  invitedBy: string | null;
  invitedCount: number;
  inviteLimit: number | null;
};
const api = $fetch.create({
  baseURL: useRuntimeConfig().app.baseURL.replace(/\/?$/, "/"),
});
const users = ref<ManagedUser[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const search = ref("");
const dialog = ref<HTMLDialogElement | null>(null);
const selected = ref<ManagedUser | null>(null);
const action = ref<"delete" | "password">("delete");
const password = ref("");
const filtered = computed(() =>
  users.value.filter((user) =>
    user.username.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
async function refresh() {
  try {
    users.value = await api<ManagedUser[]>("/api/admin/users");
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Не удалось получить пользователей.";
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);
async function open(user: ManagedUser, value: typeof action.value) {
  selected.value = user;
  action.value = value;
  password.value = "";
  error.value = "";
  await nextTick();
  dialog.value?.showModal();
}
async function manage(user: ManagedUser, value: string) {
  busy.value = true;
  error.value = notice.value = "";
  try {
    await api(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: {
        action: value,
        ...(value === "password" ? { password: password.value } : {}),
      },
    });
    dialog.value?.close();
    password.value = "";
    await refresh();
    notice.value =
      value === "delete"
        ? `Аккаунт ${user.username} удалён.`
        : value === "password"
          ? `Пароль ${user.username} изменён.`
          : value === "disable"
            ? `Аккаунт ${user.username} заблокирован.`
            : `Аккаунт ${user.username} разблокирован.`;
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Не удалось изменить аккаунт.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="section first-section" aria-labelledby="users-heading">
    <div class="section-heading files-heading">
      <h2 id="users-heading">
        Аккаунты <span class="item-count">{{ users.length }}</span>
      </h2>
      <div class="search-control">
        <AppIcon name="search" /><input
          v-model="search"
          type="search"
          aria-label="Поиск пользователей"
          placeholder="Поиск"
        />
      </div>
    </div>
    <p v-if="error && !dialog?.open" class="notice notice-error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="section-note" role="status">{{ notice }}</p>
    <div class="collection-content" :aria-busy="loading">
      <Transition name="collection" mode="out-in">
        <div v-if="loading" key="loading" class="collection-loading" role="status">
          <span class="spinner" aria-hidden="true" />Загрузка…
        </div>
        <div v-else key="results">
          <div v-if="!filtered.length" class="empty-state">
            <AppIcon name="users" />
            <h3>Никого не найдено</h3>
          </div>
          <div v-else class="panel user-list">
            <article
              v-for="user in filtered"
              :key="user.id"
              class="user-row"
              :aria-label="user.username"
            >
              <div class="item-icon">
                <AppIcon :name="user.role === 'admin' ? 'shield' : 'user'" />
              </div>
              <div class="item-description">
                <h3 class="item-title">{{ user.username }}</h3>
                <p class="item-meta">
                  {{ user.role === "admin" ? "Администратор" : "Пользователь"
                  }}<span>·</span
                  >{{ new Date(user.createdAt).toLocaleDateString("ru-RU") }}
                </p>
                <p class="item-meta">
                  Приглашено: {{ user.invitedCount
                  }}{{ user.inviteLimit === null ? "" : ` / ${user.inviteLimit}`
                  }}<template v-if="user.invitedBy"
                    ><span>·</span>Пригласил: {{ user.invitedBy }}</template
                  >
                </p>
              </div>
              <span
                class="status-badge"
                :data-status="user.disabled ? 'failed' : 'completed'"
                >{{ user.disabled ? "Заблокирован" : "Активен" }}</span
              >
              <div v-if="user.role !== 'admin'" class="user-actions">
                <button
                  class="quiet-button"
                  :disabled="busy"
                  @click="manage(user, user.disabled ? 'enable' : 'disable')"
                >
                  {{ user.disabled ? "Разблокировать" : "Заблокировать" }}</button
                ><button
                  class="quiet-button"
                  :disabled="busy"
                  @click="open(user, 'password')"
                >
                  Пароль</button
                ><button
                  class="icon-button danger-button"
                  :aria-label="`Удалить ${user.username}`"
                  :disabled="busy"
                  @click="open(user, 'delete')"
                >
                  <AppIcon name="trash" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </Transition>
    </div>
  </section>
  <dialog
    ref="dialog"
    class="account-dialog"
    aria-labelledby="dialog-title"
    :aria-describedby="action === 'delete' ? 'delete-detail' : undefined"
    @cancel="password = ''"
    @close="password = ''"
  >
    <form v-if="selected" @submit.prevent="manage(selected, action)">
      <h2 id="dialog-title">
        {{
          action === "delete"
            ? `Удалить ${selected.username}?`
            : `Пароль ${selected.username}`
        }}
      </h2>
      <p v-if="action === 'delete'" id="delete-detail" class="section-note">
        Аккаунт и его сеансы будут удалены. Активные загрузки остановятся; файлы
        удалятся по сроку хранения. Это действие нельзя отменить.
      </p>
      <div v-else class="field">
        <label for="reset-password">Новый пароль</label
        ><input
          id="reset-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          minlength="10"
          maxlength="256"
          :disabled="busy"
        />
        <p class="field-note">
          От 10 до 256 символов. Сеансы пользователя завершатся.
        </p>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button
          type="button"
          class="quiet-button"
          autofocus
          :disabled="busy"
          @click="dialog?.close()"
        >
          Отмена</button
        ><button
          class="primary-button"
          :class="{ 'destructive-button': action === 'delete' }"
          :disabled="busy"
        >
          {{ action === "delete" ? "Удалить аккаунт" : "Сохранить пароль" }}
        </button>
      </div>
    </form>
  </dialog>
</template>
