import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp,mkdir,writeFile,readFile,appendFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

for(const basePath of ['/','/dl/'])test(`shares HTTP ${basePath}: capabilities isolate one ZIP, account permissions, revocation, expiry and stream safety`,async()=>{
 const base=await mkdtemp('/tmp/qws-share-http-'),data=join(base,'data'),downloads=join(base,'downloads');
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done));
 const origin=`http://127.0.0.1:${port}${basePath.replace(/\/$/,'')}`;
 const request=(path,cookie='',method='GET',body,extra={})=>fetch(origin+path,{method,headers:{cookie,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
 let server;
 const start=async()=>{server=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NUXT_APP_BASE_URL:basePath,DATA_DIR:data,DOWNLOAD_DIR:downloads,ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'fixture-admin-password',MIN_FREE_BYTES:'0'},stdio:'ignore'});for(let i=0;i<150;i++){try{if((await request('/api/health')).ok)return;}catch{}await new Promise(done=>setTimeout(done,50));}throw Error('Fixture did not start');};
 const stop=async()=>{if(!server||server.exitCode!==null)return;const closed=once(server,'close');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await closed;clearTimeout(timer);};
 try{
  await start();const login=await request('/api/login','','POST',{username:'admin',password:'fixture-admin-password'});const admin=login.headers.get('set-cookie').split(';')[0];const profile=await(await request('/api/account',admin)).json();
  const register=async username=>{const r=await request('/api/register','','POST',{username,password:'fixture-user-password',inviteCode:profile.inviteCode});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];return {cookie,...await(await request('/api/account',cookie)).json()};};
  const alice=await register('alice'),bob=await register('bob');await stop();
  const jobs=[];const source=join(base,'song.flac'),cover=join(base,'cover.jpg');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=2',source]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-threads','1',cover]);
  execFileSync(resolve('.runtime/venv/bin/python'),['-c',`import sys
from mutagen.flac import FLAC,Picture
from pathlib import Path
a=FLAC(sys.argv[1]);a['title']=['<img src=x onerror=alert(1)>'];a['artist']=['Fixture artist'];p=Picture();p.type=3;p.mime='image/jpeg';p.data=Path(sys.argv[2]).read_bytes();a.add_picture(p);a.save()`,source,cover]);
  for(const [kind,owner] of [['time',alice.id],['counted',alice.id],['large',alice.id],['bob',bob.id],['identity',alice.id],['deleted',alice.id]]){
   const id=randomUUID(),folder=join(downloads,id);await mkdir(folder,{recursive:true});
   execFileSync('python3',['-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:
 z.write(sys.argv[2],'song.flac')
 if sys.argv[3]=='large':z.writestr('padding.bin',b'x'*(64*1024*1024))`,join(folder,'.qws-archive.zip'),source,kind]);
   jobs.push({id,userId:owner,url:'https://open.qobuz.com/track/123',title:'Fixture archive',status:'completed',kind:'qobuz',quality:'hifi',retentionMode:kind==='counted'?'downloads':'time',downloadLimit:1,downloadCount:0,retentionHours:24,createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600_000).toISOString(),hasFiles:true,log:''});
  }
  await writeFile(join(data,'jobs.json'),JSON.stringify(jobs));await start();
  const endpoint=index=>`/api/jobs/${jobs[index].id}/shares`;
  const make=async(index=0,cookie=alice.cookie)=>{const r=await request(endpoint(index),cookie,'POST',{hours:1});assert.equal(r.status,200);const link=await r.json();const token=link.path.split('/').pop();return {...link,token,api:'/api/shared/'+token};};
  assert.equal((await request(endpoint(0),'','POST',{hours:1})).status,401);
  assert.equal((await request(endpoint(0),bob.cookie,'POST',{hours:1})).status,404);
  assert.equal((await request(endpoint(0),admin,'POST',{hours:1})).status,404);
  for(const body of [{hours:0},{hours:25},{hours:1,path:'../private'},{hours:1,jobId:jobs[3].id}])assert.equal((await request(endpoint(0),alice.cookie,'POST',body)).status,400);
  assert.equal((await request(endpoint(0),alice.cookie,'POST',{hours:1},{origin:'https://evil.example'})).status,403);
  const link=await make(),other=await make(3,bob.cookie);
  const page=await request('/'+link.path);assert.equal(page.status,200);assert.equal(page.headers.get('set-cookie'),null);assert.match(page.headers.get('cache-control'),/no-store/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('content-security-policy'),/object-src 'none'/);assert.ok(!(await page.text()).includes('Код приглашения'));
  const metadataResponse=await request(link.api);assert.equal(metadataResponse.status,200);assert.equal(metadataResponse.headers.get('set-cookie'),null);const metadata=await metadataResponse.json();
  assert.deepEqual(Object.keys(metadata).sort(),['title','artist','duration','tracks','size','sharedBy','expiresAt','hasCover'].sort());assert.equal(metadata.sharedBy,'alice');assert.equal(metadata.artist,'Fixture artist');assert.equal(metadata.duration,2);assert.equal(metadata.tracks,1);assert.equal(metadata.hasCover,true);
  const image=await request(link.api+'/cover');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0,3).toString('hex'),'ffd8ff');
  for(const path of ['/api/account','/api/jobs','/api/files','/api/statistics','/api/admin/users','/api/admin/statistics',`/api/jobs/${jobs[3].id}/archive`]){
   assert.equal((await request(path,'qws_session='+link.token)).status,401);
   assert.equal((await request(path,'','GET',undefined,{authorization:'Bearer '+link.token})).status,401);
  }
  assert.equal((await request(link.api,'','POST',{})).status,401);
  assert.equal((await request(link.api+'/download','','DELETE')).status,401);
  assert.equal((await request('/api/shares/'+link.id,'','DELETE')).status,401);
  assert.equal((await request('/api/shares/'+link.id,bob.cookie,'DELETE')).status,404);
  const own=await(await request(endpoint(0),alice.cookie)).json();assert.ok(own.links.some(item=>item.id===link.id));assert.ok(!JSON.stringify(own).includes(link.token));
  assert.equal((await request(endpoint(0),bob.cookie)).status,404);
  for(const suffix of ['?path=../../data/users.json','?jobId='+jobs[3].id,'?file=song.flac'])assert.equal((await request(link.api+'/download'+suffix)).status,404);
  assert.equal((await request('/api/shared/'+'x'.repeat(43))).status,404);
  const head=await request(link.api+'/download','','HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const archive=await readFile(join(downloads,jobs[0].id,'.qws-archive.zip'));const downloaded=await request(link.api+'/download','','GET',undefined,{range:'bytes=0-10'});assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition'),/^attachment/);assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest(),createHash('sha256').update(archive).digest());
  assert.equal((await(await request('/api/statistics',alice.cookie)).json()).archives,0);
  assert.equal((await request(other.api)).status,200);
  await stop();await start();assert.equal((await request(link.api)).status,200);
  assert.equal((await request('/api/shares/'+link.id,alice.cookie,'DELETE')).status,200);assert.equal((await request(link.api)).status,404);assert.equal((await request(link.api+'/cover')).status,404);assert.equal((await request(link.api+'/download')).status,404);
  const expired=await make();const db=new DatabaseSync(join(data,'shares.sqlite3'));db.prepare('UPDATE shares SET expires=? WHERE id=?').run(Date.now()-1,expired.id);db.close();assert.equal((await request(expired.api)).status,404);
  const counted=await make(1);assert.equal((await request(counted.api+'/download','','HEAD')).status,200);assert.equal((await request(counted.api)).status,200);const one=await request(counted.api+'/download');assert.equal(one.status,200);await one.arrayBuffer();await new Promise(done=>setTimeout(done,50));assert.equal((await request(counted.api)).status,404);
  const deleted=await make(5);assert.equal((await request(`/api/jobs/${jobs[5].id}/archive`,alice.cookie,'DELETE')).status,200);assert.equal((await request(deleted.api)).status,404);
  const identity=await make(4);await appendFile(join(downloads,jobs[4].id,'.qws-archive.zip'),'changed');assert.equal((await request(identity.api)).status,404);
  const large=await make(2);
  const held=[];for(let i=0;i<4;i++){const response=await request(large.api+'/download');assert.equal(response.status,200);held.push(response.body.getReader());}
  assert.equal((await request(large.api+'/download')).status,429);
  for(const stream of held)await stream.cancel();await new Promise(done=>setTimeout(done,100));
  const transfer=await request(large.api+'/download');assert.equal(transfer.status,200);const reader=transfer.body.getReader();await reader.read();assert.equal((await request('/api/shares/'+large.id,alice.cookie,'DELETE')).status,200);
  let complete=false;try{while(!(await reader.read()).done){}complete=true;}catch{}assert.equal(complete,false,'revocation interrupts a transfer before the full ZIP arrives');
  const disabled=await make();assert.equal((await request('/api/admin/users/'+alice.id,admin,'PATCH',{action:'disable'})).status,200);assert.equal((await request(disabled.api)).status,404);assert.equal((await request(other.api)).status,200);
  assert.equal((await request('/api/admin/users/'+bob.id,admin,'PATCH',{action:'delete'})).status,200);assert.equal((await request(other.api)).status,404);
 }finally{await stop();await rm(base,{recursive:true,force:true});}
});
