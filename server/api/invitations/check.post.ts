import { accountStore, limitAuth } from "../../utils/account";
export default defineEventHandler(async event => {
  limitAuth();
  const body = await readBody(event);
  if (!(await accountStore()).inviter(body?.code))
    throw createError({statusCode:400, statusMessage:"Приглашение недействительно или его лимит исчерпан."});
  return {ok:true};
});
