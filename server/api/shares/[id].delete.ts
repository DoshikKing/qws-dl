import { getQueue } from '../../utils/queue.mjs';
export default defineEventHandler(event=>{
  if(!getQueue().shares.revoke(getRouterParam(event,'id'),event.context.user.id))throw createError({statusCode:404,statusMessage:'Ссылка не найдена.'});
  return {ok:true};
});
