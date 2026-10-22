// Source files are temporary downloader output, never public downloads.
export default defineEventHandler(() => {
  throw createError({
    statusCode: 404,
    statusMessage: "Скачивание доступно только в ZIP-архиве задания.",
  });
});
