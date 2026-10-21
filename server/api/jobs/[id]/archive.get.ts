import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { getQueue } from "../../../utils/queue.mjs";
import { jobArchive } from "../../../utils/archive.mjs";

export default defineEventHandler(async (event) => {
  const queue = getQueue();
  queue.cleanupExpired();
  const job = queue.jobs.find(
    (item: { id: string }) => item.id === getRouterParam(event, "id"),
  );
  if (!job)
    throw createError({
      statusCode: 404,
      statusMessage: "Задание не найдено.",
    });
  let file;
  try {
    file = await jobArchive(queue, job);
  } catch (error) {
    const code = (error as Error).message;
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
          ? "Срок хранения истёк."
          : code === "running"
            ? "Дождитесь завершения загрузки."
            : code === "empty"
              ? "Нет файлов для архива."
              : "Не удалось создать ZIP-архив.",
    });
  }
  if (queue.expired(job))
    throw createError({
      statusCode: 410,
      statusMessage: "Срок хранения истёк.",
    });
  setResponseHeaders(event, {
    "Content-Type": "application/zip",
    "Content-Length": String((await stat(file)).size),
    "Content-Disposition": `attachment; filename="qobuz-${job.id}.zip"`,
  });
  return sendStream(event, createReadStream(file));
});
