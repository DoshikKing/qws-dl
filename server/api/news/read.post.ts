import { requireCurrentUser } from '../../utils/account';
import { readJsonBody } from '../../utils/request';
import { acknowledgeNews } from '../../utils/news.mjs';
export default defineEventHandler(async event => {
  const body = await readJsonBody(event);
  const user = requireCurrentUser(event);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'version'))
    throw createError({ statusCode: 400, statusMessage: 'Укажите версию обновления.' });
  try { acknowledgeNews(event.context.userStore, user, body.version); }
  catch (error) {
    throw createError({ statusCode: (error as Error & { statusCode?: number }).statusCode || 503,
      statusMessage: (error as { statusCode?: number }).statusCode ? (error as Error).message : 'Не удалось сохранить просмотр новости.' });
  }
  return { ok: true };
});
