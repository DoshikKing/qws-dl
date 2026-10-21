export default defineEventHandler((event) => {
  deleteCookie(event, "qws_session", {
    path: useRuntimeConfig(event).app.baseURL.replace(/\/?$/, "/"),
  });
  return { ok: true };
});
