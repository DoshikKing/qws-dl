import { readJsonBody } from "../utils/request";
import { requireCurrentUser } from "../utils/account";
import { getQueue, readiness } from "../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  const ready = readiness();
  if (!ready.ready)
    throw createError({
      statusCode: 503,
      statusMessage: "Установите OrpheusDL и войдите в Qobuz через настройки.",
    });
  const body = await readJsonBody(event);
  const user = requireCurrentUser(event);
  try {
    return getQueue().add(
      body?.url,
      body?.quality || ready.quality,
      body?.retentionHours ?? ready.retentionHours,
      user.id,
    );
  } catch (error) {
    throw createError({
      statusCode: (error as Error & { statusCode?: number }).statusCode || 400,
      statusMessage: (error as Error).message,
    });
  }
});
