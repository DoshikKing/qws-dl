import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadQueue } from '../server/utils/queue.mjs';

test('album manifest survives archives/restarts; track retries preserve settings, quotas and ownership', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qws-tracks-'));
  const settings = { data: base, downloads: join(base, 'downloads'), minFreeBytes: 0, maxUserJobs: 1 };
  let queue;
  try {
    queue = new DownloadQueue(settings);
    queue.stopping = true;
    const owner = { id: 'alice', role: 'user' };
    const album = queue.add('https://open.qobuz.com/album/123', 'lossless', 3, owner.id, true);
    const folder = queue.folder(album);
    await mkdir(folder);
    const metadata = join(folder, '.qws-metadata.json');
    await writeFile(metadata, JSON.stringify({ tracks: [
      { id: '11', title: 'Песня', artist: 'Автор', status: 'completed' },
      { id: '22', title: 'Неудачный трек', status: 'failed', error: 'Соединение прервано.' },
      { id: '33', title: 'Ещё загружается', status: 'running' },
    ] }));
    assert.equal(queue.albumTracks(album).length, 3);
    assert.throws(() => queue.retryTrack(album, '11', { id: 'bob' }), { statusCode: 404 });
    assert.throws(() => queue.retryTrack(album, '11', { id: 'admin', role: 'admin' }), { statusCode: 404 });
    assert.throws(() => queue.retryTrack(album, '999', owner), { statusCode: 404 });
    assert.throws(() => queue.retryTrack(album, '33', owner), { statusCode: 409 });
    assert.throws(() => queue.retryTrack(album, '11', owner), { statusCode: 429 });
    album.status = 'failed';
    album.error = 'OrpheusDL сообщил об ошибке. Подробности в журнале; часть файлов могла сохраниться.';
    assert.deepEqual(queue.albumOutcome(album), { downloadWarning: true, trackFailureOnly: true });
    assert.equal(queue.albumTracks(album)[1].error, 'Соединение прервано.');
    const failedOnly = { ...album, tracks: [album.tracks[1]] };
    assert.equal(queue.albumOutcome(failedOnly).downloadWarning, false);
    assert.equal(queue.albumOutcome({ ...album, error: 'Превышено время загрузки.' }).trackFailureOnly, false);
    const retry = queue.retryTrack(album, '22', owner);
    assert.equal(retry.url, 'https://open.qobuz.com/track/22');
    assert.equal(retry.quality, 'lossless');
    assert.equal(retry.retentionHours, 3);
    assert.equal(retry.lyrics, true);
    assert.equal(retry.userId, owner.id);
    assert.equal(retry.parentJobId, album.id);
    assert.equal(retry.parentTrackId, '22');
    assert.equal(queue.retryTrack(album, '22', owner).id, retry.id);
    assert.equal(queue.albumTracks(album)[1].retry.id, retry.id);
    assert.equal(queue.albumTracks(album)[2].status, 'not_downloaded');
    const previous = album.tracks;
    await writeFile(metadata, JSON.stringify({ tracks: [{ id: '../escape', status: 'failed' }] }));
    assert.deepEqual(queue.albumTracks(album).map(track => track.id), previous.map(track => track.id));
    queue.save();
    await rm(metadata);
    queue.close();
    queue = new DownloadQueue(settings);
    queue.stopping = true;
    const restored = queue.jobs.find(job => job.id === album.id);
    assert.equal(queue.albumTracks(restored).length, 3);
    assert.equal(JSON.parse(await readFile(join(base, 'jobs.json'), 'utf8')).find(job => job.id === album.id).tracks[0].title, 'Песня');
  } finally {
    queue?.close();
    await rm(base, { recursive: true, force: true });
  }
});
