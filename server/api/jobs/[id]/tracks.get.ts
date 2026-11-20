import { getQueue } from '../../../utils/queue.mjs';
export default defineEventHandler((event) => {
  const queue = getQueue();
  const job = queue.jobs.find((item: { id: string }) => item.id === getRouterParam(event, 'id'));
  if (!job || !queue.canAccess(job, event.context.user))
    throw createError({ statusCode: 404, statusMessage: 'Альбом не найден.' });
  return { tracks: queue.albumTracks(job) };
});
