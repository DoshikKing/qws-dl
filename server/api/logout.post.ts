export default defineEventHandler((event) => {
  deleteCookie(event, "qws_session", { path: "/" });
  return { ok: true };
});
