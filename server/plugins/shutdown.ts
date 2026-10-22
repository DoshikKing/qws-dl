import { closeSearches } from "../utils/search.mjs";
import { getQueue } from "../utils/queue.mjs";
import { getUsers } from "../utils/users.mjs";
import { closeArchives } from "../utils/archive.mjs";
export default defineNitroPlugin(async (nitro) => {
  // Missing account configuration keeps health checks available; account APIs return 503.
  await getUsers().catch(() => {});
  getQueue();
  nitro.hooks.hook("close", () => {
    getQueue().close();
    closeArchives();
    closeSearches();
  });
});
