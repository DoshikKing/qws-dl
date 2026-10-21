import { readdir, realpath, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

export async function listFiles(root) {
  const files = [];
  async function walk(directory, depth) {
    if (depth > 15 || files.length >= 1000) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (files.length >= 1000) break;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (
        entry.isFile() &&
        /\.(flac|mp3|m4a|wav|ogg|opus|jpg|jpeg|png|pdf|lrc|m3u8?)$/i.test(
          entry.name,
        )
      ) {
        const info = await stat(path);
        files.push({
          path: relative(root, path).split(sep).join("/"),
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        });
      }
    }
  }
  await walk(root, 0);
  return {
    files: files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
    limit: 1000,
    truncated: files.length >= 1000,
  };
}

export async function safeFile(root, input) {
  if (typeof input !== "string" || !input || input.includes("\0"))
    throw new Error("Invalid path");
  const base = await realpath(root);
  const target = await realpath(resolve(base, input));
  if (!target.startsWith(base + sep) || !(await stat(target)).isFile())
    throw new Error("Invalid path");
  return target;
}
