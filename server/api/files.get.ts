import { listFiles } from "../utils/files.mjs";
import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  const queue = getQueue();
  queue.cleanupExpired();
  const result = await listFiles(queue.settings.downloads, (path: string) =>
    queue.canAccessPath(path, event.context.user),
  );
  result.files = result.files.filter((file) => !queue.pathExpired(file.path));
  return result;
});
