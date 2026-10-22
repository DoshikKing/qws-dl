import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";

export const qualities = ["hifi", "lossless", "high"];
export const requiredCredentials = ["QOBUZ_USERNAME", "QOBUZ_PASSWORD"];
const mobileCredentials = ["QOBUZ_APP_ID", "QOBUZ_APP_SECRET"];
const tokenCredentials = ["QOBUZ_USER_ID", "QOBUZ_AUTH_TOKEN"];

export function authMode() {
  const mode = process.env.QOBUZ_AUTH_MODE || "web";
  if (!["web", "mobile", "token"].includes(mode))
    throw new Error("QOBUZ_AUTH_MODE: выберите web, token или mobile.");
  return mode;
}

export function normalizeUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Укажите ссылку Qobuz.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Некорректная ссылка.");
  }
  if (
    url.protocol !== "https:" ||
    ![
      "open.qobuz.com",
      "play.qobuz.com",
      "www.qobuz.com",
      "qobuz.com",
    ].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Разрешены только HTTPS-ссылки Qobuz.");
  // Store one canonical URL; never pass arbitrary URL arguments to the CLI.
  const match = url.pathname.match(
    /^\/(?:[a-z]{2}-[a-z]{2}\/)?(track|album|playlist|artist|interpreter)\/(?:[^/]+\/)?([a-zA-Z0-9]+)\/?$/,
  );
  if (!match)
    throw new Error(
      "Нужна ссылка на трек, альбом, плейлист или исполнителя Qobuz.",
    );
  return `https://open.qobuz.com/${match[1]}/${match[2]}`;
}

export function config() {
  const quality = process.env.DOWNLOAD_QUALITY || "hifi";
  if (!qualities.includes(quality))
    throw new Error("DOWNLOAD_QUALITY: выберите hifi, lossless или high.");
  const timeout = Number(process.env.JOB_TIMEOUT_SECONDS || 7200);
  const retentionHours = Number(process.env.DOWNLOAD_RETENTION_HOURS || 24);
  if (
    !Number.isInteger(retentionHours) ||
    retentionHours < 1 ||
    retentionHours > 24
  )
    throw new Error(
      "DOWNLOAD_RETENTION_HOURS: выберите целое число от 1 до 24.",
    );
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 604800)
    throw new Error("JOB_TIMEOUT_SECONDS: допустимо 1–604800.");
  return {
    root: resolve(process.env.ORPHEUS_DIR || ".runtime/orpheusdl"),
    python: resolve(process.env.PYTHON_BIN || ".runtime/venv/bin/python"),
    data: resolve(process.env.DATA_DIR || "data"),
    downloads: resolve(process.env.DOWNLOAD_DIR || "downloads"),
    runner: resolve("scripts/run-orpheus.py"),
    quality,
    timeout,
    authMode: authMode(),
    retentionHours,
  };
}

export function readiness(settings = config()) {
  const mode = settings.authMode || authMode();
  const required = [
    ...(mode === "token" ? tokenCredentials : requiredCredentials),
    ...(mode === "mobile" ? mobileCredentials : []),
  ];
  const missing = required.filter((name) => !process.env[name]);
  const installed =
    existsSync(join(settings.root, "orpheus.py")) &&
    existsSync(join(settings.root, "modules/qobuz/interface.py")) &&
    existsSync(settings.python);
  return {
    installed,
    missing,
    ready: installed && missing.length === 0,
    quality: settings.quality,
    authMode: mode,
    retentionHours: settings.retentionHours || 24,
  };
}

