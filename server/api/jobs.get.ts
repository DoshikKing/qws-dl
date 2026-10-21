import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler(() => {
  const queue = getQueue();
  queue.cleanupExpired();
  return queue.jobs;
});
