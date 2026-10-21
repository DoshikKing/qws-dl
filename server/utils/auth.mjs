import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export function passwordMatches(value, expected) {
  if (typeof value !== "string" || !expected) return false;
  const hash = (text) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(value), hash(expected));
}

export function sessionToken(password, timestamp = Date.now()) {
  return `${timestamp}.${createHmac("sha256", password).update(String(timestamp)).digest("hex")}`;
}

export function validSession(value, password) {
  if (!password || typeof value !== "string") return false;
  const timestamp = Number(value.split(".")[0]);
  const age = Date.now() - timestamp;
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age < 12 * 3600_000 &&
    passwordMatches(value, sessionToken(password, timestamp))
  );
}
