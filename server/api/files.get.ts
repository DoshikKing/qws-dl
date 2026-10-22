import { getQueue } from "../utils/queue.mjs";
import { listArchives } from "../utils/downloads.mjs";
export default defineEventHandler(async (event) => {
  const queue = getQueue();
  queue.cleanupExpired();
  return listArchives(queue, event.context.user);
});
