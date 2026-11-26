// Nitro maps implicit HEAD to GET; an explicit route must avoid transcoding.
export default defineEventHandler(event => {
  setResponseHeader(event, 'Allow', 'GET');
  throw createError({ statusCode: 405, statusMessage: 'Используйте GET.' });
});
