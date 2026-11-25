import type { H3Event } from 'h3';
import { execFile } from 'node:child_process';
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
  const forwarded=getHeader(event,'x-real-ip')||'';
  const client=process.env.TRUST_PROXY==='true' && isIP(forwarded)?forwarded:event.node.req.socket.remoteAddress||'unknown';
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
