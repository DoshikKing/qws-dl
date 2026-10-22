import { accountStore, limitAuth, setSession } from "../utils/account";
export default defineEventHandler(async (event) => {
  limitAuth();
  const body = await readBody(event);
  const store = await accountStore();
  let user;
  try {
    user = await store.register(
      body?.inviteCode,
      body?.username,
      body?.password,
    );
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message,
    });
  }
  setSession(event, store.createSession(user));
  return { user: store.profile(user) };
});
