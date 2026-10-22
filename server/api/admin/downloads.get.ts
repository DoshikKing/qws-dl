import { requireAdmin, accountStore } from "../../utils/account";
import { getQueue } from "../../utils/queue.mjs";
import { listArchives } from "../../utils/downloads.mjs";
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const queue = getQueue();
  queue.cleanupExpired();
  return listArchives(queue, event.context.user, (await accountStore()).list());
});
