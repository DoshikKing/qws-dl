import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

// ZIP comments survive source removal and contain aggregates, never track names.
export function archiveStatistics(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const size = fstatSync(fd).size;
    if (size < 22) return null;
    const tail = Buffer.alloc(Math.min(size, 65557));
    if (readSync(fd, tail, 0, tail.length, size - tail.length) !== tail.length) return null;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) !== 0x06054b50 || offset + 22 + tail.readUInt16LE(offset + 20) !== tail.length) continue;
      const value = JSON.parse(tail.subarray(offset + 22).toString('utf8'));
      if (value.version !== 1 || !Number.isSafeInteger(value.tracks) || value.tracks < 0 || value.tracks > 100000 ||
          !Array.isArray(value.genres) || value.genres.length > 128) return null;
      if (value.genres.some(item => !item || typeof item.name !== 'string' || !item.name.trim() || Array.from(item.name).length > 100 ||
          /[\x00-\x1f\x7f]/.test(item.name) || !Number.isSafeInteger(item.count) || item.count < 1)) return null;
      if (value.genres.reduce((sum, item) => sum + item.count, 0) !== value.tracks) return null;
      return value;
    }
  } catch { /* Older ZIPs have no trustworthy track summary. */ }
  finally { if (fd !== undefined) closeSync(fd); }
  return null;
}

export class UsageStatistics {
  constructor(data) {
    const file = join(data, 'usage.sqlite3');
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (userId TEXT PRIMARY KEY, archives INTEGER NOT NULL DEFAULT 0,
        tracks INTEGER NOT NULL DEFAULT 0, unknownArchives INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS genres (userId TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL,
        tracks INTEGER NOT NULL, PRIMARY KEY(userId,key));`);
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('since',?)").run(new Date().toISOString());
    this.since = this.db.prepare("SELECT value FROM metadata WHERE key='since'").get().value;
  }
  recordDownload(userId, summary) {
    if (!userId) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO usage VALUES (?,1,?,?) ON CONFLICT(userId) DO UPDATE SET
        archives=archives+1, tracks=tracks+excluded.tracks, unknownArchives=unknownArchives+excluded.unknownArchives`)
        .run(userId, summary?.tracks || 0, summary ? 0 : 1);
      const genre = this.db.prepare(`INSERT INTO genres VALUES (?,?,?,?) ON CONFLICT(userId,key)
        DO UPDATE SET tracks=tracks+excluded.tracks`);
      for (const item of summary?.genres || []) genre.run(userId, item.name.normalize('NFKC').toLowerCase(), item.name, item.count);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshot(userId) {
    const usage = this.db.prepare('SELECT archives,tracks,unknownArchives FROM usage WHERE userId=?').get(userId);
    const genres = this.db.prepare('SELECT name,tracks FROM genres WHERE userId=? ORDER BY tracks DESC,name LIMIT 20').all(userId);
    const others = (usage?.tracks || 0) - genres.reduce((sum, item) => sum + item.tracks, 0);
    if (others > 0) genres.push({ name: 'Остальные жанры', tracks: others });
    return { since: this.since, archives: usage?.archives || 0, tracks: usage?.tracks || 0,
      unknownArchives: usage?.unknownArchives || 0, genres };
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}
