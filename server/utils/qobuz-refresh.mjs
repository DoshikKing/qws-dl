import { oauthWorker } from './qobuz-oauth.mjs';
import { readQobuzSession, saveQobuzSession } from './qobuz-session.mjs';

export function renewalDue(session, now = Date.now()) {
  if (!session || session.needsLogin) return false;
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
  }
  start() {
    this.timer = setInterval(() => { void this.refresh(); }, 60_000);
    this.timer.unref();
    void this.refresh();
  }
  async refresh(now = Date.now()) {
    if (this.inflight) return this.inflight;
    const snapshot = readQobuzSession(this.settings.data);
    if (this.stopped || now < this.retryAt || !renewalDue(snapshot, now)) return;
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
        if (unchanged()) saveQobuzSession({ ...session, updatedAt: new Date(now).toISOString() }, this.settings.data);
        this.retryAt = now + 5 * 60_000; // Also bound retries if Qobuz returns an unchanged, nearly expired token.
      } catch (error) {
        this.retryAt = now + 5 * 60_000;
        if (error.code === 'session_expired' && unchanged()) {
          try { saveQobuzSession({ ...snapshot, needsLogin: true }, this.settings.data); } catch { /* Keep the previous file on storage failure. */ }
        }
        // Network/client failures retain the current session; no upstream exception text is logged.
      } finally { this.inflight = null; }
    })();
    return this.inflight;
  }
  close() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
