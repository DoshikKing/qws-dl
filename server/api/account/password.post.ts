import { readJsonBody } from "../../utils/request";
import { accountStore, limitAuth, setSession } from "../../utils/account";
export default defineEventHandler(async event => {
  limitAuth(event);
  const body = await readJsonBody(event);
  const store = await accountStore();
  try { await store.changePassword(event.context.user, body?.currentPassword, body?.password); }
  catch(error) { throw createError({statusCode:(error as Error & { statusCode?: number }).statusCode || 400, statusMessage:(error as Error).message}); }
  setSession(event, store.createSession(event.context.user));
  return {ok:true};
});
