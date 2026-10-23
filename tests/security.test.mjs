import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {takeLimit} from '../server/utils/rate-limit.mjs';
import {DownloadQueue} from '../server/utils/queue.mjs';
import {qobuzEnvironment} from '../server/utils/qobuz-session.mjs';

test('rate limits separate operations and clients and expire', () => {
  const now=Date.now();
  for(let i=0;i<30;i++)assert.equal(takeLimit('invite:alice',30,now),true);
  assert.equal(takeLimit('invite:alice',30,now),false);
  assert.equal(takeLimit('login:alice',30,now),true);
  assert.equal(takeLimit('invite:bob',30,now),true);
  assert.equal(takeLimit('invite:alice',30,now+60000),true);
});

test('queue quotas isolate users, bound empty history, preserve files and reject unsafe storage budgets', async () => {
  const base=await mkdtemp(join(tmpdir(),'qws-quota-'));
  const queue=new DownloadQueue({data:join(base,'data'),downloads:join(base,'downloads'),maxUserJobs:2,minFreeBytes:0});
  queue.stopping=true;
  try {
    queue.add('https://open.qobuz.com/track/1','hifi',1,'alice');
    queue.add('https://open.qobuz.com/track/2','hifi',1,'alice');
    assert.throws(()=>queue.add('https://open.qobuz.com/track/3','hifi',1,'alice'),e=>e.statusCode===429);
    assert.ok(queue.add('https://open.qobuz.com/track/4','hifi',1,'bob'));
    queue.settings.minFreeBytes=Number.MAX_SAFE_INTEGER;
    assert.throws(()=>queue.add('https://open.qobuz.com/track/5','hifi',1,'charlie'),e=>e.statusCode===507);
    queue.settings.minFreeBytes=0;
    const example={status:'cancelled',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
    queue.jobs=Array.from({length:300},()=>({...example,id:randomUUID()}));
    const retained=queue.jobs.at(-1);
    await mkdir(queue.folder(retained));
    await writeFile(join(queue.folder(retained),'.qws-archive.zip'),'fixture');
    retained.hasFiles=true;
    queue.pruneHistory();
    assert.equal(queue.jobs.length,201);
    assert.ok(queue.jobs.includes(retained));
    const before=retained.status;
    assert.equal(queue.retryArchive(retained),false);
    assert.equal(retained.status,before);
  } finally {queue.close();await rm(base,{recursive:true,force:true});}
});

test('workers do not inherit application login secrets', () => {
  const saved=process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD='fixture-admin-secret';
  try {assert.equal(qobuzEnvironment('/nonexistent-fixture').ADMIN_PASSWORD,undefined);}
  finally {if(saved===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=saved;}
});

test('worker is stopped when files exceed its budget, even outside the network downloader', async () => {
  const base=await mkdtemp(join(tmpdir(),'qws-worker-budget-'));
  let queue;
  try {
    await mkdir(join(base,'modules/qobuz'),{recursive:true});
    await mkdir(join(base,'data'));
    await writeFile(join(base,'orpheus.py'),'');await writeFile(join(base,'modules/qobuz/interface.py'),'');
    await writeFile(join(base,'data/qobuz-session.json'),JSON.stringify({userId:'123',authToken:'fixture-token'}));
    const runner=join(base,'runner.mjs');
    await writeFile(runner,"import {writeFileSync} from 'node:fs';writeFileSync(process.env.DOWNLOAD_DIR+'/fixture.flac','oversized-fixture');setInterval(()=>{},1000);");
    // Node handles the test worker; archive execution is deliberately rejected.
    queue=new DownloadQueue({data:join(base,'data'),downloads:join(base,'downloads'),root:base,python:process.execPath,runner,timeout:5,maxJobBytes:4,minFreeBytes:0});
    // The production runner adds Python's -u; this shim translates it for our fixture.
    const shim=join(base,'python-shim');
    await writeFile(shim,`#!/bin/sh\nif [ "$1" != "-u" ]; then exit 1; fi\nshift\nexec "${process.execPath}" "$@"\n`,{mode:0o700});
    queue.settings.python=shim;
    const job=queue.add('https://open.qobuz.com/track/1','hifi',1,'fixture-user');
    const deadline=Date.now()+6000;
    while((queue.active || job.status==='queued') && Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
    assert.equal(job.status,'failed');
    assert.match(job.error,/Лимит/);
    assert.equal(queue.active,null);
  }finally{queue?.close();await rm(base,{recursive:true,force:true});}
});
