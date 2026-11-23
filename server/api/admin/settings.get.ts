import { requireAdmin } from '../../utils/account';
import { config } from '../../utils/queue.mjs';
import { loadDefaults } from '../../utils/app-settings.mjs';
export default defineEventHandler((event) => {
  requireAdmin(event);
  try { return loadDefaults(config()); }
  catch { throw createError({ statusCode: 503, statusMessage: 'Не удалось прочитать настройки приложения. Сохраните их заново.' }); }
});
