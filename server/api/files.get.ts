import { listFiles } from "../utils/files.mjs";
import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler(async () => {
  const queue = getQueue();
  queue.cleanupExpired();
  const result = await listFiles(queue.settings.downloads);
  result.files = result.files.filter((file) => !queue.pathExpired(file.path));
  return result;
});
