import { readJsonBody } from "../utils/request";
import { accountStore, limitAuth, setSession } from "../utils/account";
export default defineEventHandler(async (event) => {
  limitAuth(event);
  const body = await readJsonBody(event);
  const store = await accountStore();
  const user = await store.login(body?.username, body?.password);
  if (!user)
    throw createError({
      statusCode: 401,
      statusMessage: "Неверный логин или пароль.",
    });
  setSession(event, store.createSession(user));
  return { user: store.profile(user) };
});
