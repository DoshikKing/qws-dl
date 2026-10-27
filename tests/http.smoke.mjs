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
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

for (const prefix of ['/', '/dl/', '/dl', '/music/dl/']) {
  test(`production HTTP (${prefix}, OAuth): login → queue → Python runner → files, failure, cancellation and restart`, async () => {
    // This fixture exercises our bridge and queue without pretending to authenticate with live Qobuz.
    const base = await mkdtemp(join(tmpdir(), "qws-http-"));
    const root = join(base, "orpheus");
    const python = join(base, "python-shim");
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
          ADMIN_USERNAME: "admin",
          ADMIN_PASSWORD: "test-interface-password",
          USER_INVITE_LIMIT: "1",
          QOBUZ_USERNAME: "retired-account",
          QOBUZ_PASSWORD: "retired-secret",
          QOBUZ_AUTH_MODE: "mobile",
          QOBUZ_USER_ID: "retired-user",
          QOBUZ_AUTH_TOKEN: "retired-token",
          QOBUZ_APP_ID: "",
          QOBUZ_APP_SECRET: "",
          ORPHEUS_DIR: root,
          PYTHON_BIN: python,
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
      await mkdir(join(root, "utils"));
      await writeFile(join(root, "utils/__init__.py"), "");
      await writeFile(join(root, "utils/utils.py"), "sanitise_name = lambda value: str(value) if value else ''\nfix_byte_limit = lambda path: str(path)\n");
      await writeFile(join(root, "orpheus/__init__.py"), "");
      await writeFile(
        join(root, "modules/qobuz/interface.py"),
        `from types import SimpleNamespace
class Qobuz:
    pass
class ModuleInterface:
    def get_track_info(self, track_id, *args, **kwargs):
        return SimpleNamespace(name='Название', artists=['Исполнитель'])
`,
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
from modules.qobuz.interface import ModuleInterface
ModuleInterface().get_track_info(sys.argv[-1].split('/')[-1])
time.sleep(0.15)
if sys.argv[-1].endswith('/2'):
    print('=== Track 2 failed ===')
elif sys.argv[-1].endswith('/3'):
    time.sleep(60)
else:
    print(os.environ['QOBUZ_AUTH_TOKEN'])
    Path(os.environ['DOWNLOAD_DIR'], 'Исполнитель - Название.flac').write_bytes(b'fixture-audio')
`,
      );
      await writeFile(
        python,
        `#!${resolve(".runtime/venv/bin/python")}
import os,sys,json
if len(sys.argv)>1 and sys.argv[1].endswith('qobuz_oauth.py'):
    payload=json.load(sys.stdin)
    if payload['action']=='prepare':
        print(json.dumps({'appId':'123456789','privateKey':'fixture-key','secrets':['fixture-secret']}))
    elif payload['code']=='fixture-code':
        print(json.dumps({'userId':'777','authToken':'fixture-oauth-session'}))
    else:
        print(json.dumps({'error':'fixture-private-body'}));sys.exit(1)
elif len(sys.argv)>1 and sys.argv[1].endswith('search_qobuz.py'):
    query, offset = sys.argv[3], int(sys.argv[4])
    if query == 'oauth-session':
        assert 'QOBUZ_AUTH_MODE' not in os.environ
        assert os.environ['QOBUZ_AUTH_TOKEN']=='fixture-oauth-session'
    if query == 'service-error':
        print(json.dumps({'error':'Fixture search unavailable'}));sys.exit(1)
    tracks = [{'id':'1','url':'https://open.qobuz.com/track/1','title':'Название','artist':'Исполнитель','album':'Альбом','duration':181,'streamable':True}]
    print(json.dumps({'tracks':tracks,'total':21,'offset':offset,'hasMore':offset==0},ensure_ascii=False))
else:
    os.execv(${JSON.stringify(resolve(".runtime/venv/bin/python"))},[${JSON.stringify(resolve(".runtime/venv/bin/python"))},*sys.argv[1:]])
`,
        { mode: 0o700 },
      );
      await mkdir(join(base, 'data'), { recursive: true });
      await writeFile(join(base, 'data/qobuz-session.json'), JSON.stringify({ userId: '12345', authToken: 'test-session-secret', updatedAt: new Date().toISOString() }));
      await start();
      assert.equal((await api('/api/admin/qobuz/login', 'POST')).status, 401);
      assert.equal(
        (await api("/api/search", "POST", { query: "Песня" })).status,
        401,
      );
      assert.equal((await api("/api/jobs")).status, 401);
      assert.equal(
        (
          await api("/api/login", "POST", {
            username: "admin",
            password: "wrong",
          })
        ).status,
        401,
      );
      const login = await api("/api/login", "POST", {
        username: "admin",
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
      for (const body of [
        { query: "" },
        { query: "x".repeat(201) },
        { query: "q", offset: -1 },
      ])
        assert.equal((await api("/api/search", "POST", body)).status, 400);
      const catalog = await (
        await api("/api/search", "POST", { query: "Песня" })
      ).json();
      assert.equal(catalog.tracks[0].url, "https://open.qobuz.com/track/1");
      assert.equal(catalog.tracks[0].artist, "Исполнитель");
      assert.equal(catalog.hasMore, true);
      const nextPage = await (
        await api("/api/search", "POST", { query: "Песня", offset: 20 })
      ).json();
      assert.equal(nextPage.offset, 20);
      assert.equal(nextPage.hasMore, false);
      assert.equal(
        (await api("/api/search", "POST", { query: "service-error" })).status,
        502,
      );

      assert.equal(
        (await api("/api/jobs", "POST", { url: "https://evil.test/track/1" }))
          .status,
        400,
      );
      assert.equal((await api('/api/jobs', 'POST', {
        url: catalog.tracks[0].url, lyrics: 'true',
      })).status, 400);
      const first = await (
        await api("/api/jobs", "POST", {
          url: catalog.tracks[0].url,
          quality: "lossless",
          retentionHours: 1,
          lyrics: true,
        })
      ).json();
      await until(
        async () =>
          (await jobs()).find((job) => job.id === first.id)?.status ===
          "completed",
      );
      const finished = (await jobs()).find((job) => job.id === first.id);
      assert.equal(finished.retentionHours, 1);
      assert.equal(finished.lyrics, true);
      assert.ok(finished.log.includes("Не удалось добавить текст; аудиофайл сохранён."));
      assert.equal(finished.title, "Исполнитель - Название");
      assert.equal(
        Date.parse(finished.expiresAt) - Date.parse(finished.finishedAt),
        3600_000,
      );
      assert.equal(finished.hasFiles, true);
      assert.equal((await api(`/api/jobs/${first.id}/archive`, 'POST')).status, 200);
      assert.equal((await jobs()).find(job => job.id === first.id).status, 'completed');
      assert.ok(!finished.log.includes("test-account-secret"));
      assert.ok(!finished.log.includes("test-session-secret"));
      const settings = JSON.parse(
        await readFile(join(root, "config/settings.json"), "utf8"),
      );
      assert.equal(
        settings.modules.qobuz.username,
        "12345",
      );
      assert.equal(
        settings.modules.qobuz.password,
        "test-session-secret",
      );
      assert.equal(
        settings.global.formatting.single_full_path_format,
        "{artist} - {name}",
      );
      assert.equal(
        settings.global.formatting.track_filename_format,
        "{track_number}. {artist} - {name}",
      );
      const library = await (await api("/api/files")).json();
      assert.equal(library.files.length, 1);
      assert.equal(library.files[0].name, "Исполнитель - Название.zip");
      assert.deepEqual(await readdir(join(base, "downloads", first.id)), [
        ".qws-archive.zip",
      ]);
      const file = await api(
        "/api/file?path=" +
          encodeURIComponent(first.id + "/Исполнитель - Название.flac"),
      );
      assert.equal(file.status, 404);
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
      assert.ok(
        decodeURIComponent(archive.headers.get("content-disposition")).includes(
          "Исполнитель - Название.zip",
        ),
      );
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
        "Исполнитель - Название.flac": "fixture-audio",
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
      await until(
        async () =>
          (await jobs()).find((job) => job.id === cancelled.id)?.title ===
          "Исполнитель - Название",
      );
      assert.equal(
        (await api(`/api/jobs/${cancelled.id}/archive`)).status,
        409,
      );
      assert.equal(
        (await api(`/api/admin/downloads/${cancelled.id}`, "DELETE")).status,
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
      {
        const forbidden = await fetch(origin + '/api/admin/qobuz/login', {
          method: 'POST', headers: { cookie, origin: 'https://other.example' },
        });
        assert.equal(forbidden.status, 403);
        const begin = await api('/api/admin/qobuz/login', 'POST');
        assert.equal(begin.status, 200);
        const flowCookie = begin.headers.get('set-cookie').split(';')[0];
        assert.ok(begin.headers.get('set-cookie').includes('SameSite=Lax'));
        assert.ok(begin.headers.get('set-cookie').includes('HttpOnly'));
        const flow = await begin.json();
        assert.deepEqual(Object.keys(flow), ['url']);
        const redirect = new URL(new URL(flow.url).searchParams.get('redirect_url'));
        assert.ok((redirect.origin + redirect.pathname).startsWith(origin + '/api/qobuz/callback/'));
        redirect.searchParams.set('code', 'fixture-code');
        const invalid = await fetch(redirect, { redirect: 'manual' });
        assert.equal(invalid.status, 303);
        assert.ok(invalid.headers.get('location').endsWith('?qobuz=failed'));
        assert.equal(JSON.parse(await readFile(join(base, 'data/qobuz-session.json'), 'utf8')).userId, '12345');
        // Cross-site navigation lacks the Strict app cookie; the temporary Lax cookie binds it instead.
        const callback = await fetch(redirect, { headers: { cookie: flowCookie }, redirect: 'manual' });
        assert.equal(callback.status, 303);
        assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(callback.headers.get('location'), prefix.replace(/\/?$/, '/') + '?qobuz=connected');
        assert.ok(!JSON.stringify([...callback.headers]).includes('fixture-oauth-session'));
        assert.equal((await (await api('/api/status')).json()).oauthConnected, true);
        const replay = await fetch(redirect, { headers: { cookie: flowCookie }, redirect: 'manual' });
        assert.ok(replay.headers.get('location').endsWith('?qobuz=failed'));
        await stop();
        await start();
        assert.equal((await (await api('/api/status')).json()).oauthConnected, true);
        assert.equal((await api('/api/search', 'POST', { query: 'oauth-session' })).status, 200);
        const oauthJob = await (await api('/api/jobs', 'POST', { url: 'https://open.qobuz.com/track/1' })).json();
        await until(async () => (await jobs()).find(job => job.id === oauthJob.id)?.status === 'completed');
        assert.ok(!(await jobs()).find(job => job.id === oauthJob.id).log.includes('fixture-oauth-session'));
        const oauthSettings = JSON.parse(await readFile(join(root, 'config/settings.json'), 'utf8'));
        assert.equal(oauthSettings.modules.qobuz.username, '777');
        assert.equal(oauthSettings.modules.qobuz.password, 'fixture-oauth-session');
      }
      if (prefix === "/") {
        const adminCookie = cookie;
        const admin = await (await api("/api/account")).json();
        assert.equal(admin.role, "admin");
        assert.equal(admin.invitesRemaining, null);
        assert.equal(
          (
            await api("/api/register", "POST", {
              username: "noinvite",
              password: "member-password",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api("/api/invitations/check", "POST", {
              code: admin.inviteCode,
            })
          ).status,
          200,
        );
        const register = await api("/api/register", "POST", {
          inviteCode: admin.inviteCode,
          username: "alice",
          password: "member-password",
          role: "admin",
        });
        assert.equal(register.status, 200);
        cookie = register.headers.get("set-cookie").split(";")[0];
        const aliceCookie = cookie;
        const alice = await (await api("/api/account")).json();
        assert.equal(alice.role, "user");
        assert.equal((await api('/api/admin/qobuz/login', 'POST')).status, 403);
        assert.equal(
          (await api("/api/search", "POST", { query: "Песня" })).status,
          200,
        );
        const searchFailure = await api("/api/search", "POST", {
          query: "service-error",
        });
        assert.equal(searchFailure.status, 502);
        assert.ok(
          (await searchFailure.json()).statusMessage.includes("администратору"),
        );

        assert.equal(alice.invitesRemaining, 1);
        assert.equal((await api("/api/admin/users")).status, 403);
        assert.equal(
          (
            await api(`/api/admin/users/${admin.id}`, "PATCH", {
              action: "delete",
            })
          ).status,
          403,
        );
        assert.deepEqual(await jobs(), []);
        assert.equal((await api(`/api/jobs/${first.id}/archive`)).status, 404);
        assert.equal(
          (await api(`/api/jobs/${first.id}`, "DELETE")).status,
          404,
        );
        assert.equal(
          (
            await api(
              "/api/file?path=" +
                encodeURIComponent(first.id + "/Исполнитель - Название.flac"),
            )
          ).status,
          404,
        );
        const own = await (
          await api("/api/jobs", "POST", {
            url: "https://open.qobuz.com/track/1",
            userId: admin.id,
          })
        ).json();
        await until(
          async () =>
            (await jobs()).find((job) => job.id === own.id)?.status ===
            "completed",
        );
        assert.equal(own.userId, alice.id);
        assert.equal((await (await api("/api/files")).json()).files.length, 1);
        assert.equal((await api("/api/admin/downloads")).status, 403);
        assert.equal(
          (await api(`/api/admin/downloads/${own.id}`, "DELETE")).status,
          403,
        );
        assert.equal(
          (
            await api(
              "/api/file?path=" +
                encodeURIComponent(own.id + "/Исполнитель - Название.flac"),
            )
          ).status,
          404,
        );
        assert.equal((await api(`/api/jobs/${own.id}/archive`)).status, 200);
        const bobRegister = await api("/api/register", "POST", {
          inviteCode: alice.inviteCode,
          username: "bob",
          password: "member-password",
        });
        assert.equal(bobRegister.status, 200);
        assert.equal(
          (
            await api("/api/register", "POST", {
              inviteCode: alice.inviteCode,
              username: "charlie",
              password: "member-password",
            })
          ).status,
          400,
        );
        const passwordChange = await api("/api/account/password", "POST", {
          currentPassword: "member-password",
          password: "new-member-password",
        });
        assert.equal(passwordChange.status, 200);
        assert.equal((await api("/api/account")).status, 401);
        cookie = passwordChange.headers.get("set-cookie").split(";")[0];
        assert.equal((await api("/api/account")).status, 200);
        cookie = adminCookie;
        const adminCreated = await api("/api/register", "POST", {
          inviteCode: admin.inviteCode,
          username: "dave",
          password: "member-password",
        });
        assert.equal(adminCreated.status, 200);
        assert.equal((await api(`/api/jobs/${own.id}/archive`)).status, 404);
        const storage = await (await api("/api/admin/downloads")).json();
        assert.ok(
          storage.files.some(
            (file) => file.id === own.id && file.owner === "alice",
          ),
        );
        assert.equal(
          (await api(`/api/admin/downloads/${own.id}`, "DELETE")).status,
          200,
        );
        await assert.rejects(access(join(base, "downloads", own.id)));
        cookie = passwordChange.headers.get("set-cookie").split(";")[0];
        assert.ok((await jobs()).find((job) => job.id === own.id).deletedAt);
        assert.equal((await api(`/api/jobs/${own.id}/archive`)).status, 410);
        assert.equal((await (await api("/api/files")).json()).files.length, 0);
        cookie = adminCookie;
        assert.equal(
          (await (await api("/api/admin/downloads")).json()).files.some(
            (file) => file.id === own.id,
          ),
          false,
        );

        assert.equal(
          (
            await api(
              "/api/file?path=" +
                encodeURIComponent(own.id + "/Исполнитель - Название.flac"),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await api(`/api/admin/users/${admin.id}`, "PATCH", {
              action: "disable",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await api(`/api/admin/users/${alice.id}`, "PATCH", {
              action: "disable",
            })
          ).status,
          200,
        );
        cookie = aliceCookie;
        assert.equal((await api("/api/account")).status, 401);
        assert.equal(
          (
            await api("/api/login", "POST", {
              username: "alice",
              password: "new-member-password",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api("/api/invitations/check", "POST", {
              code: alice.inviteCode,
            })
          ).status,
          400,
        );
        cookie = adminCookie;
        assert.equal(
          (
            await api(`/api/admin/users/${alice.id}`, "PATCH", {
              action: "enable",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await api(`/api/admin/users/${alice.id}`, "PATCH", {
              action: "password",
              password: "reset-member-password",
            })
          ).status,
          200,
        );
        const resetLogin = await api("/api/login", "POST", {
          username: "alice",
          password: "reset-member-password",
        });
        assert.equal(resetLogin.status, 200);
        assert.equal(
          (
            await api(`/api/admin/users/${alice.id}`, "PATCH", {
              action: "delete",
            })
          ).status,
          200,
        );
        const users = await (await api("/api/admin/users")).json();
        assert.equal(
          users.some((user) => user.id === alice.id),
          false,
        );
        assert.ok(!JSON.stringify(users).includes("passwordHash"));
        cookie = resetLogin.headers.get("set-cookie").split(";")[0];
        assert.equal((await api("/api/account")).status, 401);
        cookie = adminCookie;
        const replacement = await api("/api/register", "POST", {
          inviteCode: admin.inviteCode,
          username: "alice",
          password: "replacement-password",
        });
        assert.equal(replacement.status, 200);
        cookie = replacement.headers.get("set-cookie").split(";")[0];
        assert.notEqual(
          (await (await api("/api/account")).json()).id,
          alice.id,
        );
        assert.deepEqual(await jobs(), []);
        assert.equal((await (await api("/api/files")).json()).files.length, 0);
        assert.equal((await api(`/api/jobs/${own.id}/archive`)).status, 404);
        cookie = adminCookie;
        assert.equal((await api("/api/logout", "POST")).status, 200);
        assert.equal((await api("/api/account")).status, 401);
      } else await api("/api/logout", "POST");
    } finally {
      await stop();
      await rm(base, { recursive: true, force: true });
    }
  });
}
