import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler(() => getQueue().jobs);
