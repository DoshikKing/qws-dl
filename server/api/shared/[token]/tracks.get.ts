import { publicArchive, sharedAudioTool, safeText, unavailable } from '../../../utils/sharing';
export default defineEventHandler(async event => {
  const value = await publicArchive(event);
  try {
    const items = JSON.parse((await sharedAudioTool(event, value, 'tracks')).toString('utf8'));
    if (!Array.isArray(items) || items.length > 10000) throw unavailable();
    return { tracks: items.map((item, id) => ({ id, title: safeText(item.title), artist: safeText(item.artist),
      duration: Number.isSafeInteger(item.duration) && item.duration > 0 ? item.duration : null })),
      expiresAt: new Date(Math.min(value.row.expires, Date.parse(value.job.expiresAt))).toISOString() };
  } finally { await value.handle.close(); }
});
