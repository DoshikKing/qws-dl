import type { H3Event } from "h3";
import { getUsers } from "./users.mjs";
import { isIP } from "node:net";
import { takeLimit } from "./rate-limit.mjs";

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
export function limitAuth(event: H3Event) {
  // Enable only behind a proxy that overwrites X-Real-IP and hides the app port.
  const forwarded = getHeader(event, "x-real-ip") || "";
  const client = process.env.TRUST_PROXY === "true" && isIP(forwarded)
    ? forwarded : event.node.req.socket.remoteAddress || "unknown";
  const operation = event.path.split("?")[0];
  const identity = event.context.user?.id || client;
  if (!takeLimit(`auth:${operation}:${identity}`, 30))
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

export function requireCurrentUser(event: H3Event) {
  const user = event.context.userStore?.session(getCookie(event, "qws_session"));
  if (!user) throw createError({ statusCode: 401, statusMessage: "Войдите в аккаунт." });
  event.context.user = user;
  return user;
}
