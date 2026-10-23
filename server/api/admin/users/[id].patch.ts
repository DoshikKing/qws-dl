import { readJsonBody } from "../../../utils/request";
import { accountStore, requireAdmin, limitAuth } from "../../../utils/account";
import { getQueue } from "../../../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  limitAuth(event);
  const body = await readJsonBody(event);
  const id = getRouterParam(event, "id");
  try {
    await (await accountStore()).manage(id, body?.action, body?.password);
  } catch (error) {
    throw createError({
      statusCode: (error as Error & { statusCode?: number }).statusCode || 400,
      statusMessage: (error as Error).message,
    });
  }
  if (["disable", "delete"].includes(body?.action)) {
    const queue = getQueue();
    for (const job of queue.jobs) if (job.userId === id) queue.cancel(job.id);
  }
  return { ok: true };
});
