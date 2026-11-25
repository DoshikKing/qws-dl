import { pipeline } from 'node:stream/promises';
import { publicArchive, unavailable } from '../../../utils/sharing';
let streams=0;
const clients=new Map<string,number>();
export default defineEventHandler(async event=>{
  const value=await publicArchive(event);
  let release:((success:boolean)=>void)|undefined;
  let timer:ReturnType<typeof setInterval>|undefined;
  let deadline:ReturnType<typeof setTimeout>|undefined;
  let reserved=false;
  try{
    if(streams>=32||(clients.get(value.client)||0)>=4)throw createError({statusCode:429,statusMessage:'Повторите позже.'});
    const size=value.row.payload.size;
    setResponseHeaders(event,{'Content-Type':'application/zip','Content-Length':String(size),'Accept-Ranges':'none',
      'Content-Disposition':`attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(value.row.payload.filename).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())}`});
    if(event.method==='HEAD'){await value.handle.close();event.node.res.end();return;}
    if(!value.valid())throw unavailable();
    release=value.queue.reserveArchive(value.job,value.row.owner,false);
    streams++;clients.set(value.client,(clients.get(value.client)||0)+1);reserved=true;
    const stream=value.handle.createReadStream();value.queue.shares.track(value.row.id,stream);
    timer=setInterval(()=>{if(!value.valid())stream.destroy();},1000);timer.unref();
    deadline=setTimeout(()=>stream.destroy(),Math.max(1,Math.min(value.row.expires,Date.parse(value.job.expiresAt))-Date.now()));deadline.unref();
    event.node.res.once('finish',()=>release?.(event.node.res.statusCode===200&&stream.bytesRead===size));
    event.node.res.once('close',()=>release?.(false));stream.once('error',()=>release?.(false));
    await pipeline(stream,event.node.res);
  }catch(error){
    release?.(false);await value.handle.close().catch(()=>{});
    if(event.node.res.destroyed)return;
    event.node.res.removeHeader('Content-Length');event.node.res.removeHeader('Content-Disposition');event.node.res.removeHeader('Content-Type');
    if((error as any).statusCode===429)throw error;
    throw unavailable();
  }finally{
    if(timer)clearInterval(timer);if(deadline)clearTimeout(deadline);
    if(reserved){streams--;const count=(clients.get(value.client)||1)-1;if(count)clients.set(value.client,count);else clients.delete(value.client);}
  }
});
