import { getQueue } from "../../utils/queue.mjs";
export default defineEventHandler((event) => {
  const queue = getQueue();
  const job = queue.jobs.find(
    (item: { id: string }) => item.id === getRouterParam(event, "id"),
  );
  if (
    !job ||
    !queue.canAccess(job, event.context.user) ||
    !queue.cancel(job.id)
  )
    throw createError({
      statusCode: 404,
      statusMessage: "Задание не найдено.",
    });
  return { ok: true };
});
