import { accountStore, requireAdmin, limitAuth } from "../../../utils/account";
import { getQueue } from "../../../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  limitAuth();
  const body = await readBody(event);
  const id = getRouterParam(event, "id");
  try {
    await (await accountStore()).manage(id, body?.action, body?.password);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message,
    });
  }
  if (["disable", "delete"].includes(body?.action)) {
    const queue = getQueue();
    for (const job of queue.jobs) if (job.userId === id) queue.cancel(job.id);
  }
  return { ok: true };
});
