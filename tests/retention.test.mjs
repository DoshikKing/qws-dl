import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadQueue } from '../server/utils/queue.mjs';
import { loadDefaults, saveDefaults } from '../server/utils/app-settings.mjs';
import { uploadRequest } from '../server/utils/uploads.mjs';

test('defaults persist atomically, use environment fallbacks and reject unsafe/unexpected values', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-defaults-'));
  const settings = { data: base, quality: 'lossless', retentionHours: 6 };
  try {
    assert.equal(loadDefaults(settings).quality, 'lossless');
    const defaults = { quality: 'high', retentionMode: 'downloads', retentionHours: 3, downloadLimit: 2, lyrics: true };
    assert.deepEqual(saveDefaults(settings, defaults), defaults);
    assert.deepEqual(loadDefaults({ ...settings, quality: 'hifi' }), defaults);
    assert.equal((await stat(join(base, 'app-settings.json'))).mode & 0o777, 0o600);
    for (const bad of [{ ...defaults, quality: 'unknown' }, { ...defaults, downloadLimit: 0 }, { ...defaults, downloadLimit: 101 },
      { ...defaults, retentionHours: 25 }, { ...defaults, lyrics: 'true' }, { ...defaults, root: '/tmp' }, { quality: 'high' }]) {
      assert.throws(() => saveDefaults(settings, bad));
      assert.deepEqual(loadDefaults(settings), defaults);
    }
    assert.deepEqual(JSON.parse(await readFile(join(base, 'app-settings.json'), 'utf8')), defaults);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('download-count retention reserves concurrent transfers, releases aborts, counts once and cleans only after the last completion', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-retention-'));
  const settings = { data: base, downloads: join(base, 'downloads'), minFreeBytes: 0 };
  let queue;
  try {
    queue = new DownloadQueue(settings); queue.stopping = true;
    const job = queue.add('https://open.qobuz.com/album/123', 'hifi', 3, 'alice', true, { retentionMode: 'downloads', downloadLimit: 2 });
    job.status = 'completed'; job.finishedAt = new Date().toISOString();
    await mkdir(queue.folder(job)); await writeFile(join(queue.folder(job), '.qws-archive.zip'), 'fixture');
    job.hasFiles = true;
    assert.equal(job.expiresAt, null);
    assert.equal(queue.expired(job, Date.now() + 999999999), false);
    assert.throws(() => queue.add(job.url, 'hifi', 3, 'alice', false, { retentionMode: 'unknown' }));
    assert.throws(() => queue.add(job.url, 'hifi', 3, 'alice', false, { retentionMode: 'downloads', downloadLimit: 1.1 }));
    const first = queue.reserveArchive(job), second = queue.reserveArchive(job);
    assert.throws(() => queue.reserveArchive(job), { statusCode: 409 });
    first(false); first(true); assert.equal(job.downloadCount, 0);
    queue.reserveArchive(job); // An unfinished reservation is released by a process restart.
    second(true); second(true); assert.equal(job.downloadCount, 1); assert.equal(job.hasFiles, true);
    queue.save(); queue.close();
    queue = new DownloadQueue(settings); queue.stopping = true;
    const restored = queue.jobs.find(item => item.id === job.id);
    assert.equal(restored.downloadCount, 1); assert.equal(restored.expiresAt, null);
    const last = queue.reserveArchive(restored); last(true);
    assert.equal(restored.downloadCount, 2); assert.equal(queue.expired(restored), true);
    assert.equal(restored.hasFiles, false); assert.ok(restored.expiredAt);
    assert.throws(() => queue.reserveArchive(restored), { statusCode: 410 });
    assert.ok((await stat(base)).isDirectory());
    const retryAlbum = { ...job, status: 'failed', tracks: [{ id: '11', status: 'failed', title: 'Песня' }] };
    const retry = queue.retryTrack(retryAlbum, '11', { id: 'alice' });
    assert.equal(retry.retentionMode, 'downloads'); assert.equal(retry.downloadLimit, 2); assert.equal(retry.downloadCount, 0);
  } finally { queue?.close(); await rm(base, { recursive: true, force: true }); }
});

test('uploads accept download-count retention and validate limits without weakening file/time bounds', () => {
  const valid = { 'content-type': 'application/octet-stream', 'x-file-name': 'song.flac', 'x-retention-mode': 'downloads', 'x-download-limit': '2' };
  assert.equal(uploadRequest(valid).downloadLimit, 2);
  assert.equal(uploadRequest(valid).retentionMode, 'downloads');
  for (const bad of [{ 'x-download-limit': '0' }, { 'x-download-limit': '101' }, { 'x-retention-mode': 'unknown' }, { 'x-retention-hours': '6' }])
    assert.throws(() => uploadRequest({ ...valid, ...bad }), { statusCode: 400 });
});
