import { oauthWorker } from './qobuz-oauth.mjs';
import { readQobuzSession, saveQobuzSession } from './qobuz-session.mjs';

export function renewalDue(session, now = Date.now()) {
  if (!session || session.needsLogin) return false;
  if (!Object.hasOwn(session, 'subscription') || (session.subscription && !['user/get', 'user/login'].includes(session.subscription.source))) return true;
  if (!Number.isFinite(Date.parse(session.updatedAt)) || now - Date.parse(session.updatedAt) >= 30 * 60_000) return true;
  // JWT expiry is only a scheduling hint, never proof of authentication.
  try {
    const { exp } = JSON.parse(Buffer.from(session.authToken.split('.')[1], 'base64url').toString());
    return Number.isFinite(exp) && exp * 1000 <= now + 5 * 60_000;
  } catch { return false; }
}

export class QobuzRefresher {
  constructor(settings, worker = oauthWorker) {
    this.settings = settings;
    this.worker = worker;
    this.inflight = null;
    this.retryAt = 0;
    this.stopped = false;
    this.lastAttempt = 0;
    this.lastSucceeded = false;
  }
  start() {
    this.timer = setInterval(() => { void this.refresh(); }, 60_000);
    this.timer.unref();
    void this.refresh();
  }
  async refresh(now = Date.now(), force = false) {
    if (this.inflight) return this.inflight;
    const snapshot = readQobuzSession(this.settings.data);
    if (this.stopped) return 'skipped';
    if (!snapshot) return 'missing_session';
    if (snapshot.needsLogin) return 'login_required';
    if (now < this.retryAt && (!force || !this.lastSucceeded || now < this.lastAttempt + 60_000)) return 'rate_limited';
    if (!force && !renewalDue(snapshot, now)) return 'skipped';
    this.lastAttempt = now;
    const unchanged = () => {
      const current = readQobuzSession(this.settings.data);
      return !this.stopped && current?.authToken === snapshot.authToken &&
        current?.userId === snapshot.userId && current?.updatedAt === snapshot.updatedAt;
    };
    this.inflight = (async () => {
      try {
        const session = await this.worker(this.settings, { action: 'refresh', session: snapshot });
        if (session.userId !== snapshot.userId || typeof session.authToken !== 'string' ||
            !session.authToken || session.authToken.length > 16384) throw new Error('Invalid session');
        if (!unchanged()) return 'skipped';
        saveQobuzSession({ ...session, updatedAt: new Date(now).toISOString() }, this.settings.data);
        this.lastSucceeded = true;
        this.retryAt = now + 5 * 60_000; // Also bound retries if Qobuz returns an unchanged, nearly expired token.
        return 'updated';
      } catch (error) {
        this.lastSucceeded = false;
        this.retryAt = now + 5 * 60_000;
        if (error.code === 'session_expired' && unchanged()) {
          try { saveQobuzSession({ ...snapshot, needsLogin: true }, this.settings.data); } catch { /* Keep the previous file on storage failure. */ }
        }
        // Network/client failures retain the current session; no upstream exception text is logged.
        return error.code === 'session_expired' ? 'login_required' : 'failed';
      } finally { this.inflight = null; }
    })();
    return this.inflight;
  }
  close() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}

let refresher;
export function getQobuzRefresher(settings) {
  return refresher ||= new QobuzRefresher(settings);
}
