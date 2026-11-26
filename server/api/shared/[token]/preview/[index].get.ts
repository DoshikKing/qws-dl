import { publicArchive, sharedAudioTool, unavailable } from '../../../../utils/sharing';
import { requireSpace } from '../../../../utils/storage.mjs';
export default defineEventHandler(async event => {
  const value = await publicArchive(event);
  try {
    if (event.method !== 'GET') throw createError({ statusCode: 405, statusMessage: 'Используйте GET.' });
    const index = getRouterParam(event, 'index') || '';
    if (!/^(0|[1-9][0-9]{0,3})$/.test(index)) throw unavailable();
    requireSpace(value.queue.settings, 512 * 1024**2);
    const audio = await sharedAudioTool(event, value, 'audio', index);
    if (!value.valid()) throw unavailable();
    setResponseHeaders(event, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length),
      'Content-Disposition': 'inline; filename="preview.mp3"', 'Accept-Ranges': 'none' });
    return audio;
  } finally { await value.handle.close(); }
});
