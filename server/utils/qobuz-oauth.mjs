import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { saveQobuzSession, workerEnvironment } from './qobuz-session.mjs';

export const oauthLifetime = 600_000;
const flows = new Map();
const children = new Set();
export function oauthWorker(settings, payload) {
  return new Promise((done, reject) => {
    const child = execFile(settings.python, [resolve('scripts/qobuz_oauth.py')],
      { timeout: 90_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, env: workerEnvironment() }, (error, stdout) => {
        children.delete(child);
        try {
          const value = JSON.parse(stdout);
          if (value?.error === 'session_expired') {
            const expired = new Error('Войдите снова в Qobuz.');
            expired.code = 'session_expired';
            reject(expired);
            return;
          }
          if (error || !value || value.error) throw new Error();
          done(value);
        } catch { reject(new Error('Не удалось выполнить вход в Qobuz. Повторите вход на сайте Qobuz.')); }
      });
    children.add(child);
    child.stdin.on('error', () => {});
    // Codes and session material never appear in process arguments or server logs.
    child.stdin.end(JSON.stringify(payload));
  });
}
export async function beginQobuzLogin(settings, adminSession, redirect, worker = oauthWorker) {
  for (const [key, flow] of flows) if (flow.expiresAt <= Date.now()) flows.delete(key);
  if (flows.size >= 16) throw new Error('Слишком много запросов входа. Подождите десять минут.');
  const context = await worker(settings, { action: 'prepare' });
  if (!/^[0-9]{9}$/.test(context.appId) || typeof context.privateKey !== 'string' || !Array.isArray(context.secrets))
    throw new Error('Не удалось получить параметры входа Qobuz.');
  // Recheck after the asynchronous preparation to bound concurrent requests too.
  if (flows.size >= 16) throw new Error('Слишком много запросов входа.');
  const state = randomBytes(32).toString('hex');
  flows.set(state, { adminSession, context, expiresAt: Date.now() + oauthLifetime });
  const callback = new URL(redirect);
  // Keep state in the path: providers may append ?code= without preserving a redirect query.
  callback.pathname = callback.pathname.replace(/\/?$/, '/') + state;
  const url = new URL('https://www.qobuz.com/signin/oauth');
  url.searchParams.set('ext_app_id', context.appId);
  url.searchParams.set('redirect_url', callback.href);
  return { state, url: url.href };
}
export async function finishQobuzLogin(settings, state, cookie, code, store, worker = oauthWorker) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || cookie !== state)
    throw new Error('Начните вход из настроек приложения.');
  const flow = flows.get(state);
  if (!flow || flow.expiresAt <= Date.now()) throw new Error('Время ожидания входа истекло.');
  flows.delete(state);
  if (store.session(flow.adminSession)?.role !== 'admin') throw new Error('Войдите повторно в аккаунт администратора.');
  if (typeof code !== 'string' || !code || code.length > 8192 || /[\x00-\x1f\x7f]/.test(code))
    throw new Error('Qobuz не передал код входа.');
  const session = await worker(settings, { action: 'exchange', context: flow.context, code });
  if (!/^[0-9]{1,32}$/.test(session.userId) || typeof session.authToken !== 'string' ||
      !session.authToken || session.authToken.length > 16384) throw new Error('Qobuz не вернул сессию.');
  // A block/logout/password reset while the exchange is running revokes this flow.
  if (store.session(flow.adminSession)?.role !== 'admin') throw new Error('Войдите повторно в аккаунт администратора.');
  saveQobuzSession(session, settings.data);
}
export function closeQobuzLogin() {
  flows.clear();
  for (const child of children) child.kill('SIGKILL');
  children.clear();
}
