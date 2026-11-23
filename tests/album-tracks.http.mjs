import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

test('album tracks HTTP: owner-only manifest and retries, separate ZIP, persistence and base path', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-album-http-'));
  const root = join(base, 'orpheus');
  const data = join(base, 'data');
  const python = join(base, 'fixture-python');
  const actualPython = resolve('.runtime/venv/bin/python');
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const origin = `http://127.0.0.1:${port}/dl`;
  let server;
  const until = async check => {
    for (let i = 0; i < 150; i++) {
      if (await check()) return;
      await new Promise(done => setTimeout(done, 50));
    }
    throw new Error('Timed out waiting for album fixture');
  };
  const request = (path, cookie = '', method = 'GET', body) => fetch(origin + path, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    const closed = once(server, 'close');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timer);
  };
  const start = async () => {
    server = spawn(process.execPath, ['.output/server/index.mjs'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_APP_BASE_URL: '/dl/',
        DATA_DIR: data, DOWNLOAD_DIR: join(base, 'downloads'), ORPHEUS_DIR: root, PYTHON_BIN: python,
        ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'fixture-admin-password', MIN_FREE_BYTES: '0' }, stdio: 'ignore',
    });
    await until(async () => { try { return (await request('/api/health')).ok; } catch { return false; } });
  };
  try {
    await mkdir(join(root, 'modules/qobuz'), { recursive: true });
    await mkdir(data);
    await writeFile(join(root, 'orpheus.py'), '# fixture');
    await writeFile(join(root, 'modules/qobuz/interface.py'), '# fixture');
    await writeFile(join(data, 'qobuz-session.json'), JSON.stringify({ userId: '123', authToken: 'fixture-token', updatedAt: new Date().toISOString() }));
    await writeFile(python, `#!${actualPython}
import json, os, sys, time
from pathlib import Path
if sys.argv[1] != '-u':
    os.execv(${JSON.stringify(actualPython)}, [${JSON.stringify(actualPython)}, *sys.argv[1:]])
folder = Path(os.environ['DOWNLOAD_DIR'])
if '/album/' in sys.argv[-2]:
    (folder / '.qws-metadata.json').write_text(json.dumps({'title': 'Автор - Альбом', 'tracks': [
        {'id': '11', 'title': 'Готовая песня', 'artist': 'Автор', 'status': 'completed'},
        {'id': '22', 'title': 'Ошибка загрузки', 'artist': 'Автор', 'status': 'failed', 'error': 'Соединение прервано.'},
        {'id': '33', 'title': 'Ожидает', 'artist': 'Автор', 'status': 'pending'}]}))
    print('Название: Автор - Альбом', flush=True)
    time.sleep(0.5)
    (folder / 'first.flac').write_bytes(b'fixture-original')
    sys.exit(2)
time.sleep(0.5)
(folder / 'retry.flac').write_bytes(b'fixture-retry')
`, { mode: 0o700 });
    await start();
    const login = await request('/api/login', '', 'POST', { username: 'admin', password: 'fixture-admin-password' });
    const admin = login.headers.get('set-cookie').split(';')[0];
    const profile = await (await request('/api/account', admin)).json();
    const register = async username => {
      const result = await request('/api/register', '', 'POST', { username, password: 'fixture-user-password', inviteCode: profile.inviteCode });
      assert.equal(result.status, 200);
      return result.headers.get('set-cookie').split(';')[0];
    };
    const alice = await register('alice');
    const bob = await register('bob');
    const added = await request('/api/jobs', alice, 'POST', { url: 'https://open.qobuz.com/album/123', quality: 'lossless', retentionHours: 3, lyrics: true, outputFormat: 'opus' });
    assert.equal(added.status, 200);
    const album = await added.json();
    const path = `/api/jobs/${album.id}/tracks`;
    await until(async () => (await (await request(path, alice)).json()).tracks?.length === 3);
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, bob)).status, 404);
    assert.equal((await request(path, admin)).status, 404);
    assert.equal((await request(path + '/22/retry', bob, 'POST')).status, 404);
    assert.equal((await request(path + '/22/retry', admin, 'POST')).status, 404);
    assert.equal((await request(path + '/33/retry', alice, 'POST')).status, 409);
    assert.equal((await request(path + '/999/retry', alice, 'POST')).status, 404);
    const retryResponse = await request(path + '/22/retry', alice, 'POST');
    assert.equal(retryResponse.status, 200);
    const retry = await retryResponse.json();
    assert.equal((await (await request(path + '/22/retry', alice, 'POST')).json()).id, retry.id);
    const jobs = await (await request('/api/jobs', alice)).json();
    const retryJob = jobs.find(job => job.id === retry.id);
    assert.equal(retryJob.url, 'https://open.qobuz.com/track/22');
    assert.equal(retryJob.quality, 'lossless');
    assert.equal(retryJob.outputFormat, 'opus');
    assert.equal(retryJob.retentionHours, 3);
    assert.equal(retryJob.lyrics, true);
    assert.equal(jobs.find(job => job.id === album.id).trackCount, 3);
    assert.ok(jobs.every(job => !('tracks' in job)), 'polling does not copy every album manifest');
    await until(async () => (await (await request('/api/jobs', alice)).json()).find(job => job.id === retry.id)?.hasFiles);
    assert.equal((await request(`/api/jobs/${retry.id}/archive`, alice)).status, 200);
    assert.equal((await request(`/api/jobs/${retry.id}/archive`, bob)).status, 404);
    const list = await (await request(path, alice)).json();
    assert.equal(list.tracks[2].status, 'not_downloaded');
    assert.equal(list.tracks[1].error, 'Соединение прервано.');
    const finalAlbum = (await (await request('/api/jobs', alice)).json()).find(job => job.id === album.id);
    assert.equal(finalAlbum.downloadWarning, true);
    assert.equal(finalAlbum.trackFailureOnly, true);
    assert.equal(list.tracks[1].retry.status, 'completed');
    assert.equal(JSON.parse(await readFile(join(data, 'jobs.json'), 'utf8')).find(job => job.id === album.id).tracks.length, 3);
    await stop();
    await start();
    assert.equal((await (await request(path, alice)).json()).tracks.length, 3);
    assert.equal((await (await request('/api/jobs', alice)).json()).find(job => job.id === album.id).outputFormat, 'opus');
  } finally {
    await stop();
    await rm(base, { recursive: true, force: true });
  }
});
