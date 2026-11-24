import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

for(const basePath of ['/','/dl/'])test(`statistics HTTP ${basePath}: private totals, complete exports, deletion, aborts and restart`,async()=>{
  const base=await mkdtemp('/tmp/qws-usage-http-'),data=join(base,'data'),downloads=join(base,'downloads');
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done));
  const origin=`http://127.0.0.1:${port}${basePath.replace(/\/$/,'')}`;
  const request=(path,cookie='',method='GET',body)=>fetch(origin+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  let server;
  const start=async()=>{
    server=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NUXT_APP_BASE_URL:basePath,DATA_DIR:data,DOWNLOAD_DIR:downloads,ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'fixture-admin-password',MIN_FREE_BYTES:'0'},stdio:'ignore'});
    for(let i=0;i<150;i++){try{if((await request('/api/health')).ok)return;}catch{}await new Promise(done=>setTimeout(done,50));}throw Error('Fixture did not start');
  };
  const stop=async()=>{if(!server||server.exitCode!==null)return;const closed=once(server,'close');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await closed;clearTimeout(timer);};
  try {
    await start();assert.equal((await request('/api/statistics')).status,401);assert.equal((await request('/api/admin/statistics')).status,401);
    const login=await request('/api/login','','POST',{username:'admin',password:'fixture-admin-password'});const admin=login.headers.get('set-cookie').split(';')[0];
    const adminProfile=await(await request('/api/account',admin)).json();
    const register=async username=>{const response=await request('/api/register','','POST',{username,password:'fixture-user-password',inviteCode:adminProfile.inviteCode});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];const profile=await(await request('/api/account',cookie)).json();return {cookie,id:profile.id};};
    const alice=await register('alice'),bob=await register('bob');
    assert.equal((await request('/api/admin/statistics',alice.cookie)).status,403);
    const since=(await(await request('/api/statistics',alice.cookie)).json()).since;
    await stop();const jobs=[];
    for(const [kind,size] of [['time',1024],['large',64*1024*1024],['downloads',1024],['upload',1024]]) {
      const id=randomUUID(),folder=join(downloads,id);await mkdir(folder,{recursive:true});
      const summary={version:1,tracks:3,genres:[{name:'Rock',count:2},{name:'Без жанра',count:1}]};
      execFileSync('python3',['-c',`import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:
 z.writestr('fixture.bin',b'x'*int(sys.argv[2]));z.comment=sys.argv[3].encode('utf-8')`,join(folder,'.qws-archive.zip'),String(size),JSON.stringify(summary)]);
      jobs.push({id,userId:alice.id,url:'https://open.qobuz.com/track/123',kind:kind==='upload'?'lyrics-upload':undefined,title:kind,status:'completed',quality:'hifi',retentionMode:kind==='downloads'?'downloads':'time',downloadLimit:1,downloadCount:0,retentionHours:24,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600_000).toISOString(),hasFiles:true,log:''});
    }
    await writeFile(join(data,'jobs.json'),JSON.stringify(jobs));await start();
    const path=`/api/jobs/${jobs[0].id}/archive`;
    assert.equal((await request(path,bob.cookie)).status,404);
    assert.equal((await request(path,alice.cookie,'HEAD')).status,200);
    assert.equal((await(await request('/api/statistics',alice.cookie)).json()).archives,0);
    for(let i=0;i<2;i++){const response=await request(path,alice.cookie);assert.equal(response.status,200);await response.arrayBuffer();}
    const counted=await request(`/api/jobs/${jobs[2].id}/archive`,alice.cookie);assert.equal(counted.status,200);await counted.arrayBuffer();
    const upload=await request(`/api/jobs/${jobs[3].id}/archive`,alice.cookie);assert.equal(upload.status,200);await upload.arrayBuffer();
    const partial=await request(`/api/jobs/${jobs[1].id}/archive`,alice.cookie);const reader=partial.body.getReader();await reader.read();await reader.cancel();
    await new Promise(done=>setTimeout(done,100));
    const stats=await(await request('/api/statistics?userId='+bob.id,alice.cookie)).json();
    assert.equal(stats.archives,3);assert.equal(stats.tracks,9);assert.equal(stats.since,since);
    assert.equal(stats.genres.find(item=>item.name==='Rock').tracks,6);
    assert.equal((await(await request('/api/statistics?userId='+alice.id,bob.cookie)).json()).archives,0);
    const all=await(await request('/api/admin/statistics',admin)).json();
    assert.equal(all.users.find(user=>user.id===alice.id).tracks,9);assert.equal(all.users.find(user=>user.id===bob.id).tracks,0);
    for(const user of all.users)assert.deepEqual(Object.keys(user).sort(),['id','username','disabled','since','archives','tracks','unknownArchives','genres'].sort());
    assert.equal((await request(path,alice.cookie,'DELETE')).status,200);
    await stop();await start();assert.equal((await(await request('/api/statistics',alice.cookie)).json()).tracks,9);
    await request('/api/logout',alice.cookie,'POST');assert.equal((await request('/api/statistics',alice.cookie)).status,401);
  }finally{await stop();await rm(base,{recursive:true,force:true});}
});
