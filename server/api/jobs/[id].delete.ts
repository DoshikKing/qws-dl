import { getQueue } from "../../utils/queue.mjs";
export default defineEventHandler((event) => {
  if (!getQueue().cancel(getRouterParam(event, "id")))
    throw createError({
      statusCode: 404,
      statusMessage: "Задание не найдено.",
    });
  return { ok: true };
});
