import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmodSync,openSync,closeSync,constants } from 'node:fs';
import { join } from 'node:path';
const hash = value => createHash('sha256').update(value).digest('hex');
export const shareToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export class ShareStore {
  constructor(data) {
    const file=join(data,'shares.sqlite3');closeSync(openSync(file,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600));this.db=new DatabaseSync(file);chmodSync(file,0o600);this.streams=new Map();
    this.db.exec(`PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS shares
      (id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, job TEXT NOT NULL,
       expires INTEGER NOT NULL, payload TEXT NOT NULL, cover BLOB);
      CREATE INDEX IF NOT EXISTS shares_owner ON shares(owner);`);
  }
  checkCapacity(owner) {
    this.db.prepare('DELETE FROM shares WHERE expires<=?').run(Date.now());
    if(this.db.prepare('SELECT count(*) AS n FROM shares WHERE owner=?').get(owner).n>=50 || this.db.prepare('SELECT count(*) AS n FROM shares').get().n>=1000)
      throw Object.assign(new Error('Лимит внешних ссылок исчерпан. Отзовите ненужные ссылки.'),{statusCode:429});
  }
  create(owner,job,payload,cover,expires) {
    this.checkCapacity(owner);
    const token=randomBytes(32).toString('base64url'),id=randomUUID();
    this.db.prepare('INSERT INTO shares VALUES (?,?,?,?,?,?,?)').run(id,hash(token),owner,job,expires,JSON.stringify(payload),cover);
    return {id,token,expiresAt:new Date(expires).toISOString()};
  }
  resolve(token) {
    if(this.closed || !shareToken(token))return null;
    const row=this.db.prepare('SELECT * FROM shares WHERE digest=? AND expires>?').get(hash(token),Date.now());
    return row?{...row,payload:JSON.parse(row.payload)}:null;
  }
  list(owner,job) {
    return this.db.prepare('SELECT id,expires,payload FROM shares WHERE owner=? AND job=? AND expires>? ORDER BY expires DESC').all(owner,job,Date.now())
      .map(row=>({id:row.id,expiresAt:new Date(row.expires).toISOString(),title:JSON.parse(row.payload).title}));
  }
  revoke(id,owner) {
    const row=this.db.prepare('SELECT id FROM shares WHERE id=? AND owner=?').get(id,owner);
    if(!row)return false;
    this.db.prepare('DELETE FROM shares WHERE id=?').run(id);this.stop(id);return true;
  }
  stop(id) { for(const stream of this.streams.get(id)||[])stream.destroy();this.streams.delete(id); }
  revokeFor(column,value) {
    if(this.closed)return;
    if(!['job','owner'].includes(column))throw Error('Invalid scope');
    for(const row of this.db.prepare(`SELECT id FROM shares WHERE ${column}=?`).all(value))this.stop(row.id);
    this.db.prepare(`DELETE FROM shares WHERE ${column}=?`).run(value);
  }
  track(id,stream) {
    const streams=this.streams.get(id)||new Set();streams.add(stream);this.streams.set(id,streams);
    stream.once('close',()=>{streams.delete(stream);if(!streams.size)this.streams.delete(id);});
  }
  close() { if(this.closed)return;this.closed=true;for(const id of this.streams.keys())this.stop(id);this.db.close(); }
}
