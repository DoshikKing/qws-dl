import { ownArchive, previewArchive, archiveIdentity, safeText, unavailable } from '../../../../utils/sharing';
import { requireCurrentUser, limitAuth } from '../../../../utils/account';
import { readJsonBody } from '../../../../utils/request';
import { archiveFilename } from '../../../../utils/archive.mjs';
import { requireSpace } from '../../../../utils/storage.mjs';
export default defineEventHandler(async event=>{
  limitAuth(event);const body=await readJsonBody(event);
  if(Object.keys(body).some(key=>key!=='hours') || ![1,6,24].includes(body.hours))throw createError({statusCode:400,statusMessage:'Срок ссылки: 1, 6 или 24 часа.'});
  const {queue,job,file}=await ownArchive(event);
  queue.shares.checkCapacity(event.context.user.id);
  const identity=await archiveIdentity(file);
  const preview=await previewArchive(file,queue.settings);
  const after=await archiveIdentity(file).catch(()=>null);
  requireCurrentUser(event);
  if(after!==identity||job.userId!==event.context.user.id||queue.expired(job)||!job.hasFiles)throw unavailable();
  const cover=typeof preview.cover==='string'?Buffer.from(preview.cover,'base64'):null;
  if(cover&&(cover.length>128*1024||!cover.subarray(0,3).equals(Buffer.from([255,216,255]))))throw unavailable();
  const expires=Math.min(Date.now()+body.hours*3600_000,Date.parse(job.expiresAt));
  if(!Number.isFinite(expires)||expires<=Date.now())throw unavailable();
  const payload={fingerprint:identity,filename:archiveFilename(job),title:safeText(preview.tracks===1?preview.title:job.title)||safeText(job.title)||'ZIP-архив',
    artist:safeText(preview.artist),duration:Number.isSafeInteger(preview.duration)&&preview.duration>0?preview.duration:null,
    tracks:Number.isSafeInteger(preview.tracks)&&preview.tracks>=0&&preview.tracks<=10000?preview.tracks:0,size:0};
  const {stat}=await import('node:fs/promises');const info=await stat(file);
  requireCurrentUser(event);
  if(job.userId!==event.context.user.id||queue.expired(job))throw unavailable();
  payload.size=info.size;requireSpace(queue.settings,(cover?.length||0)+4096);
  const result=queue.shares.create(event.context.user.id,job.id,payload,cover,expires);
  return {id:result.id,path:`s/${result.token}`,expiresAt:result.expiresAt,title:payload.title};
});
