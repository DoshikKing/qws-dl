import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const sessionPath = (data) => join(resolve(data || process.env.DATA_DIR || 'data'), 'qobuz-session.json');
export function readQobuzSession(data) {
  try {
    const session = JSON.parse(readFileSync(sessionPath(data), 'utf8'));
    if (!/^[0-9]{1,32}$/.test(session.userId) || typeof session.authToken !== 'string' ||
        !session.authToken || session.authToken.length > 16384) return null;
    return session;
  } catch { return null; }
}
export function saveQobuzSession(session, data) {
  const file = sessionPath(data);
  mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ userId: session.userId, authToken: session.authToken }), { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}
export function qobuzEnvironment(data) {
  const session = (process.env.QOBUZ_AUTH_MODE || 'web') === 'web' && readQobuzSession(data);
  return session ? { ...process.env, QOBUZ_AUTH_MODE: 'token',
    QOBUZ_USER_ID: session.userId, QOBUZ_AUTH_TOKEN: session.authToken } : { ...process.env };
}
