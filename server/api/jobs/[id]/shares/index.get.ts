import { ownArchive } from '../../../../utils/sharing';
import { requireCurrentUser } from '../../../../utils/account';
export default defineEventHandler(async event=>{
  const {queue,job}=await ownArchive(event);requireCurrentUser(event);
  if(job.userId!==event.context.user.id)throw createError({statusCode:404,statusMessage:'Архив недоступен.'});
  return {links:queue.shares.list(event.context.user.id,job.id),expiresAt:job.expiresAt};
});
