import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { getQueue } from "../utils/queue.mjs";
import { requireCurrentUser } from "../utils/account";
import { uploadLimit, uploadRequest } from "../utils/uploads.mjs";
import { requireSpace } from "../utils/storage.mjs";

const receiving = new Set<string>();
export default defineEventHandler(async (event) => {
  const user = requireCurrentUser(event);
  if (receiving.has(user.id) || receiving.size >= 2)
    throw createError({ statusCode: 429, statusMessage: "Загрузка файлов уже выполняется. Повторите позже." });
  const queue = getQueue();
  let job: any;
  let handle;
  const request = event.node.req;
  let timer: ReturnType<typeof setTimeout> | undefined;
  receiving.add(user.id);
  try {
    const input = uploadRequest(getHeaders(event));
    job = queue.addUpload(input.filename, input.retentionHours, user.id, input.metadata);
    const folder = queue.folder(job);
    await mkdir(folder, { mode: 0o700 });
    handle = await open(join(folder, input.filename), "wx", 0o600);
    let size = 0;
    timer = setTimeout(() => request.destroy(new Error("Upload timeout")), 120000);
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > Math.min(uploadLimit, queue.settings.maxJobBytes))
        throw createError({ statusCode: 413, statusMessage: "Файл превышает допустимый размер (до 100 МиБ)." });
      const used = queue.jobs.filter((other: any) => other.userId === user.id && other.id !== job.id && !queue.expired(other))
        .reduce((bytes: number, other: any) => bytes + (other.sizeBytes || 0), 0);
      if (used + size * 2 + 2 * 1024 * 1024 > queue.settings.maxUserBytes)
        throw createError({ statusCode: 507, statusMessage: "Лимит хранилища аккаунта исчерпан." });
      requireSpace(queue.settings, size + chunk.length + 2 * 1024 * 1024);
      requireCurrentUser(event);
      if (job.status !== "uploading") throw createError({ statusCode: 409, statusMessage: "Загрузка отменена." });
      await handle.writeFile(chunk);
      job.sizeBytes = size;
    }
    await handle.close();
    handle = undefined;
    if (!request.complete || !size)
      throw createError({ statusCode: 400, statusMessage: "Файл пуст или загрузка прервана." });
    requireCurrentUser(event); // Recheck revocation after receiving a slow request body.
    queue.finishUpload(job);
    return { id: job.id };
  } catch (cause) {
    request.pause();
    event.node.res.shouldKeepAlive = false;
    await handle?.close().catch(() => {});
    if (job) queue.discardUpload(job);
    const error = cause as Error & { statusCode?: number; statusMessage?: string };
    throw createError({ statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || (error.statusCode ? error.message : "Не удалось принять файл. Повторите загрузку.") });
  } finally {
    clearTimeout(timer);
    receiving.delete(user.id);
  }
});
