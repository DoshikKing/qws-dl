import { listFiles } from "../utils/files.mjs";
import { config } from "../utils/queue.mjs";
export default defineEventHandler(() => listFiles(config().downloads));
