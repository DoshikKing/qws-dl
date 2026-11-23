// Qobuz provides a calendar end_date, not a token-expiry timestamp.
export function normalizeSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const endDate = typeof value.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.endDate) &&
    Number.isFinite(Date.parse(value.endDate)) && new Date(value.endDate).toISOString().slice(0, 10) === value.endDate ? value.endDate : null;
  const plan = typeof value.plan === 'string' && value.plan.length <= 80 && !/[\x00-\x1f\x7f]/.test(value.plan) ? value.plan.trim() || null : null;
  return { plan, endDate, autoRenew: typeof value.autoRenew === 'boolean' ? value.autoRenew : null,
    source: ['user/get', 'user/login'].includes(value.source) ? value.source : null,
    accessActive: typeof value.accessActive === 'boolean' ? value.accessActive : null };
}

export function subscriptionStatus(session, now = Date.now()) {
  const subscription = normalizeSubscription(session?.subscription);
  const checkedAt = Number.isFinite(Date.parse(session?.updatedAt)) ? new Date(session.updatedAt).toISOString() : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const verified = subscription?.source === 'user/get';
  const reportedEndDate = subscription?.endDate || null;
  const reportedDays = reportedEndDate ? Math.round((Date.parse(reportedEndDate) - Date.parse(today)) / 86400_000) : null;
  // A past billing record alone is not evidence that streaming access ended.
  const dateConflict = verified && reportedDays !== null && reportedDays < 0 && subscription?.accessActive !== false;
  const endDate = verified && !dateConflict ? reportedEndDate : null;
  const daysLeft = endDate ? reportedDays : null;
  return {
    plan: subscription?.plan || null, endDate, reportedEndDate, autoRenew: subscription?.autoRenew ?? null,
    accessActive: verified ? subscription?.accessActive ?? null : null,
    checkedAt, daysLeft,
    stale: !!session && (!checkedAt || now - Date.parse(checkedAt) > 3600_000),
    requiresLogin: !!session?.needsLogin,
    state: !session ? 'disconnected' : !subscription ? 'unknown' : !verified || dateConflict ? 'unconfirmed'
      : subscription?.accessActive === false ? 'inactive'
      : daysLeft === null ? 'unknown' : daysLeft <= 7 ? 'expiring' : 'active',
  };
}
