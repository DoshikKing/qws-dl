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
  const settings = { data, root: data, python: process.execPath, authMode: 'web' };
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
    assert.deepEqual(readQobuzSession(data), session);
    assert.equal((await stat(join(data, 'qobuz-session.json'))).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(join(data, 'qobuz-session.json'), 'utf8')), session);
    const env = qobuzEnvironment(data);
    assert.equal(env.QOBUZ_AUTH_MODE, 'token');
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
    assert.deepEqual(readQobuzSession(data), session);
    process.env.QOBUZ_AUTH_MODE = 'mobile';
    assert.notEqual(qobuzEnvironment(data).QOBUZ_AUTH_TOKEN, session.authToken);
  } finally {
    closeQobuzLogin();
    if (originalMode === undefined) delete process.env.QOBUZ_AUTH_MODE;
    else process.env.QOBUZ_AUTH_MODE = originalMode;
    await rm(data, { recursive: true, force: true });
  }
});
