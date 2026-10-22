import { requireAdmin } from "../../../utils/account";
import { getQueue } from "../../../utils/queue.mjs";
export default defineEventHandler(event => {
  requireAdmin(event);
  const queue = getQueue();
  const job = queue.jobs.find((item:{id:string}) => item.id === getRouterParam(event,"id"));
  if (!job) throw createError({statusCode:404,statusMessage:"Загрузка не найдена."});
  try {queue.deleteFiles(job);}
  catch(error) {
    const busy = (error as Error).message === "busy";
    throw createError({statusCode:busy?409:500,statusMessage:busy?"Дождитесь завершения загрузки и архивации.":"Не удалось удалить файлы. Проверьте права на каталог downloads."});
  }
  return {ok:true};
});
