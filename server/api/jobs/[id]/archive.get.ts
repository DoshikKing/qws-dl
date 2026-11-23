import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { getQueue } from "../../../utils/queue.mjs";
import { jobArchive, archiveFilename } from "../../../utils/archive.mjs";

export default defineEventHandler(async (event) => {
  const queue = getQueue();
  queue.cleanupExpired();
  const job = queue.jobs.find(
    (item: { id: string }) => item.id === getRouterParam(event, "id"),
  );
  if (!job || !queue.canAccess(job, event.context.user))
    throw createError({
      statusCode: 404,
      statusMessage: "Задание не найдено.",
    });
  let file;
  try {
    file = await jobArchive(queue, job);
  } catch (error) {
    const code =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "empty"
        : (error as Error).message;
    throw createError({
      statusCode:
        code === "expired"
          ? 410
          : code === "running"
            ? 409
            : code === "empty"
              ? 404
              : 500,
      statusMessage:
        code === "expired"
          ? job.deletedAt
            ? "Архив удалён администратором."
            : job.retentionMode === "downloads" && job.downloadCount >= job.downloadLimit ? "Лимит скачиваний исчерпан." : "Срок хранения истёк."
          : code === "running"
            ? "Дождитесь завершения загрузки."
            : code === "empty"
              ? "Нет файлов для архива."
              : "Не удалось создать ZIP-архив.",
    });
  }
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    throw createError({
      statusCode: queue.expired(job) ? 410 : 404,
      statusMessage: queue.expired(job) ? "Архив удалён." : "Архив не найден.",
    });
  }
  if (queue.expired(job)) {
    await handle.close();
    throw createError({ statusCode: 410, statusMessage: "Архив удалён." });
  }
  let release: ((success: boolean) => void) | undefined;
  try {
    const size = (await handle.stat()).size;
    if (event.method !== "HEAD") release = queue.reserveArchive(job);
    setResponseHeaders(event, {
      "Content-Type": "application/zip",
      "Accept-Ranges": "none",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="qobuz-${job.id}.zip"; filename*=UTF-8''${encodeURIComponent(archiveFilename(job)).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase())}`,
    });
    if (event.method === 'HEAD') {
      await handle.close();
      event.node.res.end(); // Send ZIP headers without streaming or reserving a download.
      return;
    }
    const stream = handle.createReadStream();
    event.node.res.once('finish', () => release?.(event.node.res.statusCode === 200 && stream.bytesRead === size));
    event.node.res.once('close', () => release?.(false));
    stream.once('error', () => release?.(false));
    await pipeline(stream, event.node.res);
  } catch (error) {
    release?.(false);
    await handle.close().catch(() => {});
    if (event.node.res.destroyed) return;
    if ((error as { statusCode?: number }).statusCode)
      throw createError({ statusCode: (error as { statusCode: number }).statusCode, statusMessage: (error as Error).message });
    throw error;
  }
});
