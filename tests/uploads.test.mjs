import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { uploadRequest, uploadLimit } from '../server/utils/uploads.mjs';
import { DownloadQueue } from '../server/utils/queue.mjs';
import { archiveFilename } from '../server/utils/archive.mjs';

test('upload boundary validates filename, actual limits, metadata and 1–5 hour retention', () => {
  const valid = {'content-type':'application/octet-stream','x-file-name':encodeURIComponent('Трек.flac'),'x-retention-hours':'5'};
  assert.equal(uploadRequest(valid).filename,'Трек.flac');
  assert.equal(uploadRequest(valid).retentionHours,5);
  for(const change of [{'x-file-name':'../x.flac'},{'x-file-name':'..%5Cx.flac'}, {'x-file-name':'x.exe'},
    {'x-file-name':'.qws-archive.flac'}, {'x-file-name':'%bad'}, {'x-file-name':'x%00.flac'},
    {'x-file-name':'x'.repeat(250)+'.flac'}, {'x-retention-hours':'0'}, {'x-retention-hours':'6'},
    {'x-retention-hours':'1.5'}, {'x-artist':'a%0Ab'}, {'content-length':String(uploadLimit+1)},
    {'content-type':'application/json'}]) assert.throws(()=>uploadRequest({...valid,...change}));
});

test('uploads share account quotas, isolate owners, expire, cancel and clean interrupted input after restart', async () => {
  const data=await mkdtemp('/tmp/qws-upload-');let queue;
  try {
    const settings={data,downloads:join(data,'files'),minFreeBytes:0,maxUserJobs:1};
    queue=new DownloadQueue(settings);queue.stopping=true;
    for(const hours of [0,6,'2',1.5])assert.throws(()=>queue.addUpload('song.flac',hours,'alice'));
    const job=queue.addUpload('song.flac',1,'alice');
    assert.equal(job.status,'uploading');assert.equal(queue.canAccess(job,{id:'bob',role:'admin'}),false);
    assert.throws(()=>queue.addUpload('two.flac',1,'alice'));
    assert.equal(archiveFilename(job),'song.flac.zip');
    await mkdir(queue.folder(job));await writeFile(join(queue.folder(job),'song.flac'),'private audio');
    queue.save();queue.close();
    queue=new DownloadQueue(settings);queue.stopping=true;
    assert.equal(queue.jobs[0].status,'failed');assert.equal(queue.jobs[0].hasFiles,false);
    assert.deepEqual(await readdir(settings.downloads),[]);
    const next=queue.addUpload('two.flac',5,'alice');
    await mkdir(queue.folder(next));await writeFile(join(queue.folder(next),'two.flac'),'private');
    queue.cancel(next.id);assert.deepEqual(await readdir(settings.downloads),[]);
  } finally {queue?.close();await rm(data,{recursive:true,force:true});}
});
