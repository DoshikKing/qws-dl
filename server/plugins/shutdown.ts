import { getQueue } from "../utils/queue.mjs";
import { closeArchives } from "../utils/archive.mjs";
export default defineNitroPlugin((nitro) => {
  getQueue();
  nitro.hooks.hook("close", () => {
    getQueue().close();
    closeArchives();
  });
});
