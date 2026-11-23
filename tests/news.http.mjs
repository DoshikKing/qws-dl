import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

for (const basePath of ['/', '/dl/']) test(`news HTTP ${basePath}: per-account dismissal, restart, strict body, CSRF and revocation`, async () => {
  const base = await mkdtemp('/tmp/qws-news-http-');
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(done => listener.close(done));
  const origin = `http://127.0.0.1:${port}${basePath.replace(/\/$/, '')}`;
  const request = (path, cookie = '', method = 'GET', body, headers = {}) => fetch(origin + path, {
    method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let server;
  const start = async () => {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { env: { ...process.env, HOST:'127.0.0.1', PORT:String(port), NUXT_APP_BASE_URL:basePath,
      DATA_DIR:join(base,'data'), DOWNLOAD_DIR:join(base,'downloads'), ADMIN_USERNAME:'admin', ADMIN_PASSWORD:'fixture-admin-password', MIN_FREE_BYTES:'0' }, stdio:'ignore' });
    for (let i=0;i<150;i++) { try { if ((await request('/api/health')).ok) return; } catch {} await new Promise(done=>setTimeout(done,50)); }
    throw Error('Fixture did not start');
  };
  const stop = async () => { if (!server || server.exitCode !== null) return; const closed=once(server,'close'); server.kill('SIGTERM'); const timer=setTimeout(()=>server.kill('SIGKILL'),5000); await closed; clearTimeout(timer); };
  const login = async (username, password) => { const result=await request('/api/login','','POST',{username,password}); assert.equal(result.status,200); return result.headers.get('set-cookie').split(';')[0]; };
  const news = async cookie => (await request('/api/news',cookie)).json();
  try {
    await start();
    assert.equal((await request('/api/news')).status,401); assert.equal((await request('/api/news/read','','POST',{version:'x'})).status,401);
    const admin=await login('admin','fixture-admin-password');
    const profile=await (await request('/api/account',admin)).json();
    const register=async username=>{const result=await request('/api/register','','POST',{username,password:'fixture-user-password',inviteCode:profile.inviteCode});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];};
    const alice=await register('alice'),bob=await register('bob');
    const first=await request('/api/news',alice); assert.equal(first.headers.get('cache-control'),'no-store');
    const payload=await first.json(); assert.equal(payload.seen,false); assert.ok(payload.releases[0].sections.length);
    const version=payload.releases[0].id;
    for(const body of [null,[],{}, {version:'unknown'}, {version}, {version,userId:'bob'}]) {
      const result=await request('/api/news/read',alice,'POST',body);
      assert.equal(result.status, body && !Array.isArray(body) && Object.keys(body).length===1 && body.version===version ? 200 : 400);
    }
    assert.equal((await news(alice)).seen,true); assert.equal((await news(bob)).seen,false); assert.equal((await news(admin)).seen,false);
    assert.equal((await request('/api/news/read',alice,'POST',{version},{origin:'https://foreign.example'})).status,403);
    assert.equal((await request('/api/news/read',alice,'POST',{version})).status,200);
    await stop(); await start();
    assert.equal((await news(alice)).seen,true); assert.equal((await news(bob)).seen,false);
    const anotherDevice=await login('alice','fixture-user-password'); assert.equal((await news(anotherDevice)).seen,true);
    const slow=http.request(origin+'/api/news/read',{method:'POST',headers:{cookie:bob,'content-type':'application/json','transfer-encoding':'chunked'}});
    const pending=new Promise((done,reject)=>{slow.on('response',async result=>{for await(const chunk of result){}done(result.statusCode);});slow.on('error',reject);});
    slow.write('{'); await new Promise(done=>setTimeout(done,100));
    const bobProfile=await (await request('/api/account',bob)).json();
    assert.equal((await request('/api/admin/users/'+bobProfile.id,admin,'PATCH',{action:'disable'})).status,200);
    slow.end(JSON.stringify({version}).slice(1)); assert.equal(await pending,401);
    const stored=JSON.parse(await readFile(join(base,'data/users.json'),'utf8')).users;
    assert.ok(!stored.find(user=>user.id===bobProfile.id).seenReleaseIds);
  } finally { await stop(); await rm(base,{recursive:true,force:true}); }
});
