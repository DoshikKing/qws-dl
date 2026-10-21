import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { basename, relative } from "node:path";
import { safeFile } from "../utils/files.mjs";
import { getQueue } from "../utils/queue.mjs";
export default defineEventHandler(async (event) => {
  let file;
  let info;
  const queue = getQueue();
  queue.cleanupExpired();
  try {
    file = await safeFile(queue.settings.downloads, getQuery(event).path);
    if (
      queue.pathExpired(
        relative(await realpath(queue.settings.downloads), file),
      )
    )
      throw new Error("expired");
    info = await stat(file);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Файл не найден." });
  }
  setResponseHeaders(event, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(info.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(file)).replace(/'/g, "%27")}`,
  });
  return sendStream(event, createReadStream(file));
});
