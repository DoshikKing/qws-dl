import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';

for(const basePath of ['/', '/dl/'])test(`uploaded lyrics HTTP ${basePath}: real audio → cached LRCLIB → tags/LRC/ZIP; ownership, revocation, limits and expiry`,async()=>{
  const base=await mkdtemp('/tmp/qws-lyrics-http-'),data=join(base,'data'),downloads=join(base,'downloads');
  await mkdir(data);await mkdir(downloads);
  const fixture=join(base,'Песня.flac');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=3','-metadata','artist=Артист','-metadata','title=Песня',fixture]);
  const audio=await readFile(fixture),python=resolve('.runtime/venv/bin/python');
  const seed=`import sys,json,sqlite3,time,mutagen
p=mutagen.File(sys.argv[1]);db=sqlite3.connect(sys.argv[2]);db.execute('CREATE TABLE lyrics (key TEXT PRIMARY KEY, expires REAL, payload TEXT)')
key=json.dumps(['Артист','Песня','',round(p.info.length,3)],ensure_ascii=False)
result={'plain':'Текст','lrc':'[00:00.000]Текст','lines':[['Текст',0]]}
db.execute('INSERT INTO lyrics VALUES (?,?,?)',(key,time.time()+3600,json.dumps(result)));db.commit()`;
  execFileSync(python,['-c',seed,fixture,join(data,'lyrics.sqlite3')]);
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port+basePath.replace(/\/$/,'');
  let server;const start=()=>spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,NUXT_APP_BASE_URL:basePath,HOST:'127.0.0.1',PORT:String(port),ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'fixture-admin-password',DATA_DIR:data,DOWNLOAD_DIR:downloads,PYTHON_BIN:python,ORPHEUS_DIR:join(base,'missing'),MIN_FREE_BYTES:'0',MAX_JOB_BYTES:'1048576'},stdio:'ignore'});
  const until=async test=>{for(let i=0;i<200;i++){if(await test())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out');};
  const stop=async()=>{const closed=once(server,'close');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await closed;clearTimeout(timer);};
  const api=(path,cookie,body,method=body===undefined?'GET':'POST')=>fetch(origin+path,{method,headers:{cookie:cookie||'','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  let cookie;
  const headers=(extra={})=>({'content-type':'application/octet-stream','x-file-name':encodeURIComponent('Песня.flac'),'x-retention-hours':'5',cookie,...extra});
  const upload=(body=audio,extra={})=>fetch(origin+'/api/lyrics',{method:'POST',headers:headers(extra),body});
  const jobs=async()=>await(await api('/api/jobs',cookie)).json();
  const stream=(extra={})=>{
    const request=http.request(origin+'/api/lyrics',{method:'POST',headers:headers({'transfer-encoding':'chunked',...extra})});
    const result=new Promise((resolve,reject)=>{request.on('response',async response=>{for await(const c of response){}resolve(response.statusCode);});request.on('error',reject);});
    return {request,result};
  };
  try{
    server=start();await until(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}});
    assert.equal((await upload(audio,{cookie:''})).status,401);
    const login=await api('/api/login','',{username:'admin',password:'fixture-admin-password'});cookie=login.headers.get('set-cookie').split(';')[0];
    const account=await(await api('/api/account',cookie)).json();
    const register=await api('/api/register','',{username:'alice',password:'fixture-alice-password',inviteCode:account.inviteCode});
    const aliceCookie=register.headers.get('set-cookie').split(';')[0];
    assert.equal((await(await api('/api/status',cookie)).json()).ready,false,'no Qobuz required');
    for(const extra of [{'x-retention-hours':'6'},{'x-file-name':'..%2Fprivate.flac'},{'x-file-name':'song.exe'}])assert.equal((await upload(audio,extra)).status,400);
    assert.equal((await upload(Buffer.alloc(0))).status,400);
    const large=stream();large.request.end(Buffer.alloc(1048577));assert.equal(await large.result,413);
    const response=await upload();assert.equal(response.status,200);const {id}=await response.json();
    await until(async()=>['completed','failed'].includes((await jobs()).find(j=>j.id===id)?.status));
    const job=(await jobs()).find(j=>j.id===id);assert.equal(job.status,'completed',job.error+' '+job.log);assert.equal(job.hasFiles,true);
    assert.equal(Date.parse(job.expiresAt)-Date.parse(job.finishedAt),5*3600000);
    assert.deepEqual(await readdir(join(downloads,id)),['.qws-archive.zip']);
    assert.equal((await api(`/api/jobs/${id}/archive`,aliceCookie)).status,404);
    assert.ok(!(await(await api('/api/jobs',aliceCookie)).json()).some(j=>j.id===id));
    const zip=await api(`/api/jobs/${id}/archive`,cookie);assert.equal(zip.status,200);const archive=join(base,'result.zip');await writeFile(archive,Buffer.from(await zip.arrayBuffer()));
    execFileSync(python,['-c',`import sys,zipfile,mutagen,tempfile,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert set(z.namelist())=={'Песня.flac','Песня.lrc'}
 assert '[00:00.000]Текст' in z.read('Песня.lrc').decode()
 with tempfile.TemporaryDirectory() as d:
  p=pathlib.Path(d)/'song.flac';p.write_bytes(z.read('Песня.flac'));assert mutagen.File(p)['LYRICS']==['Текст']`,archive]);
    const bad=await(await upload(Buffer.from('not audio'))).json();await until(async()=>(await jobs()).find(j=>j.id===bad.id)?.status==='failed');
    assert.ok(!(await readdir(downloads)).includes(bad.id),'invalid source removed');
    // A permission revoked mid-upload must not enqueue a worker or retain audio.
    const slow=stream({cookie:aliceCookie});slow.request.write(audio.subarray(0,50));await new Promise(r=>setTimeout(r,150));
    const receivingJob=JSON.parse(await readFile(join(data,'jobs.json'),'utf8')).find(j=>j.status==='uploading');
    assert.ok(receivingJob);assert.equal((await api(`/api/jobs/${receivingJob.id}/archive`,aliceCookie)).status,409);
    assert.equal((await api('/api/admin/users/'+(await(await api('/api/account',aliceCookie)).json()).id,cookie,{action:'disable'},'PATCH')).status,200);
    slow.request.end(audio.subarray(50));assert.equal(await slow.result,401);
    assert.ok(!(await readdir(downloads)).includes(receivingJob.id),'revoked source removed');
    const failed=(await jobs()).filter(j=>j.status==='failed');for(const j of failed)assert.ok(!(await readdir(downloads)).includes(j.id));
    // Persist an expired successful job; startup cleanup must remove only its ZIP.
    await stop();const saved=JSON.parse(await readFile(join(data,'jobs.json'),'utf8'));saved.find(j=>j.id===id).expiresAt=new Date(Date.now()-1000).toISOString();await writeFile(join(data,'jobs.json'),JSON.stringify(saved));
    server=start();await until(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}});
    assert.equal((await api(`/api/jobs/${id}/archive`,cookie)).status,410);assert.ok(!(await readdir(downloads)).includes(id));
  }finally{if(server?.exitCode===null)await stop();await rm(base,{recursive:true,force:true});}
});
