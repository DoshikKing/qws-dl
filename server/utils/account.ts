import type { H3Event } from "h3";
import { getUsers } from "./users.mjs";

export async function accountStore() {
  try {
    return await getUsers();
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage:
        "Проверьте ADMIN_USERNAME, ADMIN_PASSWORD (10–256 символов), USER_INVITE_LIMIT и доступ к DATA_DIR.",
    });
  }
}
export function setSession(event: H3Event, value: string) {
  setCookie(event, "qws_session", value, {
    httpOnly: true,
    sameSite: "strict",
    secure: getRequestURL(event).protocol === "https:",
    path: useRuntimeConfig(event).app.baseURL.replace(/\/?$/, "/"),
    maxAge: 43200,
  });
}
// Global bound also protects password hashing behind proxies without trusting forwarded IPs.
let attempts = 0;
let windowStart = Date.now();
export function limitAuth() {
  if (Date.now() - windowStart > 60_000) {
    attempts = 0;
    windowStart = Date.now();
  }
  if (++attempts > 30)
    throw createError({
      statusCode: 429,
      statusMessage: "Слишком много попыток. Подождите минуту.",
    });
}
export function requireAdmin(event: H3Event) {
  if (event.context.user?.role !== "admin")
    throw createError({
      statusCode: 403,
      statusMessage: "Доступ только для администратора.",
    });
}
