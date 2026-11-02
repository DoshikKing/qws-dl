export const uploadLimit = 100 * 1024 * 1024;
export function uploadRequest(headers) {
  const decode = (name) => {
    let value;
    try { value = decodeURIComponent(headers[name] || ""); }
    catch { throw Object.assign(new Error("Некорректное имя файла или метаданные."), { statusCode: 400 }); }
    if (value.length > 500 || /[\x00-\x1f\x7f]/.test(value))
      throw Object.assign(new Error("Метаданные: до 500 символов, без управляющих знаков."), { statusCode: 400 });
    return value.trim();
  };
  const filename = decode("x-file-name");
  if (!filename || Buffer.byteLength(filename) > 240 || /[/\\]/.test(filename) || filename.startsWith(".") || !/\.(flac|mp3|m4a|ogg|opus)$/i.test(filename))
    throw Object.assign(new Error("Выберите FLAC, MP3, M4A, Ogg или Opus с именем до 240 байт."), { statusCode: 400 });
  const retentionHours = Number(headers["x-retention-hours"]);
  if (!Number.isInteger(retentionHours) || retentionHours < 1 || retentionHours > 5)
    throw Object.assign(new Error("Срок хранения: целое число от 1 до 5 часов."), { statusCode: 400 });
  if (!/^application\/octet-stream(?:\s*;|$)/i.test(headers["content-type"] || ""))
    throw Object.assign(new Error("Ожидается аудиофайл."), { statusCode: 415 });
  const length = headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > uploadLimit))
    throw Object.assign(new Error("Файл должен быть не больше 100 МиБ."), { statusCode: 413 });
  return { filename, retentionHours, metadata: { artist: decode("x-artist"), title: decode("x-title"), album: decode("x-album") } };
}
