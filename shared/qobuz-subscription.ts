export type QobuzSubscriptionStatus = {
  plan: string | null;
  endDate: string | null;
  reportedEndDate: string | null;
  accessActive: boolean | null;
  autoRenew: boolean | null;
  checkedAt: string | null;
  daysLeft: number | null;
  stale: boolean;
  requiresLogin: boolean;
  state: 'disconnected' | 'unknown' | 'unconfirmed' | 'inactive' | 'expiring' | 'active';
};
