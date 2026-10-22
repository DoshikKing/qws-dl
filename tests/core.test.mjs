import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  chmod,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeUrl,
  redact,
  DownloadQueue,
  readiness,
  authMode,
} from "../server/utils/queue.mjs";
import { safeFile, listFiles } from "../server/utils/files.mjs";

test("accepts Qobuz media links and rejects arbitrary hosts, credentials and CLI arguments", () => {
  assert.equal(
    normalizeUrl("https://www.qobuz.com/gb-en/album/title/abc123?x=1"),
    "https://open.qobuz.com/album/abc123",
  );
  assert.equal(
    normalizeUrl("https://play.qobuz.com/track/123"),
    "https://open.qobuz.com/track/123",
  );
  for (const bad of [
    "--help",
    "http://open.qobuz.com/track/1",
    "https://evil.com/track/1",
    "https://open.qobuz.com.evil.com/track/1",
    "https://user:pass@open.qobuz.com/track/1",
    "https://open.qobuz.com:4000/track/1",
    "https://open.qobuz.com/redirect",
    null,
  ]) {
    assert.throws(() => normalizeUrl(bad));
  }
});

test("redacts credentials and signed URLs from process logs", () => {
  const old = process.env.QOBUZ_PASSWORD;
  process.env.QOBUZ_PASSWORD = "example-secret";
  try {
    const clean = redact(
      "example-secret https://qobuz.com/a?user_auth_token=token password: hidden",
    );
    for (const secret of [
      "example-secret",
      "https://",
      "token=token",
      "hidden",
    ])
      assert.ok(!clean.includes(secret));
  } finally {
    if (old === undefined) delete process.env.QOBUZ_PASSWORD;
    else process.env.QOBUZ_PASSWORD = old;
  }
});

