import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

test('HTTP security: bounded bodies, independent limits, revocation while reading, and per-user queue quotas', async () => {
  const packages = await readdir('.output/server/node_modules', {recursive: true});
  assert.ok(!packages.some(name => /(^|\/)(node-forge|listhen)(\/|$)/.test(name)));
  const base=await mkdtemp(join(tmpdir(),'qws-security-'));
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port;
  const root=join(base,'orpheus');const python=join(base,'fixture-python');
  await mkdir(join(root,'modules/qobuz'),{recursive:true});await mkdir(join(base,'data'));
  await writeFile(join(root,'orpheus.py'),'# fixture');await writeFile(join(root,'modules/qobuz/interface.py'),'# fixture');
  await writeFile(python,'#!/bin/sh\nif [ "$1" = "-u" ]; then sleep 10; fi\nexit 0\n',{mode:0o700});
  await writeFile(join(base,'data/qobuz-session.json'),JSON.stringify({userId:'123',authToken:'fixture-token',updatedAt:new Date().toISOString()}));
  const server=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NUXT_APP_BASE_URL:'/',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'fixture-admin-password',DATA_DIR:join(base,'data'),DOWNLOAD_DIR:join(base,'downloads'),ORPHEUS_DIR:root,PYTHON_BIN:python,MAX_USER_JOBS:'2',MIN_FREE_BYTES:'0',TRUST_PROXY:'false'},stdio:'ignore'});
  const api=(path,body,cookie)=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',cookie:cookie||''},body:JSON.stringify(body)});
  const streaming=(path,cookie)=>{
    const request=http.request(origin+path,{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked',cookie:cookie||''}});
    const result=new Promise((resolve,reject)=>{
      request.on('response',async response=>{for await(const chunk of response){}resolve(response.statusCode);});
      request.on('error',reject);
    });
    return {request,result};
  };
  try {
    let ready=false;
    for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.ok(ready,'fixture server starts');
    assert.equal((await api('/api/login',{username:'admin',password:'x'.repeat(256*1024)})).status,413);
    const large=streaming('/api/login');large.request.end('x'.repeat(65537));assert.equal(await large.result,413);
    for(let i=0;i<30;i++)assert.equal((await api('/api/invitations/check',{code:'invalid'})).status,400);
    assert.equal((await api('/api/invitations/check',{code:'invalid'})).status,429);
    const login=await api('/api/login',{username:'admin',password:'fixture-admin-password'});assert.equal(login.status,200);
    const adminCookie=login.headers.get('set-cookie').split(';')[0];
    const profile=await(await fetch(origin+'/api/account',{headers:{cookie:adminCookie}})).json();
    const register=async username=>{
      const response=await api('/api/register',{inviteCode:profile.inviteCode,username,password:'fixture-user-password'});
      assert.equal(response.status,200);
      return {user:(await response.json()).user,cookie:response.headers.get('set-cookie').split(';')[0]};
    };
    const alice=await register('alice');
    const slow=streaming('/api/jobs',alice.cookie);slow.request.write('{');
    await new Promise(r=>setTimeout(r,200));
    const disabled=await fetch(origin+'/api/admin/users/'+alice.user.id,{method:'PATCH',headers:{cookie:adminCookie,'content-type':'application/json'},body:JSON.stringify({action:'disable'})});assert.equal(disabled.status,200);
    slow.request.end('"url":"https://open.qobuz.com/track/1"}');assert.equal(await slow.result,401);
    assert.equal((await fetch(origin+'/api/account',{headers:{cookie:alice.cookie}})).status,401);
    assert.ok(!JSON.parse(await readFile(join(base,'data/jobs.json'),'utf8')).some(job=>job.userId===alice.user.id));
    const bob=await register('bob');
    const first=await api('/api/jobs',{url:'https://open.qobuz.com/track/1'},bob.cookie);assert.equal(first.status,200);const firstJob=await first.json();
    assert.equal((await api('/api/jobs',{url:'https://open.qobuz.com/track/2'},bob.cookie)).status,200);
    assert.equal((await api('/api/jobs',{url:'https://open.qobuz.com/track/3'},bob.cookie)).status,429);
    assert.equal((await api('/api/jobs',{url:'https://open.qobuz.com/track/4'},adminCookie)).status,200);
    assert.equal((await fetch(origin+'/api/jobs/'+firstJob.id,{method:'DELETE',headers:{cookie:adminCookie}})).status,404);
  } finally {
    const closed=once(server,'close');server.kill('SIGTERM');
    const timer=setTimeout(()=>server.kill('SIGKILL'),5000);
    await closed;clearTimeout(timer);await rm(base,{recursive:true,force:true});
  }
});
