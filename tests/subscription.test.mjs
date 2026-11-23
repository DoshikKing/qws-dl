import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { subscriptionStatus, normalizeSubscription } from '../server/utils/qobuz-subscription.mjs';
import { saveQobuzSession, readQobuzSession } from '../server/utils/qobuz-session.mjs';
import { renewalDue, QobuzRefresher } from '../server/utils/qobuz-refresh.mjs';

test('subscription calendar states use Moscow days, inclusive end dates and safe unknown values', () => {
  const now = Date.parse('2026-11-23T20:59:00Z');
  const session = endDate => ({ updatedAt: new Date(now).toISOString(), subscription: { plan:'Studio',endDate,autoRenew:true } });
  assert.equal(subscriptionStatus(null,now).state,'disconnected');
  assert.equal(subscriptionStatus(session('2026-12-01'),now).state,'active');
  assert.equal(subscriptionStatus(session('2026-11-30'),now).state,'expiring');
  assert.equal(subscriptionStatus(session('2026-11-23'),now).daysLeft,0);
  assert.equal(subscriptionStatus(session('2026-11-23'),now).state,'expiring');
  assert.equal(subscriptionStatus(session('2026-11-22'),now).state,'expired');
  assert.equal(subscriptionStatus(session('2026-11-23'),Date.parse('2026-11-23T21:00:00Z')).state,'expired');
  assert.equal(subscriptionStatus({ ...session('2026-12-01'), updatedAt:new Date(now-3600_001).toISOString() },now).stale,true);
  assert.equal(subscriptionStatus({ ...session('2026-12-01'), needsLogin:true },now).requiresLogin,true);
  for (const endDate of ['2026-02-30','2026-11-3',99999,true,null]) assert.equal(subscriptionStatus(session(endDate),now).state,'unknown');
  assert.equal(normalizeSubscription({ plan:'x'.repeat(81),endDate:'invalid',autoRenew:'true' }).plan,null);
  assert.equal(normalizeSubscription({ plan:'Studio\nprivate',autoRenew:1 }).autoRenew,null);
});

test('renewal populates old sessions and persists only normalized subscription fields privately', async () => {
  const data = await mkdtemp('/tmp/qws-subscription-');
  const now = Date.now();
  try {
    assert.equal(renewalDue({ userId:'123',authToken:'fixture',updatedAt:new Date(now).toISOString() },now),true);
    const subscription={plan:'Studio',endDate:'2030-04-15',autoRenew:false,billing:'private-billing'};
    saveQobuzSession({userId:'123',authToken:'fixture-token',subscription,updatedAt:new Date(now-31*60000).toISOString()},data);
    const service=new QobuzRefresher({data},async()=>({userId:'123',authToken:'fixture-rotated',subscription:{...subscription,endDate:'2030-05-15'}}));
    await service.refresh(now);service.close();
    assert.deepEqual(readQobuzSession(data).subscription,{plan:'Studio',endDate:'2030-05-15',autoRenew:false});
    const stored=await readFile(join(data,'qobuz-session.json'),'utf8');assert.ok(!stored.includes('billing'));
    assert.equal(renewalDue(readQobuzSession(data),now),false);
  } finally { await rm(data,{recursive:true,force:true}); }
});
