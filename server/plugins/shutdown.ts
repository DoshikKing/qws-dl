import { closeSearches } from "../utils/search.mjs";
import { getQueue, config } from "../utils/queue.mjs";
import { getUsers } from "../utils/users.mjs";
import { closeArchives } from "../utils/archive.mjs";
import { closeQobuzLogin } from '../utils/qobuz-oauth.mjs';
import { QobuzRefresher } from '../utils/qobuz-refresh.mjs';
export default defineNitroPlugin(async (nitro) => {
  // Missing account configuration keeps health checks available; account APIs return 503.
  await getUsers().catch(() => {});
  getQueue();
  const refresher = new QobuzRefresher(config());
  refresher.start();
  nitro.hooks.hook("close", () => {
    getQueue().close();
    closeArchives();
    closeSearches();
    refresher.close();
    closeQobuzLogin();
  });
});
