import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { UsageStatistics, archiveStatistics } from '../server/utils/statistics.mjs';
import { DownloadQueue } from '../server/utils/queue.mjs';

function zipSummary(summary) {
  const comment=Buffer.from(JSON.stringify(summary));const footer=Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);footer.writeUInt16LE(comment.length,20);
  return Buffer.concat([footer,comment]);
}
const summary={version:1,tracks:3,genres:[{name:'Rock',count:2},{name:'Без жанра',count:1}]};
test('statistics preserve per-user totals through restart and archive removal, with safe bounded ZIP comments',async()=>{
  const data=await mkdtemp('/tmp/qws-usage-');let statistics;
  try {
    const archive=join(data,'sample.zip');await writeFile(archive,zipSummary(summary));
    assert.deepEqual(archiveStatistics(archive),summary);
    for (const bad of [{...summary,tracks:4},{...summary,genres:[{name:'bad\nname',count:3}]},{...summary,tracks:-1},{}]) {
      await writeFile(archive,zipSummary(bad));assert.equal(archiveStatistics(archive),null);
    }
    await writeFile(archive,Buffer.alloc(100000));assert.equal(archiveStatistics(archive),null);
    statistics=new UsageStatistics(data);const since=statistics.since;
    statistics.recordDownload('alice',summary);statistics.recordDownload('alice',summary);
    statistics.recordDownload('bob',null);
    assert.equal(statistics.snapshot('alice').tracks,6);
    assert.equal(statistics.snapshot('alice').archives,2);
    assert.deepEqual(statistics.snapshot('alice').genres.map(({name,tracks})=>[name,tracks]),[['Rock',4],['Без жанра',2]]);
    assert.equal(statistics.snapshot('bob').tracks,0);assert.equal(statistics.snapshot('bob').unknownArchives,1);
    assert.equal(statistics.snapshot('unseen').archives,0);
    assert.equal((await stat(join(data,'usage.sqlite3'))).mode&0o777,0o600);
    await rm(archive);statistics.close();statistics=new UsageStatistics(data);
    assert.equal(statistics.since,since);assert.equal(statistics.snapshot('alice').tracks,6);
  } finally {statistics?.close();await rm(data,{recursive:true,force:true});}
});

test('archive accounting counts only completed Qobuz transfers once in both retention modes',async()=>{
  const data=await mkdtemp('/tmp/qws-usage-queue-');let queue;
  try {
    queue=new DownloadQueue({data,downloads:join(data,'downloads'),minFreeBytes:0});queue.stopping=true;
    const job=queue.add('https://open.qobuz.com/track/123','hifi',24,'alice');job.status='completed';
    await mkdir(queue.folder(job),{recursive:true});await writeFile(join(queue.folder(job),'.qws-archive.zip'),zipSummary(summary));
    const aborted=queue.reserveArchive(job);aborted(false);aborted(true);
    assert.equal(queue.statistics.snapshot('alice').archives,0);
    const first=queue.reserveArchive(job);first(true);first(true);
    assert.equal(queue.statistics.snapshot('alice').archives,1);
    job.retentionMode='downloads';job.downloadLimit=2;
    queue.reserveArchive(job)(true);
    assert.equal(queue.statistics.snapshot('alice').tracks,6);assert.equal(job.downloadCount,1);
    const uploaded={...job,kind:'lyrics-upload'};queue.reserveArchive(uploaded)(true);
    assert.equal(queue.statistics.snapshot('alice').archives,2);
    queue.deleteFiles(job,'owner');
    assert.equal(queue.statistics.snapshot('alice').tracks,6);
    queue.jobs = [...Array.from({length:201},()=>({...job})),job];queue.pruneHistory();
    assert.equal(queue.jobs.length,200);assert.equal(queue.statistics.snapshot('alice').tracks,6);
  } finally {queue?.close();await rm(data,{recursive:true,force:true});}
});
