import { getQueue, readiness } from "../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  const ready = readiness();
  if (!ready.ready)
    throw createError({
      statusCode: 503,
      statusMessage: "Настройте OrpheusDL и данные Qobuz в .env.",
    });
  const body = await readBody(event);
  try {
    return getQueue().add(body?.url, body?.quality || ready.quality);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message,
    });
  }
});
