import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { UserStore } from "../server/utils/users.mjs";

test("invitation quotas are atomic, admin invites unlimited; sessions, password changes and bootstrap persist", async () => {
  const data = await mkdtemp("/tmp/qws-users-");
  const settings = {
    data,
    adminUsername: "admin",
    adminPassword: "admin-fixture-password",
    inviteLimit: 1,
  };
  try {
    let store = await UserStore.open(settings);
    const admin = await store.login("ADMIN", settings.adminPassword);
    assert.ok(admin);
    assert.equal(await store.login("nobody", settings.adminPassword), null);
    const alice = await store.register(
      admin.inviteCode,
      "Alice",
      "user-fixture-password",
    );
    const bob = await store.register(
      admin.inviteCode,
      "bob",
      "user-fixture-password",
    );
    assert.notEqual(alice.passwordHash, bob.passwordHash);
    assert.equal(store.profile(admin).invitesRemaining, null);
    assert.equal(store.profile(alice).invitesRemaining, 1);
    await assert.rejects(
      store.register("invalid", "charlie", "user-fixture-password"),
    );
    const races = await Promise.allSettled([
      store.register(alice.inviteCode, "charlie", "user-fixture-password"),
      store.register(alice.inviteCode, "dave", "user-fixture-password"),
    ]);
    assert.equal(
      races.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const child = races.find((result) => result.status === "fulfilled").value;
    assert.equal(alice.invitedCount, 1);
    await store.manage(child.id, "delete");
    assert.equal(store.inviter(alice.inviteCode), null);
    const session = store.createSession(bob);
    assert.equal(store.session(session).id, bob.id);
    assert.equal(store.session(session + "a"), null);
    assert.equal(store.session("1.legacy-signature"), null);
    const adminSession = store.createSession(admin);
    store = await UserStore.open(settings);
    assert.equal(store.session(session).id, bob.id);
    const restoredBob = store.users.find((user) => user.id === bob.id);
    await store.changePassword(
      restoredBob,
      "user-fixture-password",
      "updated-fixture-password",
    );
    assert.equal(store.session(session), null);
    assert.equal(await store.login("bob", "user-fixture-password"), null);
    const newSession = store.createSession(
      await store.login("bob", "updated-fixture-password"),
    );
    await store.manage(bob.id, "disable");
    assert.equal(store.session(newSession), null);
    assert.equal(await store.login("bob", "updated-fixture-password"), null);
    await store.manage(bob.id, "enable");
    const expired = store.createSession(
      await store.login("bob", "updated-fixture-password"),
    );
    store.sessions.find((s) => s.userId === bob.id).expiresAt = Date.now() - 1;
    assert.equal(store.session(expired), null);
    await assert.rejects(store.manage(admin.id, "delete"));
    store = await UserStore.open({
      ...settings,
      adminUsername: "owner",
      adminPassword: "rotated-admin-password",
      inviteLimit: 0,
    });
    assert.equal(store.session(adminSession), null);
    assert.equal(await store.login("admin", settings.adminPassword), null);
    assert.ok(await store.login("owner", "rotated-admin-password"));
    assert.equal(store.inviter(bob.inviteCode), null);
    assert.ok(store.inviter(admin.inviteCode));
    const file = await readFile(join(data, "users.json"), "utf8");
    for (const secret of [
      settings.adminPassword,
      "user-fixture-password",
      "updated-fixture-password",
      "rotated-admin-password",
      session,
      adminSession,
    ])
      assert.ok(!file.includes(secret));
    assert.equal((await stat(join(data, "users.json"))).mode & 0o777, 0o600);
    await assert.rejects(UserStore.open({ ...settings, inviteLimit: -1 }));
    await assert.rejects(
      UserStore.open({ ...settings, adminPassword: "short" }),
    );
    await assert.rejects(UserStore.open({ ...settings, adminUsername: "bob" }));
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
