import { accountStore, limitAuth, setSession } from "../../utils/account";
export default defineEventHandler(async event => {
  limitAuth();
  const body = await readBody(event);
  const store = await accountStore();
  try { await store.changePassword(event.context.user, body?.currentPassword, body?.password); }
  catch(error) { throw createError({statusCode:400, statusMessage:(error as Error).message}); }
  setSession(event, store.createSession(event.context.user));
  return {ok:true};
});
