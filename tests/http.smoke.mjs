import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

for (const prefix of ["/", "/dl/", "/dl", "/music/dl/"]) {
  test(`production HTTP (${prefix}): login → queue → Python runner → files, failure, cancellation and restart`, async () => {
    // This fixture exercises our bridge and queue without pretending to authenticate with live Qobuz.
    const base = await mkdtemp(join(tmpdir(), "qws-http-"));
    const root = join(base, "orpheus");
    const portServer = createServer();
    portServer.listen(0, "127.0.0.1");
    await once(portServer, "listening");
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    const origin = `http://127.0.0.1:${port}${prefix.replace(/\/$/, "")}`;
    let server;
    let logs = "";
    let cookie = "";
    const until = async (check) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for test state: " + logs);
    };
    const api = (path, method = "GET", body) =>
      fetch(origin + path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const jobs = async () => (await api("/api/jobs")).json();
    const stop = async () => {
      if (!server || server.exitCode !== null) return;
      const closed = once(server, "close");
      server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 4000);
      await closed;
      clearTimeout(timer);
    };
    const start = async () => {
      server = spawn(process.execPath, [".output/server/index.mjs"], {
        env: {
          ...process.env,
          NUXT_APP_BASE_URL: prefix,
          HOST: "127.0.0.1",
          PORT: String(port),
          WEB_PASSWORD: "test-interface-password",
          QOBUZ_USERNAME: "test-account",
          QOBUZ_PASSWORD: "test-account-secret",
          QOBUZ_AUTH_MODE: "web",
          QOBUZ_APP_ID: "",
          QOBUZ_APP_SECRET: "",
          ORPHEUS_DIR: root,
          PYTHON_BIN: resolve(".runtime/venv/bin/python"),
          DATA_DIR: join(base, "data"),
          DOWNLOAD_DIR: join(base, "downloads"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [server.stdout, server.stderr])
        stream.on("data", (chunk) => {
          logs += chunk;
        });
      await until(async () => {
        try {
          return (await fetch(origin + "/api/health")).ok;
        } catch {
          return false;
        }
      });
    };
    try {
      await mkdir(join(root, "modules/qobuz"), { recursive: true });
      await mkdir(join(root, "orpheus"));
      await writeFile(join(root, "orpheus/__init__.py"), "");
      await writeFile(
        join(root, "modules/qobuz/interface.py"),
        "class Qobuz:\n    pass\n",
      );
      await writeFile(
        join(root, "orpheus/core.py"),
        `
import json
from pathlib import Path
class Orpheus:
    def __init__(self, private):
        path = Path('config/settings.json')
        path.parent.mkdir(exist_ok=True)
        if not path.exists():
            path.write_text(json.dumps({'global': {'general': {}, 'advanced': {}}, 'modules': {'qobuz': {}}}))
`,
      );
      await writeFile(
        join(root, "orpheus.py"),
        `
import os, sys, time
from pathlib import Path
time.sleep(0.15)
if sys.argv[-1].endswith('/2'):
    print('=== Track 2 failed ===')
elif sys.argv[-1].endswith('/3'):
    time.sleep(60)
else:
    print(os.environ['QOBUZ_PASSWORD'])
    Path(os.environ['DOWNLOAD_DIR'], 'example.flac').write_bytes(b'fixture-audio')
`,
      );
      await start();
      assert.equal((await api("/api/jobs")).status, 401);
      assert.equal(
        (await api("/api/login", "POST", { password: "wrong" })).status,
        401,
      );
      const login = await api("/api/login", "POST", {
        password: "test-interface-password",
      });
      assert.equal(login.status, 200);
      assert.ok(
        login.headers
          .get("set-cookie")
          .includes("Path=" + prefix.replace(/\/?$/, "/")),
      );
      cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal((await (await api("/api/status")).json()).ready, true);
      assert.equal(
        (await api("/api/jobs", "POST", { url: "https://evil.test/track/1" }))
          .status,
        400,
      );
      const first = await (
        await api("/api/jobs", "POST", {
          url: "https://open.qobuz.com/track/1",
          quality: "lossless",
          retentionHours: 1,
        })
      ).json();
      await until(
        async () =>
          (await jobs()).find((job) => job.id === first.id)?.status ===
          "completed",
      );
      const finished = (await jobs()).find((job) => job.id === first.id);
      assert.equal(finished.retentionHours, 1);
      assert.equal(
        Date.parse(finished.expiresAt) - Date.parse(finished.finishedAt),
        3600_000,
      );
      assert.equal(finished.hasFiles, true);
      assert.ok(!finished.log.includes("test-account-secret"));
      const library = await (await api("/api/files")).json();
      assert.equal(library.files.length, 1);
      const file = await api(
        "/api/file?path=" + encodeURIComponent(library.files[0].path),
      );
      assert.equal(await file.text(), "fixture-audio");
      assert.match(file.headers.get("content-disposition"), /attachment/);
      for (const hours of [0, 25, 1.5])
        assert.equal(
          (
            await api("/api/jobs", "POST", {
              url: first.url,
              retentionHours: hours,
            })
          ).status,
          400,
        );
      const archive = await api(`/api/jobs/${first.id}/archive`);
      assert.equal(archive.status, 200);
      assert.equal(archive.headers.get("content-type"), "application/zip");
      const bytes = Buffer.from(await archive.arrayBuffer());
      const content = execFileSync(
        resolve(".runtime/venv/bin/python"),
        [
          "-c",
          "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))",
        ],
        { input: bytes },
      );
      assert.deepEqual(JSON.parse(content), {
        "example.flac": "fixture-audio",
      });
      assert.deepEqual(
        Buffer.from(
          await (await api(`/api/jobs/${first.id}/archive`)).arrayBuffer(),
        ),
        bytes,
      );
      assert.equal((await api("/api/file?path=../../etc/passwd")).status, 404);
      const failed = await (
        await api("/api/jobs", "POST", {
          url: "https://open.qobuz.com/track/2",
        })
      ).json();
      await until(
        async () =>
          (await jobs()).find((job) => job.id === failed.id)?.status ===
          "failed",
      );
      const cancelled = await (
        await api("/api/jobs", "POST", {
          url: "https://open.qobuz.com/track/3",
        })
      ).json();
      assert.equal(
        (await api(`/api/jobs/${cancelled.id}/archive`)).status,
        409,
      );
      assert.equal(
        (await api("/api/jobs/" + cancelled.id, "DELETE")).status,
        200,
      );
      assert.equal(
        (await jobs()).find((job) => job.id === cancelled.id).status,
        "cancelled",
      );
      await stop();
      await start();
      assert.equal((await jobs()).length, 3);
      assert.equal((await (await api("/api/files")).json()).files.length, 1);
      await stop();
      const historyFile = join(base, "data/jobs.json");
      const history = JSON.parse(await readFile(historyFile, "utf8"));
      history.find((job) => job.id === first.id).expiresAt = new Date(
        Date.now() - 1000,
      ).toISOString();
      await writeFile(historyFile, JSON.stringify(history));
      await start();
      assert.equal((await api(`/api/jobs/${first.id}/archive`)).status, 410);
      assert.equal((await (await api("/api/files")).json()).files.length, 0);
      assert.ok((await jobs()).find((job) => job.id === first.id).expiredAt);
      await assert.rejects(access(join(base, "downloads", first.id)));
      await api("/api/logout", "POST");
    } finally {
      await stop();
      await rm(base, { recursive: true, force: true });
    }
  });
}
