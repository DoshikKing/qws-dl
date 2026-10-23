import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginQobuzLogin, finishQobuzLogin, closeQobuzLogin } from '../server/utils/qobuz-oauth.mjs';
import { readQobuzSession, qobuzEnvironment } from '../server/utils/qobuz-session.mjs';
import { readiness, redact } from '../server/utils/queue.mjs';

test('Qobuz OAuth binds the callback to browser/admin, saves a private session and supplies both workers', async () => {
  const data = await mkdtemp(join(tmpdir(), 'qws-oauth-'));
  const settings = { data, root: data, python: process.execPath };
  const originalMode = process.env.QOBUZ_AUTH_MODE;
  process.env.QOBUZ_AUTH_MODE = 'web';
  let revoked = false;
  const store = { session: value => !revoked && value === 'fixture-admin-session' ? { role: 'admin' } : null };
  const session = { userId: '12345', authToken: 'fixture-private-token' };
  const worker = async (_settings, payload) => payload.action === 'prepare'
    ? { appId: '123456789', privateKey: 'fixture-key', secrets: ['fixture-signing-secret'] }
    : (assert.equal(payload.code, 'fixture-code'), session);
  try {
    const flow = await beginQobuzLogin(settings, 'fixture-admin-session', 'https://example.test/dl/api/qobuz/callback', worker);
    const url = new URL(flow.url);
    assert.equal(url.origin, 'https://www.qobuz.com');
    const callback = new URL(url.searchParams.get('redirect_url'));
    assert.equal(callback.pathname, '/dl/api/qobuz/callback/' + flow.state);
    assert.ok(!flow.url.includes('fixture-key'));
    assert.ok(!flow.url.includes('fixture-admin-session'));
    await assert.rejects(finishQobuzLogin(settings, flow.state, 'wrong-browser', 'fixture-code', store, worker));
    assert.equal(readQobuzSession(data), null);
    await finishQobuzLogin(settings, flow.state, flow.state, 'fixture-code', store, worker);
    assert.equal(readQobuzSession(data).authToken, session.authToken);
    assert.equal((await stat(join(data, 'qobuz-session.json'))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(data, 'qobuz-session.json'), 'utf8')).authToken, session.authToken);
    const env = qobuzEnvironment(data);
    assert.equal(env.QOBUZ_AUTH_MODE, undefined);
    assert.equal(env.QOBUZ_AUTH_TOKEN, session.authToken);
    assert.equal(process.env.QOBUZ_AUTH_MODE, 'web');
    assert.equal(redact(session.authToken, [env.QOBUZ_AUTH_TOKEN]), '[REDACTED]');
    const ready = readiness(settings);
    assert.equal(ready.oauthConnected, true);
    assert.deepEqual(ready.missing, []);
    assert.ok(!JSON.stringify(ready).includes(session.authToken));
    await assert.rejects(finishQobuzLogin(settings, flow.state, flow.state, 'fixture-code', store, worker));
    // A session revoked during the remote exchange cannot replace the saved account.
    const other = await beginQobuzLogin(settings, 'fixture-admin-session', 'https://example.test/api/qobuz/callback', worker);
    await assert.rejects(finishQobuzLogin(settings, other.state, other.state, 'fixture-code', store, async () => {
      revoked = true;
      return { userId: '99999', authToken: 'replacement-token' };
    }));
    assert.equal(readQobuzSession(data).authToken, session.authToken);
    process.env.QOBUZ_AUTH_MODE = 'mobile';
    assert.equal(qobuzEnvironment(data).QOBUZ_AUTH_TOKEN, session.authToken);
  } finally {
    closeQobuzLogin();
    if (originalMode === undefined) delete process.env.QOBUZ_AUTH_MODE;
    else process.env.QOBUZ_AUTH_MODE = originalMode;
    await rm(data, { recursive: true, force: true });
  }
});

test('renewal rotates tokens, bounds retries, stops on revocation and cannot overwrite a new login', async () => {
  const { QobuzRefresher, renewalDue } = await import('../server/utils/qobuz-refresh.mjs');
  const { saveQobuzSession } = await import('../server/utils/qobuz-session.mjs');
  const { writeFile } = await import('node:fs/promises');
  const data = await mkdtemp(join(tmpdir(), 'qws-renew-'));
  const now = Date.now();
  let calls = 0;
  let handler = async () => ({ userId: '12345', authToken: 'rotated-token' });
  const service = new QobuzRefresher({ data }, async (_settings, payload) => {
    calls++;
    assert.equal(payload.action, 'refresh');
    return handler(payload);
  });
  const old = () => saveQobuzSession({ userId: '12345', authToken: 'old-token',
    updatedAt: new Date(now - 31 * 60_000).toISOString() }, data);
  try {
    // Existing two-field files migrate without a browser login.
    await writeFile(join(data, 'qobuz-session.json'), JSON.stringify({ userId: '12345', authToken: 'old-token' }));
    await service.refresh(now);
    assert.equal(readQobuzSession(data).authToken, 'rotated-token');
    assert.equal(readQobuzSession(data).updatedAt, new Date(now).toISOString());
    await service.refresh(now + 60_000);
    assert.equal(calls, 1);
    assert.equal(renewalDue({ authToken: 'opaque', updatedAt: new Date(now).toISOString() }, now), false);
    const jwt = 'x.' + Buffer.from(JSON.stringify({ exp: now / 1000 + 120 })).toString('base64url') + '.x';
    assert.equal(renewalDue({ authToken: jwt, updatedAt: new Date(now).toISOString() }, now), true);
    old();
    let release;
    handler = () => new Promise(resolve => { release = resolve; });
    const pending = service.refresh(now + 31 * 60_000);
    const duplicate = service.refresh(now + 31 * 60_000);
    assert.equal(calls, 2);
    saveQobuzSession({ userId: '999', authToken: 'new-account' }, data);
    release({ userId: '12345', authToken: 'stale-refresh' });
    await Promise.all([pending, duplicate]);
    assert.equal(readQobuzSession(data).authToken, 'new-account');
    old();
    handler = async () => { throw new Error('private transport body'); };
    const retryTime = now + 40 * 60_000;
    await service.refresh(retryTime);
    const failedCalls = calls;
    assert.equal(readQobuzSession(data).authToken, 'old-token');
    assert.equal(readQobuzSession(data).needsLogin, false);
    await service.refresh(retryTime + 60_000);
    assert.equal(calls, failedCalls);
    handler = async () => { throw Object.assign(new Error('secret rejected'), { code: 'session_expired' }); };
    await service.refresh(retryTime + 6 * 60_000);
    assert.equal(readQobuzSession(data).needsLogin, true);
    assert.equal(readiness({ data, root: data, python: process.execPath }).sessionNeedsLogin, true);
    const stoppedCalls = calls;
    await service.refresh(retryTime + 60 * 60_000);
    assert.equal(calls, stoppedCalls);
    old();
    handler = () => new Promise(resolve => { release = resolve; });
    const closing = service.refresh(retryTime + 70 * 60_000);
    service.close();
    release({ userId: '12345', authToken: 'shutdown-token' });
    await closing;
    assert.equal(readQobuzSession(data).authToken, 'old-token');
  } finally {
    service.close();
    await rm(data, { recursive: true, force: true });
  }
});
