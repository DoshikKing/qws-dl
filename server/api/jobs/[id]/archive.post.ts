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
    queue.retryArchive(job);
  } catch (error) {
    throw createError({
      statusCode: (error as Error).message === "expired" ? 410 : 409,
      statusMessage:
        (error as Error).message === "expired"
          ? "Файлы удалены."
          : "Архивация уже выполняется.",
    });
  }
  setResponseStatus(event, 202);
  return { ok: true };
});
