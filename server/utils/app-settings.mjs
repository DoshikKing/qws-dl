import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { retentionPolicy } from './retention.mjs';

export function validateDefaults(value) {
  const fields = ['quality', 'retentionMode', 'retentionHours', 'downloadLimit', 'lyrics'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key)))
    throw new Error('Некорректные настройки приложения.');
  if (!['hifi', 'lossless', 'high'].includes(value.quality)) throw new Error('Неизвестное качество.');
  if (typeof value.lyrics !== 'boolean') throw new Error('Параметр текстов должен быть логическим значением.');
  return { quality: value.quality, ...retentionPolicy(value.retentionMode, value.retentionHours, value.downloadLimit), lyrics: value.lyrics };
}

export function loadDefaults(settings) {
  const file = join(settings.data, 'app-settings.json');
  if (!existsSync(file)) return { quality: settings.quality || 'hifi', retentionMode: 'time',
    retentionHours: settings.retentionHours || 24, downloadLimit: 1, lyrics: false };
  try { return validateDefaults(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { throw new Error('Не удалось прочитать настройки приложения. Сохраните их заново.'); }
}

export function saveDefaults(settings, value) {
  const result = validateDefaults(value);
  mkdirSync(settings.data, { recursive: true, mode: 0o700 });
  const file = join(settings.data, 'app-settings.json');
  writeFileSync(file + '.tmp', JSON.stringify(result), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  return result;
}
