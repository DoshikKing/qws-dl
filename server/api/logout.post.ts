import { accountStore } from "../utils/account";
export default defineEventHandler(async (event) => {
  (await accountStore()).logout(getCookie(event, "qws_session"));
  deleteCookie(event, "qws_session", {
    path: useRuntimeConfig(event).app.baseURL.replace(/\/?$/, "/"),
  });
  return { ok: true };
});
