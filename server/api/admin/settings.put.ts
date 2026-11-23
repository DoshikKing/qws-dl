import { requireAdmin } from '../../utils/account';
import { readJsonBody } from '../../utils/request';
import { config } from '../../utils/queue.mjs';
import { saveDefaults, validateDefaults } from '../../utils/app-settings.mjs';
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const body = await readJsonBody(event);
  requireAdmin(event);
  let defaults;
  try { defaults = validateDefaults(body); }
  catch (error) { throw createError({ statusCode: 400, statusMessage: (error as Error).message }); }
  try { return saveDefaults(config(), defaults); }
  catch { throw createError({ statusCode: 503, statusMessage: 'Не удалось сохранить настройки приложения.' }); }
});
