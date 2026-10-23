const buckets = new Map();

export function takeLimit(key, maximum, now = Date.now()) {
  for (const [name, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(name);
  }
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 10000) return false;
    bucket = { count: 0, expiresAt: now + 60_000 };
    buckets.set(key, bucket);
  }
  return ++bucket.count <= maximum;
}
