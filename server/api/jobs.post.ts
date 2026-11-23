import { loadDefaults } from '../utils/app-settings.mjs';
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
    const queue = getQueue();
    const defaults = loadDefaults(queue.settings);
    return queue.add(
      body?.url,
      body?.quality ?? defaults.quality,
      body?.retentionHours ?? defaults.retentionHours,
      user.id,
      body?.lyrics ?? defaults.lyrics,
      { retentionMode: body?.retentionMode ?? defaults.retentionMode, downloadLimit: body?.downloadLimit ?? defaults.downloadLimit },
      body?.outputFormat ?? "original",
    );
  } catch (error) {
    throw createError({
      statusCode: (error as Error & { statusCode?: number }).statusCode || 400,
      statusMessage: (error as Error).message,
    });
  }
});
