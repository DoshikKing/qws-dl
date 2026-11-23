import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UserStore } from '../server/utils/users.mjs';
import { releases, newsFor, acknowledgeNews } from '../server/utils/news.mjs';

test('release dismissals isolate accounts, survive restart, stay idempotent and allow the next update', async () => {
  const data = await mkdtemp('/tmp/qws-news-');
  const original = [...releases];
  try {
    assert.equal(new Set(releases.map(item => item.id)).size, releases.length);
    assert.ok(releases.length <= 50);
    for (const release of releases) {
      assert.match(release.id, /^[a-z0-9.-]{1,80}$/); assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(release.title && release.summary && release.sections.length);
    }
    let store = new UserStore(data, 1);
    const alice = store.makeUser('alice', 'fixture-hash', null), bob = store.makeUser('bob', 'fixture-hash', null);
    store.users.push(alice, bob); store.save();
    assert.equal(newsFor(alice).seen, false);
    acknowledgeNews(store, alice, releases[0].id);
    assert.equal(newsFor(alice).seen, true); assert.equal(newsFor(bob).seen, false);
    const before = await readFile(join(data, 'users.json'), 'utf8');
    acknowledgeNews(store, alice, releases[0].id);
    assert.equal(await readFile(join(data, 'users.json'), 'utf8'), before);
    store = new UserStore(data, 1);
    const restored = store.users.find(user => user.id === alice.id);
    assert.equal(newsFor(restored).seen, true);
    assert.ok(!('seenReleaseIds' in store.profile(restored)));
    releases.unshift({ ...releases[0], id: 'fixture-next-update' });
    assert.equal(newsFor(restored).seen, false);
    acknowledgeNews(store, restored, releases[0].id);
    acknowledgeNews(store, restored, original[0].id);
    assert.equal(newsFor(restored).seen, true); // A late old tab cannot undo the new dismissal.
    assert.equal(newsFor(bob).seen, false);
    assert.throws(() => acknowledgeNews(store, restored, 'unknown'), { statusCode: 400 });
    assert.throws(() => acknowledgeNews(store, bob, releases[0].id), { statusCode: 401 }); // Object from a different store.
    const currentBob = store.users.find(user => user.id === bob.id);
    currentBob.disabled = true;
    assert.throws(() => acknowledgeNews(store, currentBob, releases[0].id), { statusCode: 401 });
    releases.unshift({ ...releases[0], id: 'fixture-save-failure' });
    const previous = restored.seenReleaseIds;
    store.save = () => { throw Error('fixture write failure'); };
    assert.throws(() => acknowledgeNews(store, restored, releases[0].id));
    assert.equal(restored.seenReleaseIds, previous); assert.equal(newsFor(restored).seen, false);
  } finally { releases.splice(0, releases.length, ...original); await rm(data, { recursive: true, force: true }); }
});
