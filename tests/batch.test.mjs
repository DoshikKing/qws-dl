import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadQueue } from '../server/utils/queue.mjs';

test('track batches are atomic, bounded, canonical and preserve owner, options and retry metadata',async()=>{
  const data=await mkdtemp('/tmp/qws-batch-');let queue;
  const settings={data,downloads:join(data,'downloads'),minFreeBytes:0,maxUserJobs:1};
  try {
    queue=new DownloadQueue(settings);queue.stopping=true;
    const urls=['https://open.qobuz.com/track/11','https://open.qobuz.com/track/22'];
    for(const bad of [[],Array(51).fill(urls[0]),[urls[0],'https://evil.test/track/2'],['https://open.qobuz.com/album/1']])assert.throws(()=>queue.add(bad,'hifi',3,'alice'));
    assert.equal(queue.jobs.length,0);
    const job=queue.add([...urls,urls[0]],'lossless',3,'alice',true,{retentionMode:'downloads',downloadLimit:3},'opus',{bitrate:96});
    assert.equal(queue.jobs.length,1);assert.equal(job.kind,'qobuz-batch');assert.deepEqual(job.urls,urls);
    assert.equal(job.userId,'alice');assert.equal(job.outputFormat,'opus');assert.equal(job.downloadLimit,3);
    assert.throws(()=>queue.add(urls,'hifi',3,'alice'),{statusCode:429});
    job.status='failed';job.tracks=[{id:'11',status:'completed',title:'Done'},{id:'22',status:'failed',title:'Failed'}];
    assert.equal(queue.albumOutcome(job).downloadWarning,true);
    assert.throws(()=>queue.retryTrack(job,'22',{id:'bob'}),{statusCode:404});
    job.expiresAt=new Date(Date.now()+3600_000).toISOString();queue.settings.maxUserJobs=2;
    const retry=queue.retryTrack(job,'22',{id:'alice'});
    assert.equal(retry.url,urls[1]);assert.equal(retry.outputFormat,'opus');assert.equal(retry.lyrics,true);
    assert.equal(retry.downloadLimit,3);assert.equal(retry.parentJobId,job.id);
    queue.save();queue.close();queue=new DownloadQueue(settings);queue.stopping=true;
    assert.deepEqual(queue.jobs.find(item=>item.id===job.id).urls,urls);
  }finally{queue?.close();await rm(data,{recursive:true,force:true});}
});
