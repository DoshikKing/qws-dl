import { readdirSync, statfsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export function folderBytes(folder) {
  try {
    let size = 0;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      size += entry.isDirectory() ? folderBytes(path) : lstatSync(path).size;
    }
    return size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}


export function requireSpace(settings, additionalBytes = 0) {
  const disk = statfsSync(settings.downloads);
  if (disk.bavail * disk.bsize < (settings.minFreeBytes ?? 1024 ** 3) + additionalBytes)
    throw Object.assign(new Error("Недостаточно свободного места для загрузки или ZIP."), { statusCode: 507 });
}
