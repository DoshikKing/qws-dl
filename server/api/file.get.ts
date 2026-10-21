import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { safeFile } from "../utils/files.mjs";
import { config } from "../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  let file;
  try {
    file = await safeFile(config().downloads, getQuery(event).path);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Файл не найден." });
  }
  setResponseHeaders(event, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String((await stat(file)).size),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(file)).replace(/'/g, "%27")}`,
  });
  return sendStream(event, createReadStream(file));
});
