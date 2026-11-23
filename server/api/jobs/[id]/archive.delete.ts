import { requireCurrentUser } from "../../../utils/account";
import { getQueue } from "../../../utils/queue.mjs";

export default defineEventHandler((event) => {
  const user = requireCurrentUser(event);
  const queue = getQueue();
  const job = queue.jobs.find(
    (item: { id: string }) => item.id === getRouterParam(event, "id"),
  );
  if (!job || !queue.canAccess(job, user))
    throw createError({ statusCode: 404, statusMessage: "Загрузка не найдена." });
  try {
    queue.deleteFiles(job, "owner");
  } catch (error) {
    const busy = (error as Error).message === "busy";
    throw createError({
      statusCode: busy ? 409 : 500,
      statusMessage: busy
        ? "Дождитесь завершения загрузки и архивации."
        : "Не удалось удалить архив. Повторите позже.",
    });
  }
  return { ok: true };
});
