import { getQueue } from "../../../utils/queue.mjs";
export default defineEventHandler((event) => {
  const queue = getQueue();
  const job = queue.jobs.find(
    (item: { id: string }) => item.id === getRouterParam(event, "id"),
  );
  if (
    !job ||
    !(
      queue.canAccess(job, event.context.user) ||
      event.context.user.role === "admin"
    )
  )
    throw createError({
      statusCode: 404,
      statusMessage: "Загрузка не найдена.",
    });
  try {
    const started = queue.retryArchive(job);
    setResponseStatus(event, started ? 202 : 200);
  } catch (error) {
    throw createError({
      statusCode: (error as Error).message === "expired" ? 410 : (error as Error).message === "empty" ? 404 : 409,
      statusMessage:
        (error as Error).message === "expired"
          ? "Файлы удалены."
          : (error as Error).message === "empty" ? "Нет файлов для архива." : "Архивация уже выполняется.",
    });
  }
  return { ok: true };
});
