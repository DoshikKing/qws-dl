import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler((event) => {
  const queue = getQueue();
  queue.cleanupExpired();
  return queue.jobs.filter((job: { userId?: string }) =>
    queue.canAccess(job, event.context.user),
  );
});
