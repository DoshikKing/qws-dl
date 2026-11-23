import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseNotes } from '../scripts/release.mjs';
import { releases } from '../server/utils/news.mjs';

test('release notes match the app version and link bilingual assets and exact source history', async () => {
  const {version} = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(lock.version,version); assert.equal(lock.packages[''].version,version);
  const commit='a'.repeat(40), entry=releases[0];
  const notes=releaseNotes(version,entry,'DoshikKing/qws-dl',commit);
  assert.equal(notes.tag,`v${version}`);
  assert.ok(notes.en.includes(`/releases/download/v${version}/RELEASE_NOTES.ru.md`));
  assert.ok(notes.ru.includes(`/releases/tag/v${version}`));
  for(const body of [notes.en,notes.ru]) {
    assert.ok(body.includes(`qws-dl-v${version}-source.tar.gz`));
    assert.ok(body.includes('docker compose up -d --build'));assert.ok(body.includes('SHA256SUMS'));
    assert.ok(body.includes(`/commits/${commit}`));
  }
  assert.ok(releaseNotes(version,entry,'DoshikKing/qws-dl',commit,'v0.9.0').en.includes(`/compare/v0.9.0...v${version}`));
  assert.throws(()=>releaseNotes(version,entry,'DoshikKing/qws-dl',commit,'v9.0.0'));
  assert.throws(()=>releaseNotes(version,entry,'DoshikKing/qws-dl',commit,`v${version}`));
  for(const bad of ['../release','1.0','v1.0.0','01.0.0','1.0.0\n','1.0.0-rc.1'])
    assert.throws(()=>releaseNotes(bad,{...entry,version:bad},'DoshikKing/qws-dl',commit));
  assert.throws(()=>releaseNotes(version,{...entry,version:'0.0.0'},'DoshikKing/qws-dl',commit));
  assert.throws(()=>releaseNotes(version,{...entry,english:null},'DoshikKing/qws-dl',commit));
  assert.throws(()=>releaseNotes(version,entry,'invalid/repo/path',commit));
  assert.throws(()=>releaseNotes(version,entry,'DoshikKing/qws-dl','HEAD'));
});
