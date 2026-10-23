import { requireAdmin, limitAuth } from '../../../utils/account';
import { config } from '../../../utils/queue.mjs';
import { beginQobuzLogin, oauthLifetime } from '../../../utils/qobuz-oauth.mjs';

export default defineEventHandler(async event => {
  requireAdmin(event);
  limitAuth(event);
  const settings = config();
  const base = useRuntimeConfig(event).app.baseURL.replace(/\/?$/, '/');
  const requestURL = getRequestURL(event, { xForwardedProto: true });
  const callback = new URL(base + 'api/qobuz/callback', requestURL.origin);
  try {
    const flow = await beginQobuzLogin(settings, getCookie(event, 'qws_session'), callback.href);
    setCookie(event, 'qws_qobuz_flow', flow.state, { httpOnly: true, sameSite: 'lax',
      secure: requestURL.protocol === 'https:', path: base + 'api/qobuz/callback', maxAge: oauthLifetime / 1000 });
    return { url: flow.url };
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Не удалось начать вход в Qobuz. Проверьте соединение и обновление приложения.' });
  }
});
