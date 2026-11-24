import { requireAdmin, requireCurrentUser, accountStore } from '../../utils/account';
import { getQueue } from '../../utils/queue.mjs';
export default defineEventHandler(async event => {
  requireAdmin(event);
  const store = await accountStore();
  requireCurrentUser(event);
  requireAdmin(event);
  const statistics = getQueue().statistics;
  return { since: statistics.since, users: store.users.map((user: { id: string; username: string; disabled: boolean }) => ({
    id: user.id, username: user.username, disabled: user.disabled, ...statistics.snapshot(user.id),
  })) };
});
