import { getQueue } from "../utils/queue.mjs";
export default defineNitroPlugin((nitro) => {
  getQueue();
  nitro.hooks.hook("close", () => getQueue().close());
});
