import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  searchRequest,
  searchCatalog,
  closeSearches,
} from "../server/utils/search.mjs";
test("search validates input, bounds concurrency, handles worker errors and keeps arguments literal", async () => {
  const base = await mkdtemp("/tmp/qws-search-");
  try {
    assert.deepEqual(searchRequest({ query: "  Песня  " }), {
      query: "Песня",
      offset: 0,
      type: "tracks",
    });
    for (const body of [
      {},
      { query: "" },
      { query: "a".repeat(201) },
      { query: "a\0b" },
      { query: "a", offset: -1 },
      { query: "a", offset: 1 },
      { query: "a", offset: 1000 },
      { query: "a", offset: "20" },
      { query: "a", type: "playlists" },
      { query: "a", type: {} },
    ])
      assert.throws(() => searchRequest(body));
    const python = join(base, "fixture-python");
    await writeFile(
      python,
      `#!/usr/bin/env node
const query=process.argv[4];
if(query==='badjson'){console.log('private malformed output');process.exit(1);}
if(query==='wrongtype'){console.log(JSON.stringify({tracks:[]}));process.exit(0);}
if(query==='scalar'){console.log('null');process.exit(0);}
if(query==='fail'){console.log(JSON.stringify({error:'Fixture service rejected request'}));console.error('private credential');process.exit(3);}
setTimeout(()=>console.log(JSON.stringify({[process.argv[6]]:[{title:query}],offset:Number(process.argv[5])})),query==='hold'?200:0);
`,
    );
    await chmod(python, 0o700);
    const settings = { python, root: base };
    const first = searchCatalog(settings, "alice", { query: "hold", offset: 0 });
    const second = searchCatalog(settings, "bob", { query: "hold", offset: 20 });
    await assert.rejects(
      searchCatalog(settings, "alice", { query: "q", offset: 0 }),
      (e) => e.statusCode === 429,
    );
    await assert.rejects(
      searchCatalog(settings, "charlie", { query: "q", offset: 0 }),
      (e) => e.statusCode === 429,
    );
    assert.equal((await first).tracks[0].title, "hold");
    assert.equal((await second).offset, 20);
    const literal = "$(touch never-execute) & Песня";
    assert.equal(
      (await searchCatalog(settings, "alice", { query: literal, offset: 0 }))
        .tracks[0].title,
      literal,
    );
    await assert.rejects(
      searchCatalog(settings, "alice", { query: "badjson", offset: 0 }),
      (e) => e.statusCode === 503 && !e.message.includes("private"),
    );
    await assert.rejects(
      searchCatalog(settings, "alice", { query: "scalar", offset: 0 }),
      (e) => e.statusCode === 502,
    );
    await assert.rejects(
      searchCatalog(settings, "alice", { query: "fail", offset: 0 }),
      (e) => e.statusCode === 502 && !e.message.includes("credential"),
    );
    await assert.rejects(searchCatalog(settings, 'alice', { query: 'wrongtype', type: 'albums' }), e => e.statusCode === 502);
    for (const type of ['tracks', 'albums', 'artists']) {
      const result = await searchCatalog(settings, 'alice', { query: type, offset: 20, type });
      assert.equal(result[type][0].title, type);
      assert.equal(result.offset, 20);
    }
    const pending = searchCatalog(settings, "alice", {
      query: "hold",
      offset: 0,
    });
    const rejected = assert.rejects(pending);
    closeSearches();
    await rejected;
  } finally {
    closeSearches();
    await rm(base, { recursive: true, force: true });
  }
});
