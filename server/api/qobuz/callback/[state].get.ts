import { accountStore } from '../../../utils/account';
import { config } from '../../../utils/queue.mjs';
import { finishQobuzLogin } from '../../../utils/qobuz-oauth.mjs';

export default defineEventHandler(async event => {
  const base = useRuntimeConfig(event).app.baseURL.replace(/\/?$/, '/');
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer');
  const query = getQuery(event);
  const flowCookie = getCookie(event, 'qws_qobuz_flow');
  deleteCookie(event, 'qws_qobuz_flow', { path: base + 'api/qobuz/callback' });
  let result = 'failed';
  try {
    await finishQobuzLogin(config(), getRouterParam(event, 'state'), flowCookie,
      query.code ?? query.code_autorisation, await accountStore());
    result = 'connected';
  } catch { /* Never expose provider callback data or exception text. */ }
  return sendRedirect(event, base + '?qobuz=' + result, 303);
});
