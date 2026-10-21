import { passwordMatches, sessionToken } from "../utils/auth.mjs";

// A global attempt limit also applies behind proxies without trusting forwarded IPs.
let attempts = 0;
let windowStart = Date.now();
export default defineEventHandler(async (event) => {
  if (Date.now() - windowStart > 60_000) {
    attempts = 0;
    windowStart = Date.now();
  }
  if (++attempts > 15)
    throw createError({
      statusCode: 429,
      statusMessage: "Слишком много попыток. Подождите минуту.",
    });
  const body = await readBody(event);
  if (!passwordMatches(body?.password, process.env.WEB_PASSWORD))
    throw createError({ statusCode: 401, statusMessage: "Неверный пароль." });
  setCookie(event, "qws_session", sessionToken(process.env.WEB_PASSWORD!), {
    httpOnly: true,
    sameSite: "strict",
    secure: getRequestURL(event).protocol === "https:",
    path: "/",
    maxAge: 43200,
  });
  return { ok: true };
});
