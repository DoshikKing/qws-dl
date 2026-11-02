import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {UserStore} from '../server/utils/users.mjs';

test('invalid session cookies have a constant hash budget even with many sessions',async()=>{
  const directory=await mkdtemp('/tmp/qws-auth-cost-test-');
  try {
    const store=new UserStore(directory,1);
    store.sessions=Array.from({length:10000},(_,i)=>({hash:String(i).padStart(64,'0'),userId:'fixture-'+Math.floor(i/10),expiresAt:Date.now()+60000}));
    const original=crypto.createHash;let hashes=0;
    mock.method(crypto,'createHash',(...args)=>{hashes++;return original(...args);});
    syncBuiltinESMExports();
    assert.equal(store.session('a'.repeat(48)),null);
    assert.equal(hashes,1,'one digest per cookie, independently of stored session count');
    hashes=0;store.logout('a'.repeat(48));assert.equal(hashes,1);
  }finally{mock.restoreAll();syncBuiltinESMExports();await rm(directory,{recursive:true,force:true});}
});

test('malformed or oversized login names are rejected before user lookup',async()=>{
  const directory=await mkdtemp('/tmp/qws-login-boundary-');
  try {
    const store=new UserStore(directory,1);
    store.users=new Proxy([],{get(){throw Error('malformed login reached user lookup');}});
    for(const value of ['İ'.repeat(20000),'a'.repeat(33),'a','bad name',null,{}])
      assert.equal(await store.login(value,'fixture-password'),null);
  }finally{await rm(directory,{recursive:true,force:true});}
});
