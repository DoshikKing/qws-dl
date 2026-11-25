import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ShareStore } from '../server/utils/shares.mjs';

test('share keys are separate hashed capabilities, survive restart and revoke only within owner/job scope',async()=>{
 const data=await mkdtemp('/tmp/qws-shares-');let store;
 try{
  store=new ShareStore(data);const expires=Date.now()+3600_000;
  const link=store.create('alice','one',{title:'Fixture',fingerprint:'identity'},null,expires);
  const other=store.create('bob','two',{title:'Other'},null,expires);
  assert.match(link.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(store.resolve(link.token).owner,'alice');
  assert.equal(store.resolve(link.token.slice(0,42)),null);assert.equal(store.resolve('x'.repeat(43)),null);
  assert.equal(store.revoke(link.id,'bob'),false);
  assert.deepEqual(Object.keys(store.list('alice','one')[0]).sort(),['id','title','expiresAt'].sort());
  assert.ok(!(await readFile(join(data,'shares.sqlite3'))).includes(Buffer.from(link.token)));
  assert.equal((await stat(join(data,'shares.sqlite3'))).mode&0o777,0o600);
  store.close();store=new ShareStore(data);assert.equal(store.resolve(link.token).job,'one');
  const stream=new PassThrough();store.track(link.id,stream);assert.equal(store.revoke(link.id,'alice'),true);assert.equal(stream.destroyed,true);
  assert.equal(store.resolve(link.token),null);assert.ok(store.resolve(other.token));
  store.revokeFor('owner','bob');assert.equal(store.resolve(other.token),null);
  for(let i=0;i<50;i++)store.create('limited','limit',{title:'Fixture'},null,expires);
  assert.throws(()=>store.checkCapacity('limited'),{statusCode:429});store.revokeFor('job','limit');
  const old=store.create('alice','one',{title:'Old'},null,Date.now()-1);assert.equal(store.resolve(old.token),null);
 }finally{store?.close();await rm(data,{recursive:true,force:true});}
});
