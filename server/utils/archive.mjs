import { spawn } from "node:child_process";
import { realpath, lstat, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { folderBytes, requireSpace } from "./storage.mjs";
import { workerEnvironment } from "./qobuz-session.mjs";

const pending = new Map();

export async function jobArchive(queue, job) {
  if (queue.expired(job) || job.deletedAt) throw new Error("expired");
  if (
    ["queued", "running", "archiving"].includes(job.status) ||
    queue.active?.job.id === job.id
  )
    throw new Error("running");
  if (!job.hasFiles) throw new Error("empty");
  const { file } = await archivePath(queue, job);
  if (!(await lstat(file)).isFile()) throw new Error("empty");
  return file;
}

async function archivePath(queue, job) {
  const root = await realpath(queue.settings.downloads);
  const folder = await realpath(queue.folder(job));
  if (!folder.startsWith(root + sep)) throw new Error("empty");
  return { folder, file: join(folder, ".qws-archive.zip") };
}

export async function prepareArchive(queue, job) {
  if (pending.has(job.id)) return pending.get(job.id).promise;
  const task = { child: null, promise: null };
  task.promise = (async () => {
    const { folder, file } = await archivePath(queue, job);
    await rm(join(folder, ".qws-work"), { recursive: true, force: true });
    // ZIP_STORED needs room for a second copy, plus headers and the free-space reserve.
    const committed = await lstat(join(folder, ".qws-archive.commit")).catch(() => null);
    if (!committed?.isFile()) requireSpace(queue.settings, folderBytes(folder) + 1024 * 1024);
    await new Promise((done, reject) => {
      if (queue.stopping) {
        reject(new Error("stopping"));
        return;
      }
      const child = spawn(
        queue.settings.python,
        [resolve("scripts/archive.py"), folder],
        { stdio: "ignore", env: workerEnvironment() },
      );
      task.child = child;
      const timer = setTimeout(
        () => child.kill("SIGKILL"),
        Math.max(1, Math.min(300_000, Date.parse(job.expiresAt) - Date.now())),
      );
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        code === 0 ? done() : reject(new Error("build"));
      });
    });
    return file;
  })().finally(() => pending.delete(job.id));
  pending.set(job.id, task);
  return task.promise;
}

export function closeArchives() {
  for (const task of pending.values()) task.child?.kill("SIGKILL");
}

export function archiveFilename(job) {
  const fallback =
    "qobuz-" + new URL(job.url).pathname.slice(1).replaceAll("/", "-");
  let name = (job.title || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  while (Buffer.byteLength(name, "utf8") > 180)
    name = Array.from(name).slice(0, -1).join("");
  name = name.replace(/[. ]+$/, "") || fallback;
  return name + ".zip";
}
