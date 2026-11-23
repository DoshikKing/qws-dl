import { requireAdmin, requireCurrentUser, limitAuth } from '../../../utils/account';
import { config } from '../../../utils/queue.mjs';
import { getQobuzRefresher } from '../../../utils/qobuz-refresh.mjs';
import { readQobuzSession } from '../../../utils/qobuz-session.mjs';
import { subscriptionStatus } from '../../../utils/qobuz-subscription.mjs';
export default defineEventHandler(async event => {
  requireAdmin(event);
  limitAuth(event);
  const settings = config();
  const result = await getQobuzRefresher(settings).refresh(Date.now(), true);
  requireCurrentUser(event);
  requireAdmin(event);
  if (result !== 'updated') throw createError({
    statusCode: result === 'rate_limited' ? 429 : result === 'failed' ? 502 : 409,
    statusMessage: result === 'rate_limited' ? 'Проверка уже выполнялась. Повторите позже.'
      : result === 'failed' ? 'Не удалось получить новые данные Qobuz. Попробуйте позже.' : 'Войдите снова в Qobuz.',
  });
  return subscriptionStatus(readQobuzSession(settings.data));
});
