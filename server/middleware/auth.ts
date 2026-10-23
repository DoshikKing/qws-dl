import { accountStore } from "../utils/account";

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith("/api/")) return;
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(event.method)) {
    const origin = getHeader(event, "origin");
    if (origin && origin !== getRequestURL(event).origin)
      throw createError({
        statusCode: 403,
        statusMessage: "Недопустимый источник запроса.",
      });
  }
  const path = event.path.split("?")[0];
  if (path === "/api/health" || (/^\/api\/qobuz\/callback\/[a-f0-9]{64}$/.test(path!) && event.method === "GET")) return;
  const store = await accountStore();
  if (["/api/login", "/api/register", "/api/invitations/check"].includes(path!))
    return;
  const user = store.session(getCookie(event, "qws_session"));
  if (!user)
    throw createError({ statusCode: 401, statusMessage: "Войдите в аккаунт." });
  event.context.user = user;
});
