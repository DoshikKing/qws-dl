import { requireCurrentUser } from '../../../../../utils/account';
import { getQueue, readiness } from '../../../../../utils/queue.mjs';
export default defineEventHandler((event) => {
  const user = requireCurrentUser(event);
  const queue = getQueue();
  const job = queue.jobs.find((item: { id: string }) => item.id === getRouterParam(event, 'id'));
  if (!job || !queue.canAccess(job, user))
    throw createError({ statusCode: 404, statusMessage: 'Альбом не найден.' });
  if (!readiness(queue.settings).ready)
    throw createError({ statusCode: 503, statusMessage: 'Загрузки Qobuz недоступны.' });
  try {
    const retry = queue.retryTrack(job, getRouterParam(event, 'trackId'), user);
    return { id: retry.id, status: retry.status };
  } catch (error) {
    throw createError({ statusCode: (error as Error & { statusCode?: number }).statusCode || 400,
      statusMessage: (error as Error).message });
  }
});