test("web readiness requires only account credentials; mobile mode requires app keys", async () => {
  const names = [
    "QOBUZ_USERNAME",
    "QOBUZ_PASSWORD",
    "QOBUZ_APP_ID",
    "QOBUZ_APP_SECRET",
    "QOBUZ_AUTH_MODE",
    "QOBUZ_USER_ID",
    "QOBUZ_AUTH_TOKEN",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.QOBUZ_USERNAME = "fixture";
    process.env.QOBUZ_PASSWORD = "fixture";
    delete process.env.QOBUZ_APP_ID;
    delete process.env.QOBUZ_APP_SECRET;
    delete process.env.QOBUZ_AUTH_MODE;
    const settings = { root: "/missing", python: "/missing", quality: "hifi" };
    assert.deepEqual(readiness(settings).missing, []);
    assert.equal(readiness(settings).authMode, "web");
    process.env.QOBUZ_AUTH_MODE = "mobile";
    assert.deepEqual(readiness(settings).missing, [
      "QOBUZ_APP_ID",
      "QOBUZ_APP_SECRET",
    ]);
    process.env.QOBUZ_AUTH_MODE = "token";
    delete process.env.QOBUZ_USERNAME;
    delete process.env.QOBUZ_PASSWORD;
    delete process.env.QOBUZ_USER_ID;
    delete process.env.QOBUZ_AUTH_TOKEN;
    assert.deepEqual(readiness(settings).missing, [
      "QOBUZ_USER_ID",
      "QOBUZ_AUTH_TOKEN",
    ]);
    process.env.QOBUZ_USER_ID = "12345";
    process.env.QOBUZ_AUTH_TOKEN = "fixture-session-secret";
    assert.deepEqual(readiness(settings).missing, []);
    assert.ok(
      !redact("token: fixture-session-secret").includes(
        "fixture-session-secret",
      ),
    );
    process.env.QOBUZ_AUTH_MODE = "invalid";
    assert.throws(authMode, /web, token или mobile/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("file access stays inside downloads including symlinks; lists supported files", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-files-"));
  try {
    const root = join(base, "downloads");
    await mkdir(root);
    await writeFile(join(root, "song.flac"), "audio");
    await writeFile(join(base, "secret"), "private");
    await symlink(join(base, "secret"), join(root, "escape.flac"));
    assert.equal(await safeFile(root, "song.flac"), join(root, "song.flac"));
    await assert.rejects(safeFile(root, "../secret"));
    await assert.rejects(safeFile(root, "escape.flac"));
    await assert.rejects(safeFile(root, root));
    assert.deepEqual(
      (await listFiles(root)).files.map((file) => file.name),
      ["song.flac"],
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("restart records interrupted jobs as failed and persists history", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-queue-"));
  try {
    await writeFile(
      join(base, "jobs.json"),
      JSON.stringify([{ id: "old", status: "running" }]),
    );
    const queue = new DownloadQueue({
      data: base,
      downloads: join(base, "downloads"),
    });
    assert.equal(queue.jobs[0].status, "failed");
    assert.match(queue.jobs[0].error, /перезапущен/);
    queue.stopping = true;
    const job = queue.add("https://open.qobuz.com/album/abc", "hifi");
    assert.equal(job.status, "queued");
    assert.ok(queue.cancel(job.id));
    assert.equal(job.status, "cancelled");
    assert.equal(queue.cancel("missing"), false);
    queue.close();
    const restored = new DownloadQueue({
      data: base,
      downloads: join(base, "downloads"),
    });
    assert.equal(restored.jobs[0].status, "cancelled");
    restored.close();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("worker serializes processes, handles failures and cancels a running job", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-worker-"));
  const saved = Object.fromEntries(
    [
      "QOBUZ_USERNAME",
      "QOBUZ_PASSWORD",
      "QOBUZ_APP_ID",
      "QOBUZ_APP_SECRET",
    ].map((key) => [key, process.env[key]]),
  );
  let queue;
  const waitFor = async (predicate) => {
    const until = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > until)
        throw new Error("Worker did not reach expected state");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    for (const key in saved) process.env[key] = "test-secret";
    await mkdir(join(base, "modules/qobuz"), { recursive: true });
    await writeFile(join(base, "orpheus.py"), "");
    await writeFile(join(base, "modules/qobuz/interface.py"), "");
    const runner = join(base, "fake-runner.mjs");
    await writeFile(
      runner,
      `
      import {writeFileSync} from 'node:fs';
      console.log('Started test-secret https://qobuz.com/?token=private');
      if (process.argv[3].endsWith('/3')) setTimeout(()=>{},10000);
      else setTimeout(()=>{
        if (process.argv[3].endsWith('/2')) { console.error('Download failed'); process.exit(2) }
        writeFileSync(process.env.DOWNLOAD_DIR+'/test.flac','audio');
      },100);
    `,
    );
    const python = join(base, "python-shim");
    await writeFile(
      python,
      `#!/bin/sh\nshift\nexec "${process.execPath}" "$@"\n`,
    );
    await chmod(python, 0o700);
    queue = new DownloadQueue({
      root: base,
      python,
      data: join(base, "data"),
      downloads: join(base, "downloads"),
      runner,
      timeout: 5,
    });
    const first = queue.add("https://open.qobuz.com/track/1", "hifi");
    const second = queue.add("https://open.qobuz.com/track/2", "lossless");
    assert.equal(first.status, "running");
    assert.equal(second.status, "queued");
    await waitFor(() => second.status === "failed");
    assert.equal(first.status, "completed");
    assert.ok(!first.log.includes("test-secret"));
    assert.ok(!first.log.includes("https://"));
    assert.ok(
      (await listFiles(join(base, "downloads"))).files.some(
        (file) => file.name === "test.flac",
      ),
    );
    const third = queue.add("https://open.qobuz.com/track/3", "high");
    assert.equal(third.status, "running");
    queue.cancel(third.id);
    await waitFor(() => !queue.active);
    assert.equal(third.status, "cancelled");
  } finally {
    queue?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  }
});

test("retention is limited to 24 hours and expiration removes only the job's files and ZIP", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-expiry-"));
  let queue;
  try {
    const downloads = join(base, "downloads");
    queue = new DownloadQueue({
      data: join(base, "data"),
      downloads,
      retentionHours: 24,
    });
    queue.stopping = true;
    for (const hours of [0, 25, 1.5, "2", NaN])
      assert.throws(() =>
        queue.add("https://open.qobuz.com/track/1", "hifi", hours),
      );
    const expired = queue.add("https://open.qobuz.com/track/1", "hifi", 1);
    const active = queue.add("https://open.qobuz.com/track/2", "hifi", 24);
    expired.status = "completed";
    expired.expiresAt = new Date(Date.now() - 1000).toISOString();
    active.status = "running";
    active.expiresAt = expired.expiresAt;
    await mkdir(queue.folder(expired));
    await mkdir(queue.folder(active));
    await writeFile(join(queue.folder(expired), "song.flac"), "audio");
    await writeFile(join(queue.folder(expired), ".qws-archive.zip"), "zip");
    await writeFile(join(queue.folder(active), "keep.flac"), "active");
    await writeFile(join(base, "data/keep"), "settings");
    const outside = {
      id: "../data",
      status: "completed",
      expiresAt: expired.expiresAt,
    };
    queue.jobs.push(outside);
    queue.cleanupExpired();
    await assert.rejects(access(queue.folder(expired)));
    await access(join(queue.folder(active), "keep.flac"));
    await access(join(base, "data/keep"));
    assert.ok(expired.expiredAt);
    assert.equal(expired.hasFiles, false);
    assert.ok(queue.jobs.some((job) => job.id === expired.id));
    assert.ok(outside.cleanupError);
    assert.ok(queue.pathExpired(expired.id + "/song.flac"));
  } finally {
    queue?.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("expiry timer deletes files without HTTP activity", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-expiry-timer-"));
  let queue;
  try {
    queue = new DownloadQueue({
      data: join(base, "data"),
      downloads: join(base, "downloads"),
    });
    queue.stopping = true;
    const job = queue.add("https://open.qobuz.com/track/1", "high", 1);
    await mkdir(queue.folder(job));
    await writeFile(join(queue.folder(job), "song.mp3"), "audio");
    job.status = "completed";
    job.expiresAt = new Date(Date.now() + 50).toISOString();
    queue.stopping = false;
    queue.scheduleCleanup();
    const end = Date.now() + 2000;
    while (!job.expiredAt && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(job.expiredAt);
    await assert.rejects(access(queue.folder(job)));
  } finally {
    queue?.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("ZIP names preserve readable Unicode, remove unsafe characters and keep their extension", async () => {
  const { archiveFilename } = await import("../server/utils/archive.mjs");
  const job = {
    url: "https://open.qobuz.com/album/abc123",
    title: "Исполнитель - Альбом",
  };
  assert.equal(archiveFilename(job), "Исполнитель - Альбом.zip");
  assert.equal(
    archiveFilename({ ...job, title: '../A/B: C\r\n"?' }),
    ".. A B C.zip",
  );
  const long = archiveFilename({ ...job, title: "🎵".repeat(200) });
  assert.ok(Buffer.byteLength(long, "utf8") <= 184);
  assert.ok(long.endsWith(".zip"));
  assert.equal(
    archiveFilename({ ...job, title: null }),
    "qobuz-album-abc123.zip",
  );
});

test("titles are restored from metadata and older album folders without exposing UUIDs", async () => {
  const base = await mkdtemp(join(tmpdir(), "qws-titles-"));
  let queue;
  try {
    const settings = {
      data: join(base, "data"),
      downloads: join(base, "downloads"),
    };
    queue = new DownloadQueue(settings);
    queue.stopping = true;
    const job = queue.add("https://open.qobuz.com/album/abc123", "hifi");
    await mkdir(join(queue.folder(job), "Исполнитель - Альбом"), {
      recursive: true,
    });
    assert.equal(queue.readTitle(job), "Исполнитель - Альбом");
    await writeFile(
      join(queue.folder(job), ".qws-metadata.json"),
      JSON.stringify({ title: "Артист - Альбом (версия)" }),
    );
    const titleFile = join(queue.folder(job), ".qws-metadata.json");
    await writeFile(
      titleFile,
      JSON.stringify({ title: "A" + "🎵".repeat(600) }),
    );
    assert.doesNotThrow(() => encodeURIComponent(queue.readTitle(job)));
    assert.equal(Array.from(queue.readTitle(job)).length, 500);
    await writeFile(
      titleFile,
      JSON.stringify({ title: "Артист - Альбом (версия)" }),
    );
    queue.close();
    queue = new DownloadQueue(settings);
    queue.close();
    assert.equal(queue.jobs[0].title, "Артист - Альбом (версия)");
  } finally {
    queue?.close();
    await rm(base, { recursive: true, force: true });
  }
});
