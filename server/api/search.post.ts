import { readJsonBody } from "../utils/request";
import { config, readiness } from "../utils/queue.mjs";
import { searchRequest, searchCatalog, SearchError } from "../utils/search.mjs";
export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event);
  try {
    const request = searchRequest(body);
    const settings = config();
    if (!readiness(settings).ready)
      throw new SearchError(
        "Поиск недоступен. Настройте подключение Qobuz на сервере.",
        503,
      );
    return await searchCatalog(settings, event.context.user.id, request);
  } catch (error) {
    const statusCode = error instanceof SearchError ? error.statusCode : 503;
    const message =
      error instanceof SearchError ? error.message : "Поиск Qobuz недоступен.";
    throw createError({
      statusCode,
      statusMessage:
        event.context.user.role !== "admin" && [502, 503].includes(statusCode)
          ? "Поиск Qobuz недоступен. Обратитесь к администратору."
          : message,
    });
  }
});
