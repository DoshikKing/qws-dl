import { validSession } from "../utils/auth.mjs";

export default defineEventHandler((event) => {
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
  if (event.path.split("?")[0] === "/api/health") return;
  if (!process.env.WEB_PASSWORD)
    throw createError({
      statusCode: 503,
      statusMessage: "Задайте WEB_PASSWORD в .env и перезапустите сервер.",
    });
  if (event.path.split("?")[0] === "/api/login") return;
  if (
    !validSession(getCookie(event, "qws_session"), process.env.WEB_PASSWORD)
  ) {
    throw createError({
      statusCode: 401,
      statusMessage: "Войдите в интерфейс.",
    });
  }
});
