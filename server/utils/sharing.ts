import type { H3Event } from 'h3';
import { execFile, spawn } from 'node:child_process';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { getQueue } from './queue.mjs';
import { getUsers } from './users.mjs';
import { jobArchive } from './archive.mjs';
import { workerEnvironment } from './qobuz-session.mjs';
import { takeLimit } from './rate-limit.mjs';

export const unavailable = () => createError({ statusCode: 404, statusMessage: 'Ссылка недоступна.' });
export const fingerprint = (info: any) => [info.dev, info.ino, info.size, info.mtimeNs].map(String).join(':');
export const safeText = (value: unknown) => typeof value === 'string' ? Array.from(value.replace(/[\x00-\x1f\x7f]/g,' ').trim()).slice(0,200).join('') : '';
let inspecting = 0;
export async function previewArchive(file: string, settings: any) {
  if(inspecting >= 2) throw createError({statusCode:429,statusMessage:'Подготовка ссылок занята. Повторите позже.'});
  inspecting++;
  try {
    return await new Promise<any>((done,reject)=>execFile(settings.python,[resolve('scripts/share_archive.py'),file],
      {timeout:30000,maxBuffer:256*1024,env:workerEnvironment()},(error,stdout)=>{
        try {const value=JSON.parse(stdout);if(error||value.error)throw Error();done(value);}
        catch{reject(createError({statusCode:400,statusMessage:'Не удалось прочитать сведения архива.'}));}
      }));
  }finally{inspecting--;}
}
export async function ownArchive(event: H3Event) {
  const queue=getQueue();
  const job=queue.jobs.find((item: any)=>item.id===getRouterParam(event,'id'));
  // A manager may inspect storage, but cannot publish another user's downloads.
  if(!job || job.userId!==event.context.user.id)throw unavailable();
  try {return {queue,job,file:await jobArchive(queue,job)};}catch{throw unavailable();}
}
export async function publicArchive(event: H3Event) {
  const queue=getQueue(),token=getRouterParam(event,'token')||'';
  // Nitro's internal SSR fetch has no peer socket. Context is server-only and
  // carries the original address, never a browser-provided identity or cookie.
  const forwarded=event.context.publicShareForwardedAddress||getHeader(event,'x-real-ip')||'';
  const remote=event.context.publicShareRemoteAddress||event.node.req.socket.remoteAddress;
  const client=process.env.TRUST_PROXY==='true' && isIP(forwarded)?forwarded:remote||'unknown';
  if(!takeLimit(`share-read:${client}`,120))throw createError({statusCode:429,statusMessage:'Повторите позже.'});
  if(getRequestURL(event).search)throw unavailable();
  let row=queue.shares.resolve(token);
  if(!row)throw unavailable();
  const users=await getUsers().catch(()=>null);
  const valid=()=>{
    row=queue.shares.resolve(token);
    const owner=users?.users.find((user:any)=>user.id===row?.owner&&!user.disabled);
    const job=queue.jobs.find((item:any)=>item.id===row?.job&&item.userId===row?.owner);
    return row&&owner&&job&&!queue.expired(job)?{owner,job}:null;
  };
  let scope=valid();if(!scope)throw unavailable();
  let handle;
  try {
    const file=await jobArchive(queue,scope.job);
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=await handle.stat({bigint:true});
    scope=valid();
    if(!scope||!info.isFile()||fingerprint(info)!==row.payload.fingerprint)throw unavailable();
    return {queue,row,job:scope.job,owner:scope.owner,handle,token,client,valid};
  }catch{await handle?.close().catch(()=>{});throw unavailable();}
}
export function publicMetadata(value:any) {
  return {title:value.row.payload.title,artist:value.row.payload.artist,duration:value.row.payload.duration,
    tracks:value.row.payload.tracks,size:value.row.payload.size,sharedBy:value.owner.username,
    expiresAt:new Date(Math.min(value.row.expires,Date.parse(value.job.expiresAt))).toISOString(),hasCover:!!value.row.cover};
}
export async function archiveIdentity(file:string) {const info=await lstat(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink())throw unavailable();return fingerprint(info);}

// Public transcoding is separate from the download worker and never reserves a ZIP download.
let audioWorkers = 0;
const audioClients = new Set<string>();
export async function sharedAudioTool(event: H3Event, value: any, mode: 'tracks' | 'audio', index = '') {
  if (event.node.res.destroyed) throw unavailable();
  if (audioWorkers >= 2 || audioClients.has(value.client) || !takeLimit(`share-audio:${value.client}`, 12))
    throw createError({ statusCode: 429, statusMessage: 'Прослушивание занято. Повторите позже.' });
  audioWorkers++; audioClients.add(value.client);
  try {
    const result = await new Promise<Buffer>((done, reject) => {
      const child = spawn(value.queue.settings.python, [resolve('scripts/share_archive.py'), '/dev/fd/3', mode, index], {
        env: { ...workerEnvironment(), TMPDIR: value.queue.settings.downloads }, detached: true, stdio: ['ignore', 'pipe', 'ignore', value.handle.fd],
      });
      const chunks: Buffer[] = []; let size = 0;
      const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } } };
      const timeout = setTimeout(stop, 25000);
      const validity = setInterval(() => { if (!value.valid()) stop(); }, 500);
      const disconnected = () => { if (!event.node.res.writableEnded) stop(); };
      event.node.res.once('close', disconnected);
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024**2) stop(); else chunks.push(chunk); });
      child.once('error', () => reject(unavailable()));
      child.once('close', code => {
        clearTimeout(timeout); clearInterval(validity); event.node.res.removeListener('close', disconnected);
        stop(); // Also reap a decoder if its Python parent was killed or timed out.
        if (code !== 0 || size > 2 * 1024**2 || !value.valid() || event.node.res.destroyed) reject(unavailable());
        else done(Buffer.concat(chunks));
      });
    });
    if (!value.valid() || fingerprint(await value.handle.stat({ bigint: true })) !== value.row.payload.fingerprint) throw unavailable();
    return result;
  } finally { audioWorkers--; audioClients.delete(value.client); }
}
