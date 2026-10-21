import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const pending = new Map();

export async function jobArchive(queue, job) {
  if (queue.expired(job)) throw new Error("expired");
  if (
    ["queued", "running"].includes(job.status) ||
    queue.active?.job.id === job.id
  )
    throw new Error("running");
  if (!job.hasFiles) throw new Error("empty");
  if (pending.has(job.id)) return pending.get(job.id).promise;
  const task = { child: null, promise: null };
  task.promise = (async () => {
    const root = await realpath(queue.settings.downloads);
    const folder = await realpath(queue.folder(job));
    if (!folder.startsWith(root + sep)) throw new Error("empty");
    const file = join(folder, ".qws-archive.zip");
    try {
      if ((await stat(file)).isFile()) return file;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((done, reject) => {
      const child = spawn(
        queue.settings.python,
        [resolve("scripts/archive.py"), folder],
        { stdio: "ignore" },
      );
      task.child = child;
      const remaining = Date.parse(job.expiresAt) - Date.now();
      const timer = setTimeout(
        () => child.kill("SIGKILL"),
        Math.max(1, Math.min(300_000, remaining)),
      );
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        code === 0 ? done() : reject(new Error("build"));
      });
    });
    if (queue.expired(job)) throw new Error("expired");
    return file;
  })().finally(() => pending.delete(job.id));
  pending.set(job.id, task);
  return task.promise;
}

export function closeArchives() {
  for (const task of pending.values()) task.child?.kill("SIGKILL");
}
