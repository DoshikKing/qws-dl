import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { saveQobuzSession } from '../server/utils/qobuz-session.mjs';

for (const basePath of ['/', '/dl/']) test(`subscription HTTP ${basePath}: administrator-only safe metadata and restart`, async () => {
  const base=await mkdtemp('/tmp/qws-subscription-http-'),data=join(base,'data');
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done));
  const origin=`http://127.0.0.1:${port}${basePath.replace(/\/$/,'')}`;
  const request=(path,cookie='',method='GET',body)=>fetch(origin+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const worker=join(base,'fixture-worker');
  await writeFile(worker,`#!${process.execPath}
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
const {session}=JSON.parse(input);
setTimeout(()=>console.log(JSON.stringify({...session,authToken:'fixture-rotated',subscription:{plan:'Studio Fixture',endDate:'2099-02-26',autoRenew:true,source:'user/get',accessActive:true}})),300);
});
`);await chmod(worker,0o700);
  let server;
  const start=async()=>{
    server=spawn(process.execPath,['.output/server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NUXT_APP_BASE_URL:basePath,DATA_DIR:data,DOWNLOAD_DIR:join(base,'downloads'),ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'fixture-admin-password',MIN_FREE_BYTES:'0',PYTHON_BIN:worker},stdio:'ignore'});
    for(let i=0;i<150;i++){try{if((await request('/api/health')).ok)return;}catch{}await new Promise(done=>setTimeout(done,50));}throw Error('Fixture did not start');
  };
  const stop=async()=>{if(!server||server.exitCode!==null)return;const closed=once(server,'close');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await closed;clearTimeout(timer);};
  const save=(subscription,needsLogin=false)=>saveQobuzSession({userId:'123',authToken:'fixture-private-token',updatedAt:new Date().toISOString(),subscription:{...subscription,source:'user/get',accessActive:true},needsLogin},data);
  try {
    save({plan:'Studio Fixture',endDate:'2099-01-15',autoRenew:false,billing:'private-billing'});
    await start(); assert.equal((await request('/api/admin/qobuz/refresh','','POST')).status,401); assert.equal((await request('/api/status')).status,401);
    const login=await request('/api/login','','POST',{username:'admin',password:'fixture-admin-password'});assert.equal(login.status,200);const admin=login.headers.get('set-cookie').split(';')[0];
    const profile=await(await request('/api/account',admin)).json();
    const registered=await request('/api/register','','POST',{username:'alice',password:'fixture-user-password',inviteCode:profile.inviteCode});assert.equal(registered.status,200);const alice=registered.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/admin/qobuz/refresh',alice,'POST')).status,403);
    const adminStatus=await(await request('/api/status',admin)).json();
    assert.equal(adminStatus.subscription.state,'active');assert.equal(adminStatus.subscription.endDate,'2099-01-15');assert.equal(adminStatus.subscription.autoRenew,false);
    assert.ok(!JSON.stringify(adminStatus).includes('fixture-private-token'));assert.ok(!JSON.stringify(adminStatus).includes('billing'));
    const publicStatus=await(await request('/api/status?role=admin',alice)).json();
    assert.ok(!Object.hasOwn(publicStatus,'subscription'));assert.ok(!JSON.stringify(publicStatus).includes('Studio Fixture'));assert.ok(!JSON.stringify(publicStatus).includes('2099-01-15'));
    await stop();await start();assert.equal((await(await request('/api/status',admin)).json()).subscription.endDate,'2099-01-15');
    const requests=await Promise.all([request('/api/admin/qobuz/refresh',admin,'POST'),request('/api/admin/qobuz/refresh',admin,'POST')]);
    for(const response of requests){assert.equal(response.status,200);const body=await response.json();assert.equal(body.endDate,'2099-02-26');assert.ok(!JSON.stringify(body).includes('fixture-rotated'));}
    assert.equal((await request('/api/admin/qobuz/refresh',admin,'POST')).status,429);
    save({plan:'Studio Fixture',endDate:'2001-01-01',autoRenew:true});assert.equal((await(await request('/api/status',admin)).json()).subscription.state,'unconfirmed');
    save({plan:'Studio Fixture',endDate:'invalid',autoRenew:null});assert.equal((await(await request('/api/status',admin)).json()).subscription.state,'unknown');
    save({plan:'Studio Fixture',endDate:'2099-01-15',autoRenew:true},true);assert.equal((await(await request('/api/status',admin)).json()).subscription.requiresLogin,true);
    save({plan:'Studio Fixture',endDate:'2099-01-15',autoRenew:true});await stop();await start();
    const pending=request('/api/admin/qobuz/refresh',admin,'POST');
    await new Promise(done=>setTimeout(done,100));
    assert.equal((await request('/api/logout',admin,'POST')).status,200);
    assert.equal((await pending).status,401);

  } finally { await stop();await rm(base,{recursive:true,force:true}); }
});
