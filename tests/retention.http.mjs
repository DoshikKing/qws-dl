import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

test('HTTP defaults and counted ZIPs: permissions, aborted/concurrent transfers, HEAD, restart, final deletion and session revocation', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-counted-'));
  const data = join(base, 'data'), root = join(base, 'orpheus'), python = join(base, 'fixture-python');
  const actualPython = resolve('.runtime/venv/bin/python');
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(done => listener.close(done));
  const origin = `http://127.0.0.1:${port}/dl`;
  let server, paused;
  const request = (path, cookie = '', method = 'GET', body, headers = {}) => fetch(origin + path, {
    method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const until = async check => { for (let i = 0; i < 160; i++) { if (await check()) return; await new Promise(done => setTimeout(done, 50)); } throw Error('Timed out'); };
  const stop = async () => { if (!server || server.exitCode !== null) return; const closed = once(server, 'close');server.kill('SIGTERM');const timer = setTimeout(() => server.kill('SIGKILL'), 5000);await closed;clearTimeout(timer); };
  const start = async () => {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_APP_BASE_URL: '/dl/',
      DATA_DIR: data, DOWNLOAD_DIR: join(base, 'downloads'), ORPHEUS_DIR: root, PYTHON_BIN: python, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'fixture-admin-password', MIN_FREE_BYTES: '0' }, stdio: 'ignore' });
    await until(async () => { try { return (await request('/api/health')).ok; } catch { return false; } });
  };
  try {
    await mkdir(join(root, 'modules/qobuz'), { recursive: true }); await mkdir(data);
    await writeFile(join(root, 'orpheus.py'), '# fixture');await writeFile(join(root, 'modules/qobuz/interface.py'), '# fixture');
    await writeFile(join(data, 'qobuz-session.json'), JSON.stringify({ userId: '123', authToken: 'fixture-token', updatedAt: new Date().toISOString() }));
    await writeFile(python, `#!${actualPython}
import os, sys, time, subprocess, json
from pathlib import Path
if sys.argv[1] != '-u':
    os.execv(${JSON.stringify(actualPython)}, [${JSON.stringify(actualPython)}, *sys.argv[1:]])
if os.environ.get('QWS_OUTPUT_FORMAT', 'original') != 'original':
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.5', '-metadata', 'artist=Fixture', '-metadata', 'title=Track', str(Path(os.environ['DOWNLOAD_DIR'], 'fixture.flac'))], check=True)
    sys.path.insert(0, ${JSON.stringify(resolve('scripts'))})
    from convert_audio import convert_downloads
    convert_downloads(os.environ['DOWNLOAD_DIR'], os.environ['QWS_OUTPUT_FORMAT'], json.loads(os.environ.get('QWS_FORMAT_OPTIONS', '{}')))
    sys.exit(0)
if sys.argv[-2].endswith('/127'): time.sleep(0.5)
with Path(os.environ['DOWNLOAD_DIR'], 'fixture.flac').open('wb') as out:
    out.truncate(32 * 1024**2 if sys.argv[-2].endswith('/999') else 1024)
`, { mode: 0o700 });
    await start();
    const login = async () => { const response = await request('/api/login', '', 'POST', { username: 'admin', password: 'fixture-admin-password' });assert.equal(response.status, 200);return response.headers.get('set-cookie').split(';')[0]; };
    let admin = await login();
    const profile = await (await request('/api/account', admin)).json();
    const register = async username => { const response = await request('/api/register', '', 'POST', { username, password: 'fixture-user-password', inviteCode: profile.inviteCode });assert.equal(response.status, 200);return response.headers.get('set-cookie').split(';')[0]; };
    const alice = await register('alice'), bob = await register('bob');
    assert.equal((await request('/api/admin/settings')).status, 401);
    assert.equal((await request('/api/admin/settings', alice)).status, 403);
    const defaults = { quality: 'lossless', retentionMode: 'downloads', retentionHours: 3, downloadLimit: 2, downloadRetentionHours: 1, lyrics: true };
    assert.equal((await request('/api/admin/settings', bob, 'PUT', defaults)).status, 403);
    assert.equal((await request('/api/admin/settings', admin, 'PUT', { ...defaults, downloadLimit: 0 })).status, 400);
    assert.equal((await request('/api/admin/settings', admin, 'PUT', { ...defaults, data: '/tmp' })).status, 400);
    assert.deepEqual(await (await request('/api/admin/settings', admin, 'PUT', defaults)).json(), defaults);
    const status = await (await request('/api/status', alice)).json();
    assert.equal(status.retentionMode, 'downloads'); assert.equal(status.quality, 'lossless');
    const add = async (id, options = {}) => { const response = await request('/api/jobs', alice, 'POST', { url: 'https://open.qobuz.com/track/' + id, ...options });assert.equal(response.status, 200);return response.json(); };
    const jobs = async () => (await request('/api/jobs', alice)).json();
    const job = await add('123');
    assert.equal(job.downloadLimit, 2);assert.equal(job.lyrics, true);assert.equal(job.quality, 'lossless');assert.equal(job.retentionMode, 'downloads');
    const path = `/api/jobs/${job.id}/archive`;
    await until(async () => (await jobs()).find(item => item.id === job.id)?.hasFiles);
    const head = await request(path, alice, 'HEAD');assert.equal(head.status, 200);assert.ok(Number(head.headers.get('content-length')) > 1024);assert.equal((await head.arrayBuffer()).byteLength, 0);assert.equal(head.headers.get('content-type'), 'application/zip');
    assert.equal((await request(path, bob, 'HEAD')).status, 404);
    assert.equal((await request(path, bob)).status, 404);
    assert.equal((await jobs()).find(item => item.id === job.id).downloadCount, 0);
    const first = await request(path, alice);assert.equal(first.status, 200);assert.ok((await first.arrayBuffer()).byteLength > 1024);
    await until(async () => (await jobs()).find(item => item.id === job.id).downloadCount === 1);
    await stop();await start();
    assert.deepEqual(await (await request('/api/admin/settings', admin)).json(), defaults);
    assert.equal((await jobs()).find(item => item.id === job.id).downloadCount, 1);
    assert.equal(Date.parse((await jobs()).find(item => item.id === job.id).expiresAt) - Date.parse((await jobs()).find(item => item.id === job.id).finishedAt), 3600_000);
    const last = await request(path, alice, 'GET', undefined, { Range: 'bytes=0-9' });assert.equal(last.status, 200);assert.ok((await last.arrayBuffer()).byteLength > 1024);
    await until(async () => !!(await jobs()).find(item => item.id === job.id).expiredAt);
    assert.equal((await request(path, alice)).status, 410);
    await assert.rejects(readFile(join(base, 'downloads', job.id, '.qws-archive.zip')), { code: 'ENOENT' });
    const big = await add('999', { downloadLimit: 1 });const bigPath = `/api/jobs/${big.id}/archive`;
    await until(async () => (await jobs()).find(item => item.id === big.id)?.hasFiles);
    const response = await new Promise((done, reject) => { paused = http.get(origin + bigPath, { headers: { cookie: alice } }, result => { result.pause(); done(result); });paused.on('error', reject); });
    assert.equal(response.statusCode, 200);
    assert.equal((await request(bigPath, alice)).status, 409);
    response.destroy();paused.destroy();
    await new Promise(done => setTimeout(done, 150));
    assert.equal((await jobs()).find(item => item.id === big.id).downloadCount, 0);
    const completed = await request(bigPath, alice);assert.equal(completed.status, 200);assert.ok((await completed.arrayBuffer()).byteLength > 32 * 1024 ** 2);
    await until(async () => !!(await jobs()).find(item => item.id === big.id).expiredAt);
    const timed = await add('125', { downloadRetentionHours: 720 });
    assert.equal(timed.downloadRetentionHours, 1);
    await until(async () => !!(await jobs()).find(item => item.id === timed.id)?.hasFiles);
    await stop();
    const history = JSON.parse(await readFile(join(data, 'jobs.json'), 'utf8'));
    history.find(item => item.id === timed.id).expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(join(data, 'jobs.json'), JSON.stringify(history)); await start();
    assert.equal((await request(`/api/jobs/${timed.id}/archive`, alice)).status, 410);
    assert.equal((await jobs()).find(item => item.id === timed.id).downloadCount, 0);
    await assert.rejects(readFile(join(base, 'downloads', timed.id, '.qws-archive.zip')), { code: 'ENOENT' });
    assert.equal((await request('/api/jobs', alice, 'POST', {url:'https://open.qobuz.com/track/126',downloadLimit:16})).status, 400);
    assert.equal((await request('/api/admin/settings', admin, 'PUT', {...defaults, downloadRetentionHours:721})).status, 400);
    const timeJob = await add('124', { retentionMode: 'time', retentionHours: 2, lyrics: false });
    await until(async () => !!(await jobs()).find(item => item.id === timeJob.id)?.hasFiles);
    assert.ok((await jobs()).find(item => item.id === timeJob.id).expiresAt);
    // Owner deletion is separate from cancellation and admin-wide storage management.
    const owned = await add('127', { retentionMode: 'time', lyrics: false });
    const ownPath = `/api/jobs/${owned.id}/archive`;
    assert.equal((await request(ownPath, alice, 'DELETE')).status, 409);
    await until(async () => !!(await jobs()).find(item => item.id === owned.id)?.hasFiles);
    assert.equal((await request(ownPath, '', 'DELETE')).status, 401);
    assert.equal((await request(ownPath, bob, 'DELETE')).status, 404);
    assert.equal((await request(ownPath, admin, 'DELETE')).status, 404);
    assert.equal((await request(`/api/admin/downloads/${owned.id}`, alice, 'DELETE')).status, 403);
    assert.equal((await request(ownPath, alice, 'DELETE', undefined, {origin:'https://untrusted.example'})).status, 403);
    assert.equal((await request('/api/jobs/missing/archive', alice, 'DELETE')).status, 404);
    assert.ok((await (await request('/api/files', alice)).json()).files.some(file => file.id === owned.id));
    assert.equal((await request(ownPath, alice, 'DELETE')).status, 200);
    const deleted = (await jobs()).find(item => item.id === owned.id);
    assert.ok(deleted.deletedAt); assert.equal(deleted.deletedBy, 'owner'); assert.equal(deleted.hasFiles, false);
    assert.equal(deleted.status, 'completed'); assert.equal(deleted.downloadCount, 0);
    assert.equal((await request(ownPath, alice)).status, 410);
    assert.equal((await request(ownPath, alice, 'POST')).status, 410);
    assert.equal((await request(ownPath, alice, 'DELETE')).status, 200);
    assert.equal((await jobs()).find(item => item.id === owned.id).deletedAt, deleted.deletedAt);
    assert.equal((await request(`/api/admin/downloads/${owned.id}`, admin, 'DELETE')).status, 200);
    assert.equal((await jobs()).find(item => item.id === owned.id).deletedBy, 'owner');
    assert.ok(!(await (await request('/api/files', alice)).json()).files.some(file => file.id === owned.id));
    await assert.rejects(readFile(join(base, 'downloads', owned.id, '.qws-archive.zip')), {code:'ENOENT'});
    // Neighbouring archives and administrator-wide deletion keep working.
    assert.equal((await request(`/api/jobs/${timeJob.id}/archive`, alice, 'HEAD')).status, 200);
    assert.equal((await request(`/api/admin/downloads/${timeJob.id}`, admin, 'DELETE')).status, 200);
    assert.equal((await jobs()).find(item => item.id === timeJob.id).deletedBy, 'admin');
    await stop(); await start();
    assert.equal((await jobs()).find(item => item.id === owned.id).deletedBy, 'owner');
    assert.equal((await request(ownPath, alice)).status, 410);
    await request('/api/logout', bob, 'POST');
    assert.equal((await request(ownPath, bob, 'DELETE')).status, 401);
    const profiles = {mp3:{bitrate:128,sampleRate:44100},aac:{bitrate:192,sampleRate:44100},vorbis:{quality:4,sampleRate:32000},
      opus:{bitrate:96,mode:'cbr',compression:0},ape:{compression:4000,bitDepth:16,sampleRate:44100},
      alac:{bitDepth:24,sampleRate:44100},dsd:{dsdRate:5644800,headroom:9},tta:{bitDepth:24,sampleRate:48000}};
    for (const outputFormat of ['mp3', 'aac', 'vorbis', 'opus', 'ape', 'alac', 'dsd', 'tta']) {
      const converted = await add('130', {outputFormat, formatOptions:profiles[outputFormat], retentionMode:'time', lyrics:false});
      assert.equal(converted.outputFormat, outputFormat);
      for (const [key,value] of Object.entries(profiles[outputFormat])) assert.equal(converted.formatOptions[key], value);
      await until(async () => !!(await jobs()).find(item => item.id === converted.id)?.hasFiles);
      const result = (await jobs()).find(item => item.id === converted.id);
      assert.equal(result.status, 'completed', result.error + ' ' + result.log);
      const zip = await request(`/api/jobs/${converted.id}/archive`, alice); assert.equal(zip.status, 200);
      const archive = join(base, `${outputFormat}.zip`); await writeFile(archive, Buffer.from(await zip.arrayBuffer()));
      const suffix = {mp3:'.mp3',aac:'.m4a',vorbis:'.ogg',opus:'.opus',ape:'.ape',alac:'.m4a',dsd:'.dsf',tta:'.tta'}[outputFormat];
      execFileSync(actualPython, ['-c', `import sys,json,zipfile,tempfile,pathlib
sys.path.insert(0,${JSON.stringify(resolve('scripts'))})
from convert_audio import probe
import mutagen
with tempfile.TemporaryDirectory() as d:
 z=zipfile.ZipFile(sys.argv[1]); assert z.namelist()==['fixture'+sys.argv[2]];z.extractall(d)
 out=pathlib.Path(d)/('fixture'+sys.argv[2]); info,_=probe(out);options=json.loads(sys.argv[3])
 if options.get('sampleRate'): assert int(info['sample_rate'])==options['sampleRate']
 if options.get('bitDepth'): assert int(info['bits_per_raw_sample'])==options['bitDepth']
 if options.get('dsdRate'): assert mutagen.File(out).info.sample_rate==options['dsdRate']
 if sys.argv[2]=='.mp3': assert int(info['bit_rate'])==options['bitrate']*1000
`, archive, suffix, JSON.stringify(profiles[outputFormat])]);
    }
    for (const outputFormat of ['flac;touch /tmp/not-allowed', 'unknown', {}, ['mp3']])
      assert.equal((await request('/api/jobs', alice, 'POST', {url:'https://open.qobuz.com/track/130',outputFormat})).status, 400);
    for (const [outputFormat,formatOptions] of [['mp3',{bitrate:'128'}],['mp3',{bitDepth:24}],['opus',{compression:11}],['ape',{compression:9999}],['dsd',{dsdRate:999999999}],['alac',{bitDepth:32}],['tta',{extra_args:'-y'}],['mp3',null]])
      assert.equal((await request('/api/jobs', alice, 'POST', {url:'https://open.qobuz.com/track/130',outputFormat,formatOptions})).status, 400);
    const slow = http.request(origin + '/api/admin/settings', { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
    const revoked = new Promise((done, reject) => { slow.on('response', async result => { for await (const chunk of result) {} done(result.statusCode); });slow.on('error', reject); });
    slow.write('{');await new Promise(done => setTimeout(done, 100));
    await request('/api/logout', admin, 'POST');slow.end(JSON.stringify({ ...defaults, quality: 'high' }).slice(1));assert.equal(await revoked, 401);
    admin = await login();assert.deepEqual(await (await request('/api/admin/settings', admin)).json(), defaults);
    assert.deepEqual(JSON.parse(await readFile(join(data, 'app-settings.json'), 'utf8')), defaults);
  } finally { paused?.destroy(); await stop(); await rm(base, { recursive: true, force: true }); }
});
