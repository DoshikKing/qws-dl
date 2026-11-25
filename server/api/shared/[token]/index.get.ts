import { publicArchive, publicMetadata } from '../../../utils/sharing';
export default defineEventHandler(async event=>{
  const value=await publicArchive(event);
  try{return publicMetadata(value);}finally{await value.handle.close();}
});
