import { publicArchive, unavailable } from '../../../utils/sharing';
export default defineEventHandler(async event=>{
  const value=await publicArchive(event);
  try{
    if(!value.row.cover)throw unavailable();
    setResponseHeader(event,'Content-Type','image/jpeg');
    return Buffer.from(value.row.cover);
  }finally{await value.handle.close();}
});
