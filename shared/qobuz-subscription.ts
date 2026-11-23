export type QobuzSubscriptionStatus = {
  plan: string | null;
  endDate: string | null;
  autoRenew: boolean | null;
  checkedAt: string | null;
  daysLeft: number | null;
  stale: boolean;
  requiresLogin: boolean;
  state: 'disconnected' | 'unknown' | 'expired' | 'expiring' | 'active';
};
