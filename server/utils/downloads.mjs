import { lstat } from "node:fs/promises";
import { jobArchive, archiveFilename } from "./archive.mjs";

export async function listArchives(queue, user, owners = null) {
  const files = [];
  for (const job of queue.jobs) {
    if (queue.expired(job) || (!owners && !queue.canAccess(job, user)))
      continue;
    const accessible =
      job.hasFiles || job.status === "archiving" || job.archiveError;
    if (!accessible) continue;
    let size = 0;
    if (job.hasFiles) {
      try {
        size = (await lstat(await jobArchive(queue, job))).size;
      } catch {
        continue;
      }
    }
    files.push({
      id: job.id,
      name: archiveFilename(job),
      title: job.title || archiveFilename(job),
      size,
      status: job.status,
      archiveError: job.archiveError || null,
      expiresAt: job.expiresAt,
      ...(owners
        ? {
            owner:
              owners.find((owner) => owner.id === job.userId)?.username ||
              (job.userId ? "Удалённый аккаунт" : "До регистрации аккаунтов"),
          }
        : {}),
    });
  }
  return { files };
}