export function redact(text) {
  let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  for (const name of [
    ...requiredCredentials,
    ...mobileCredentials,
    ...tokenCredentials,
    "WEB_PASSWORD",
  ]) {
    const value = process.env[name];
    if (value) clean = clean.split(value).join("[REDACTED]");
  }
  // Qobuz errors can include signed URLs and session tokens.
  return clean
    .replace(/https?:\/\/[^\s'"<>]+/g, "[URL]")
    .replace(
      /((?:user_auth_token|password|request_sig|app_secret)["'\s:=]+)[^\s,}"']+/gi,
      "$1[REDACTED]",
    );
}

export class DownloadQueue {
  constructor(settings = config()) {
    this.settings = settings;
    mkdirSync(settings.data, { recursive: true, mode: 0o700 });
    mkdirSync(settings.downloads, { recursive: true });
    this.file = join(settings.data, "jobs.json");
    this.jobs = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : [];
    for (const job of this.jobs) {
      if (job.status === "running") {
        job.status = "failed";
        job.error =
          "Сервер перезапущен во время загрузки. Добавьте ссылку повторно.";
        job.finishedAt = new Date().toISOString();
      }
      job.title ||= this.readTitle(job);
      job.retentionHours = Math.min(
        24,
        Math.max(1, Number(job.retentionHours) || 24),
      );
      if (!["running", "queued"].includes(job.status)) {
        job.expiresAt ||= new Date(
          Date.parse(
            job.finishedAt || job.createdAt || new Date().toISOString(),
          ) +
            job.retentionHours * 3600_000,
        ).toISOString();
        job.hasFiles = !job.expiredAt && this.hasFiles(job);
      }
    }
    this.save();
    this.active = null;
    this.stopping = false;
    this.cleanupExpired();
    this.scheduleCleanup();
    // ponytail: one worker per Node process; run one replica to protect Orpheus session storage.
    queueMicrotask(() => this.pump());
  }

  save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.jobs), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
  }

  add(url, quality, retentionHours = this.settings.retentionHours || 24) {
    url = normalizeUrl(url);
    if (!qualities.includes(quality)) throw new Error("Неизвестное качество.");
    if (
      !Number.isInteger(retentionHours) ||
      retentionHours < 1 ||
      retentionHours > 24
    )
      throw new Error("Срок хранения: целое число от 1 до 24 часов.");
    if (
      this.jobs.filter((job) => ["queued", "running"].includes(job.status))
        .length >= 50
    )
      throw new Error("Очередь заполнена (50 заданий).");
    const job = {
      id: randomUUID(),
      url,
      quality,
      status: "queued",
      createdAt: new Date().toISOString(),
      log: "",
      error: null,
      retentionHours,
      expiresAt: null,
      expiredAt: null,
      hasFiles: false,
    };
    this.jobs.unshift(job);
    // Keep unexpired jobs so their file expiry remains tracked beyond the history limit.
    this.pruneHistory();
    this.save();
    this.pump();
    return job;
  }

  cancel(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) return false;
    if (!["queued", "running"].includes(job.status)) return true;
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.expiresAt = new Date(
      Date.parse(job.finishedAt) + job.retentionHours * 3600_000,
    ).toISOString();
    this.save();
    if (this.active?.job.id === id) this.kill();
    this.scheduleCleanup();
    return true;
  }

  kill() {
    if (!this.active) return;
    const child = this.active.child;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 3000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }

  pump() {
    if (this.active || this.stopping) return;
    const job = [...this.jobs]
      .reverse()
      .find((item) => item.status === "queued");
    if (!job) return;
    const ready = readiness(this.settings);
    if (!ready.ready) {
      job.status = "failed";
      job.error = !ready.installed
        ? "Установите OrpheusDL: npm run setup:orpheus"
        : "Заполните в .env: " + ready.missing.join(", ");
      job.finishedAt = new Date().toISOString();
      job.expiresAt = new Date(
        Date.parse(job.finishedAt) + job.retentionHours * 3600_000,
      ).toISOString();
      this.save();
      this.scheduleCleanup();
      queueMicrotask(() => this.pump());
      return;
    }
    const folder = join(this.settings.downloads, job.id);
    mkdirSync(folder, { recursive: true });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.save();
    const child = spawn(
      this.settings.python,
      ["-u", this.settings.runner, this.settings.root, job.url, job.quality],
      {
        cwd: this.settings.root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DOWNLOAD_DIR: folder, PYTHONUNBUFFERED: "1" },
      },
    );
    this.active = { child, job };
    // Buffer complete lines before redacting so secrets split across chunks cannot leak.
    const consume = (stream) => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        pending += chunk;
        const lines = pending.split(/[\r\n]/);
        pending = lines.pop();
        if (lines.length) {
          job.log = (job.log + redact(lines.join("\n")) + "\n").slice(-24000);
          job.title ||= this.readTitle(job);
          this.save();
        }
        // Discard huge unterminated lines instead of retaining unbounded process output.
        if (pending.length > 64000) pending = "";
      });
      stream.on("end", () => {
        if (pending) job.log = (job.log + redact(pending) + "\n").slice(-24000);
      });
    };
    consume(child.stdout);
    consume(child.stderr);
    child.on("error", () => {
      job.error =
        "Не удалось запустить Python. Проверьте PYTHON_BIN и установку.";
    });
    const timer = setTimeout(() => {
      job.error = "Превышено время загрузки.";
      this.kill();
    }, this.settings.timeout * 1000);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (job.status !== "cancelled") {
        job.status = code === 0 && !job.error ? "completed" : "failed";
        if (code === 3 && !job.error)
          job.error =
            job.log
              .split("\n")
              .findLast((line) => line.startsWith("Qobuz: ")) ||
            "Не удалось войти в Qobuz. Подробности в журнале.";
        if (job.status === "failed" && !job.error)
          job.error =
            "OrpheusDL сообщил об ошибке. Подробности в журнале; часть файлов могла сохраниться.";
      }
      job.finishedAt = new Date().toISOString();
      job.expiresAt = new Date(
        Date.parse(job.finishedAt) + job.retentionHours * 3600_000,
      ).toISOString();
      job.title ||= this.readTitle(job);
      job.hasFiles = this.hasFiles(job);
      this.active = null;
      this.save();
      this.scheduleCleanup();
      this.pump();
    });
  }

  close() {
    this.stopping = true;
    clearTimeout(this.cleanupTimer);
    this.kill();
  }

  folder(job) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        job.id,
      )
    )
      throw new Error("Invalid job directory");
    return join(this.settings.downloads, job.id);
  }

  readTitle(job) {
    try {
      const folder = this.folder(job);
      try {
        const { title } = JSON.parse(
          readFileSync(join(folder, ".qws-metadata.json"), "utf8"),
        );
        if (typeof title === "string" && title.trim())
          return Array.from(title.replace(/[\x00-\x1f\x7f]/g, " ").trim())
            .slice(0, 500)
            .join("");
      } catch {}
      // Older downloads have no metadata: reuse the album folder or single audio filename.
      const entries = readdirSync(folder, { withFileTypes: true }).filter(
        (entry) =>
          entry.isDirectory() ||
          (entry.isFile() &&
            /\.(flac|mp3|m4a|wav|ogg|opus)$/i.test(entry.name)),
      );
      if (entries.length === 1)
        return entries[0].isDirectory()
          ? entries[0].name
          : entries[0].name.replace(/\.[^.]+$/, "");
    } catch {}
    return null;
  }

  hasFiles(job) {
    try {
      const walk = (folder) =>
        readdirSync(folder, { withFileTypes: true }).some(
          (entry) =>
            !entry.name.startsWith(".qws-") &&
            (entry.isFile() ||
              (entry.isDirectory() && walk(join(folder, entry.name)))),
        );
      return walk(this.folder(job));
    } catch {
      return false;
    }
  }

  expired(job, now = Date.now()) {
    return Boolean(
      job.expiredAt || (job.expiresAt && Date.parse(job.expiresAt) <= now),
    );
  }

  pathExpired(path) {
    const id = path.split(/[\\/]/)[0];
    const job = this.jobs.find((item) => item.id === id);
    return Boolean(job && this.expired(job));
  }

  pruneHistory() {
    this.jobs = this.jobs.filter(
      (job, index) =>
        index < 200 ||
        ["running", "queued"].includes(job.status) ||
        !job.expiredAt,
    );
  }

  cleanupExpired(now = Date.now()) {
    let changed = false;
    for (const job of this.jobs) {
      if (
        job.expiredAt ||
        !this.expired(job, now) ||
        ["running", "queued"].includes(job.status)
      )
        continue;
      try {
        // Remove only this job's generated UUID directory, never settings or a whole downloads root.
        rmSync(this.folder(job), { recursive: true, force: true });
        job.expiredAt = new Date(now).toISOString();
        job.hasFiles = false;
        delete job.cleanupError;
      } catch {
        job.cleanupError =
          "Не удалось удалить файлы. Проверьте права на каталог downloads.";
      }
      changed = true;
    }
    if (changed) {
      this.pruneHistory();
      this.save();
    }
  }

  scheduleCleanup() {
    clearTimeout(this.cleanupTimer);
    if (this.stopping) return;
    const times = this.jobs
      .filter(
        (job) =>
          job.expiresAt &&
          !job.expiredAt &&
          !["running", "queued"].includes(job.status),
      )
      .map((job) =>
        job.cleanupError ? Date.now() + 60_000 : Date.parse(job.expiresAt),
      );
    const delay = Math.max(
      1,
      Math.min(3600_000, ...times.map((time) => time - Date.now())),
    );
    this.cleanupTimer = setTimeout(() => {
      this.cleanupExpired();
      this.scheduleCleanup();
    }, delay);
    this.cleanupTimer.unref();
  }
}

let queue;
export function getQueue() {
  return (queue ||= new DownloadQueue());
}
