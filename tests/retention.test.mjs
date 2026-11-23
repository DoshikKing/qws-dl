import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadQueue } from '../server/utils/queue.mjs';
import { loadDefaults, saveDefaults } from '../server/utils/app-settings.mjs';
import { archiveExpiration } from '../server/utils/retention.mjs';
import { uploadRequest } from '../server/utils/uploads.mjs';

test('defaults persist atomically, use environment fallbacks and reject unsafe/unexpected values', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-defaults-'));
  const settings = { data: base, quality: 'lossless', retentionHours: 6 };
  try {
    assert.equal(loadDefaults(settings).quality, 'lossless');
    const defaults = { quality: 'high', retentionMode: 'downloads', retentionHours: 3, downloadLimit: 2, downloadRetentionHours: 168, lyrics: true };
    assert.deepEqual(saveDefaults(settings, defaults), defaults);
    assert.deepEqual(loadDefaults({ ...settings, quality: 'hifi' }), defaults);
    assert.equal((await stat(join(base, 'app-settings.json'))).mode & 0o777, 0o600);
    for (const bad of [{ ...defaults, quality: 'unknown' }, { ...defaults, downloadLimit: 0 }, { ...defaults, downloadLimit: 16 },
      { ...defaults, downloadRetentionHours: 0 }, { ...defaults, downloadRetentionHours: 721 }, { ...defaults, downloadRetentionHours: 1.5 }, { ...defaults, retentionHours: 25 }, { ...defaults, lyrics: 'true' }, { ...defaults, root: '/tmp' }, { quality: 'high' }]) {
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
    job.expiresAt = archiveExpiration(job);
    assert.equal(Date.parse(job.expiresAt) - Date.parse(job.finishedAt), 168 * 3600_000);
    assert.equal(queue.expired(job, Date.parse(job.expiresAt) - 1), false);
    assert.equal(queue.expired(job, Date.parse(job.expiresAt)), true);
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
    assert.equal(restored.downloadCount, 1); assert.equal(restored.expiresAt, job.expiresAt);
    const last = queue.reserveArchive(restored); last(true);
    assert.equal(restored.downloadCount, 2); assert.equal(queue.expired(restored), true);
    assert.equal(restored.hasFiles, false); assert.ok(restored.expiredAt);
    assert.throws(() => queue.reserveArchive(restored), { statusCode: 410 });
    assert.ok((await stat(base)).isDirectory());
    const retryAlbum = { ...job, status: 'failed', tracks: [{ id: '11', status: 'failed', title: 'Песня' }] };
    const retry = queue.retryTrack(retryAlbum, '11', { id: 'alice' });
    assert.equal(retry.retentionMode, 'downloads'); assert.equal(retry.downloadLimit, 2); assert.equal(retry.downloadCount, 0); assert.equal(retry.downloadRetentionHours, 168);
  } finally { queue?.close(); await rm(base, { recursive: true, force: true }); }
});

test('uploads accept download-count retention and validate limits without weakening file/time bounds', () => {
  const valid = { 'content-type': 'application/octet-stream', 'x-file-name': 'song.flac', 'x-retention-mode': 'downloads', 'x-download-limit': '2' };
  assert.equal(uploadRequest(valid).downloadLimit, 2);
  assert.equal(uploadRequest(valid).retentionMode, 'downloads');
  for (const bad of [{ 'x-download-limit': '0' }, { 'x-download-limit': '16' }, { 'x-retention-mode': 'unknown' }, { 'x-retention-hours': '6' }])
    assert.throws(() => uploadRequest({ ...valid, ...bad }), { statusCode: 400 });
});

test('counted archives expire without downloads, snapshot admin TTL and migrate old unlimited jobs and defaults', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-count-expiry-'));
  const settings = { data: base, downloads: join(base, 'downloads'), minFreeBytes: 0 };
  let queue;
  try {
    const defaults = { quality: 'hifi', retentionMode: 'downloads', retentionHours: 4, downloadLimit: 15, downloadRetentionHours: 1, lyrics: false };
    saveDefaults(settings, defaults);
    queue = new DownloadQueue(settings); queue.stopping = true;
    const job = queue.add('https://open.qobuz.com/track/123', 'hifi', 4, 'alice', false, { retentionMode: 'downloads', downloadLimit: 15, downloadRetentionHours: 720 });
    assert.equal(job.downloadRetentionHours, 1); // The client cannot extend the administrator's TTL.
    job.status = 'completed'; job.finishedAt = new Date().toISOString(); job.expiresAt = archiveExpiration(job);
    await mkdir(queue.folder(job)); await writeFile(join(queue.folder(job), '.qws-archive.zip'), 'fixture'); job.hasFiles = true;
    saveDefaults(settings, { ...defaults, downloadRetentionHours: 720 });
    assert.equal(job.downloadRetentionHours, 1);
    const upload = queue.addUpload('song.flac', 5, 'bob', {}, { retentionMode: 'downloads', downloadLimit: 15, downloadRetentionHours: 1 });
    assert.equal(upload.downloadRetentionHours, 720);
    assert.throws(() => queue.add(job.url, 'hifi', 4, 'alice', false, { retentionMode: 'downloads', downloadLimit: 16 }));
    queue.cleanupExpired(Date.parse(job.expiresAt));
    assert.equal(job.downloadCount, 0); assert.ok(job.expiredAt); assert.equal(queue.hasFolder(job), false);
    assert.throws(() => queue.reserveArchive(job), { statusCode: 410 });
    const legacy = queue.add(job.url, 'hifi', 4, 'alice', false, { retentionMode: 'downloads', downloadLimit: 15 });
    legacy.status = 'completed'; legacy.finishedAt = new Date().toISOString(); legacy.downloadLimit = 100; delete legacy.downloadRetentionHours;
    await mkdir(queue.folder(legacy)); await writeFile(join(queue.folder(legacy), '.qws-archive.zip'), 'fixture');
    queue.save(); queue.close();
    const oldDefaults = { ...defaults, downloadLimit: 100 }; delete oldDefaults.downloadRetentionHours;
    await writeFile(join(base, 'app-settings.json'), JSON.stringify(oldDefaults));
    assert.equal(loadDefaults(settings).downloadLimit, 15); assert.equal(loadDefaults(settings).downloadRetentionHours, 168);
    queue = new DownloadQueue(settings); queue.stopping = true;
    const restored = queue.jobs.find(item => item.id === legacy.id);
    assert.equal(restored.downloadLimit, 15); assert.equal(restored.downloadRetentionHours, 168);
    assert.equal(Date.parse(restored.expiresAt) - Date.parse(restored.finishedAt), 168 * 3600_000);
  } finally { queue?.close(); await rm(base, { recursive: true, force: true }); }
});
