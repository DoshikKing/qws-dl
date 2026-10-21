import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";

export const qualities = ["hifi", "lossless", "high"];
export const requiredCredentials = [
  "QOBUZ_USERNAME",
  "QOBUZ_PASSWORD",
  "QOBUZ_APP_ID",
  "QOBUZ_APP_SECRET",
];

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
  };
}

export function readiness(settings = config()) {
  const missing = requiredCredentials.filter((name) => !process.env[name]);
  const installed =
    existsSync(join(settings.root, "orpheus.py")) &&
    existsSync(join(settings.root, "modules/qobuz/interface.py")) &&
    existsSync(settings.python);
  return {
    installed,
    missing,
    ready: installed && missing.length === 0,
    quality: settings.quality,
  };
}

export function redact(text) {
  let clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  for (const name of [...requiredCredentials, "WEB_PASSWORD"]) {
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
    }
    this.save();
    this.active = null;
    this.stopping = false;
    // ponytail: one worker per Node process; run one replica to protect Orpheus session storage.
    queueMicrotask(() => this.pump());
  }

  save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.jobs), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
  }

  add(url, quality) {
    url = normalizeUrl(url);
    if (!qualities.includes(quality)) throw new Error("Неизвестное качество.");
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
    };
    this.jobs.unshift(job);
    // Bound the JSON history; downloaded files are retained independently.
    this.jobs = this.jobs.slice(0, 200);
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
    this.save();
    if (this.active?.job.id === id) this.kill();
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
      this.save();
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
        if (job.status === "failed" && !job.error)
          job.error =
            "OrpheusDL сообщил об ошибке. Подробности в журнале; часть файлов могла сохраниться.";
      }
      job.finishedAt = new Date().toISOString();
      this.active = null;
      this.save();
      this.pump();
    });
  }

  close() {
    this.stopping = true;
    this.kill();
  }
}

let queue;
export function getQueue() {
  return (queue ||= new DownloadQueue());
}
