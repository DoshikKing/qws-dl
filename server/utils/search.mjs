import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { qobuzEnvironment } from './qobuz-session.mjs';

const running = new Map();
export class SearchError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}
export function searchRequest(body) {
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const offset = body?.offset ?? 0;
  if (!query || query.length > 200 || /[\x00-\x1f\x7f]/.test(query))
    throw new SearchError("Введите запрос длиной от 1 до 200 символов.", 400);
  if (!Number.isInteger(offset) || offset < 0 || offset > 980 || offset % 20)
    throw new SearchError("Некорректная страница поиска.", 400);
  return { query, offset };
}
export async function searchTracks(settings, userId, request) {
  if (running.has(userId) || running.size >= 2)
    throw new SearchError(
      "Поиск уже выполняется. Повторите запрос позже.",
      429,
    );
  return new Promise((done, reject) => {
    const child = execFile(
      settings.python,
      [
        resolve("scripts/search_qobuz.py"),
        settings.root,
        request.query,
        String(request.offset),
      ],
      { timeout: 45_000, killSignal: "SIGKILL", maxBuffer: 256 * 1024, env: qobuzEnvironment(settings.data) },
      (error, stdout) => {
        running.delete(userId);
        if (error?.killed) {
          reject(
            new SearchError(
              "Поиск занял слишком много времени. Повторите запрос.",
              504,
            ),
          );
          return;
        }
        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          reject(
            new SearchError(
              "Поиск Qobuz недоступен. Обратитесь к администратору.",
              503,
            ),
          );
          return;
        }
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          reject(
            new SearchError(
              "Qobuz вернул некорректные результаты поиска.",
              502,
            ),
          );
          return;
        }
        if (error || result.error) {
          reject(
            new SearchError(
              typeof result.error === "string"
                ? result.error
                : "Поиск Qobuz недоступен.",
              502,
            ),
          );
          return;
        }
        if (!Array.isArray(result.tracks)) {
          reject(
            new SearchError(
              "Qobuz вернул некорректные результаты поиска.",
              502,
            ),
          );
          return;
        }
        done(result);
      },
    );
    running.set(userId, child);
  });
}
export function closeSearches() {
  for (const child of running.values()) child.kill("SIGKILL");
}
