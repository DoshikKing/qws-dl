import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(24).toString("hex");
const sessionLifetime = 12 * 3600_000;

export function username(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(value)
  )
    throw new Error(
      "Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.",
    );
  return value.toLowerCase();
}
export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 256)
    throw new Error("Пароль должен содержать от 10 до 256 символов.");
}
async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${Buffer.from(await derive(value, salt, 64)).toString("hex")}`;
}
async function checkPassword(value, hash) {
  if (typeof value !== "string" || value.length > 256 || !hash) return false;
  const [salt, expected] = hash.split(":");
  const actual = Buffer.from(await derive(value, salt, 64));
  const bytes = Buffer.from(expected, "hex");
  return bytes.length === actual.length && timingSafeEqual(bytes, actual);
}

export class UserStore {
  static async open({
    data = resolve(process.env.DATA_DIR || "data"),
    adminUsername = process.env.ADMIN_USERNAME || "admin",
    adminPassword = process.env.ADMIN_PASSWORD || process.env.WEB_PASSWORD,
    inviteLimit = Number(process.env.USER_INVITE_LIMIT ?? 1),
  } = {}) {
    if (
      !Number.isInteger(inviteLimit) ||
      inviteLimit < 0 ||
      inviteLimit > 10000
    )
      throw new Error("USER_INVITE_LIMIT: целое число от 0 до 10000.");
    const login = username(adminUsername);
    validatePassword(adminPassword);
    const store = new UserStore(data, inviteLimit);
    let admin = store.users.find((user) => user.role === "admin");
    if (
      store.users.some(
        (user) => user.username === login && user.id !== admin?.id,
      )
    )
      throw new Error("ADMIN_USERNAME занят другим пользователем.");
    if (!admin) {
      admin = store.makeUser(
        login,
        await hashPassword(adminPassword),
        null,
        "admin",
      );
      store.users.push(admin);
    } else if (
      admin.username !== login ||
      !(await checkPassword(adminPassword, admin.passwordHash))
    ) {
      admin.username = login;
      admin.passwordHash = await hashPassword(adminPassword);
      store.revoke(admin.id);
    }
    store.dummyHash = admin.passwordHash;
    store.save();
    return store;
  }
  constructor(data, inviteLimit) {
    mkdirSync(data, { recursive: true, mode: 0o700 });
    this.file = join(data, "users.json");
    const stored = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : {};
    this.users = stored.users || [];
    this.sessions = stored.sessions || [];
    this.inviteLimit = inviteLimit;
  }
  save() {
    this.sessions = this.sessions.filter(
      (session) => session.expiresAt > Date.now(),
    );
    writeFileSync(
      this.file + ".tmp",
      JSON.stringify({ users: this.users, sessions: this.sessions }),
      { mode: 0o600 },
    );
    renameSync(this.file + ".tmp", this.file);
  }
  makeUser(login, passwordHash, invitedBy, role = "user") {
    return {
      id: randomUUID(),
      username: login,
      passwordHash,
      role,
      disabled: false,
      inviteCode: token(),
      invitedCount: 0,
      invitedBy,
      createdAt: new Date().toISOString(),
    };
  }
  profile(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      inviteCode: user.inviteCode,
      invitedCount: user.invitedCount,
      inviteLimit: user.role === "admin" ? null : this.inviteLimit,
      invitesRemaining:
        user.role === "admin"
          ? null
          : Math.max(0, this.inviteLimit - user.invitedCount),
    };
  }
  inviter(code) {
    if (typeof code !== "string" || !/^[a-f0-9]{48}$/.test(code.trim()))
      return null;
    return (
      this.users.find(
        (user) =>
          user.inviteCode === code.trim() &&
          !user.disabled &&
          (user.role === "admin" || user.invitedCount < this.inviteLimit),
      ) || null
    );
  }
  async register(code, login, password) {
    login = username(login);
    validatePassword(password);
    if (!this.inviter(code))
      throw new Error("Приглашение недействительно или его лимит исчерпан.");
    const passwordHash = await hashPassword(password);
    // Recheck after hashing: concurrent registrations must not exceed the invite limit.
    const inviter = this.inviter(code);
    if (!inviter)
      throw new Error("Приглашение недействительно или его лимит исчерпан.");
    if (this.users.some((user) => user.username === login))
      throw new Error("Этот логин уже занят.");
    const user = this.makeUser(login, passwordHash, inviter.id);
    this.users.push(user);
    inviter.invitedCount++;
    this.save();
    return user;
  }
  async login(login, password) {
    const user =
      typeof login === "string"
        ? this.users.find((user) => user.username === login.toLowerCase())
        : null;
    const hash = user?.passwordHash || this.dummyHash;
    const correct = await checkPassword(password, hash);
    if (
      !correct ||
      !user ||
      user.disabled ||
      !this.users.includes(user) ||
      user.passwordHash !== hash
    )
      return null;
    return user;
  }
  createSession(user) {
    if (!this.users.includes(user) || user.disabled)
      throw new Error("Войдите повторно.");
    const value = token();
    const own = this.sessions.filter((session) => session.userId === user.id);
    if (own.length >= 10)
      this.sessions = this.sessions.filter((session) => session !== own[0]);
    this.sessions.push({
      hash: digest(value),
      userId: user.id,
      expiresAt: Date.now() + sessionLifetime,
    });
    this.save();
    return value;
  }
  session(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{48}$/.test(value)) return null;
    const session = this.sessions.find(
      (session) =>
        session.hash === digest(value) && session.expiresAt > Date.now(),
    );
    return (
      (session &&
        this.users.find(
          (user) => user.id === session.userId && !user.disabled,
        )) ||
      null
    );
  }
  logout(value) {
    if (typeof value !== "string") return;
    this.sessions = this.sessions.filter(
      (session) => session.hash !== digest(value),
    );
    this.save();
  }
  revoke(id) {
    this.sessions = this.sessions.filter((session) => session.userId !== id);
  }
  async changePassword(user, currentPassword, password) {
    if (user.role === "admin")
      throw new Error(
        "Пароль администратора меняется через ADMIN_PASSWORD в .env.",
      );
    validatePassword(password);
    const previous = user.passwordHash;
    if (!(await checkPassword(currentPassword, previous)))
      throw new Error("Неверный текущий пароль.");
    const hash = await hashPassword(password);
    if (
      !this.users.includes(user) ||
      user.disabled ||
      user.passwordHash !== previous
    )
      throw new Error("Войдите повторно.");
    user.passwordHash = hash;
    this.revoke(user.id);
    this.save();
  }
  list() {
    return this.users.map((user) => ({
      ...this.profile(user),
      disabled: user.disabled,
      invitedBy:
        this.users.find((inviter) => inviter.id === user.invitedBy)?.username ||
        null,
    }));
  }
  async manage(id, action, password) {
    const user = this.users.find((user) => user.id === id);
    if (!user) throw new Error("Пользователь не найден.");
    if (user.role === "admin")
      throw new Error("Аккаунт администратора управляется через .env.");
    if (action === "disable") user.disabled = true;
    else if (action === "enable") user.disabled = false;
    else if (action === "delete")
      this.users = this.users.filter((item) => item !== user);
    else if (action === "password") {
      validatePassword(password);
      const hash = await hashPassword(password);
      if (!this.users.includes(user))
        throw new Error("Пользователь не найден.");
      user.passwordHash = hash;
    } else throw new Error("Неизвестное действие.");
    this.revoke(id);
    this.save();
  }
}
let store;
export function getUsers() {
  // One process owns the atomic JSON store, matching the serialized download worker.
  return (store ||= UserStore.open().catch((error) => {
    store = null;
    throw error;
  }));
}
