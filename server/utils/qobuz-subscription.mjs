// Qobuz provides a calendar end_date, not a token-expiry timestamp.
export function normalizeSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const endDate = typeof value.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.endDate) &&
    Number.isFinite(Date.parse(value.endDate)) && new Date(value.endDate).toISOString().slice(0, 10) === value.endDate ? value.endDate : null;
  const plan = typeof value.plan === 'string' && value.plan.length <= 80 && !/[\x00-\x1f\x7f]/.test(value.plan) ? value.plan.trim() || null : null;
  return { plan, endDate, autoRenew: typeof value.autoRenew === 'boolean' ? value.autoRenew : null };
}

export function subscriptionStatus(session, now = Date.now()) {
  const subscription = normalizeSubscription(session?.subscription);
  const checkedAt = Number.isFinite(Date.parse(session?.updatedAt)) ? new Date(session.updatedAt).toISOString() : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const daysLeft = subscription?.endDate ? Math.round((Date.parse(subscription.endDate) - Date.parse(today)) / 86400_000) : null;
  return {
    plan: subscription?.plan || null, endDate: subscription?.endDate || null, autoRenew: subscription?.autoRenew ?? null,
    checkedAt, daysLeft,
    stale: !!session && (!checkedAt || now - Date.parse(checkedAt) > 3600_000),
    requiresLogin: !!session?.needsLogin,
    state: !session ? 'disconnected' : daysLeft === null ? 'unknown' : daysLeft < 0 ? 'expired' : daysLeft <= 7 ? 'expiring' : 'active',
  };
}
