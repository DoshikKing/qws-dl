import { config, readiness } from "../utils/queue.mjs";
import { readQobuzSession } from '../utils/qobuz-session.mjs';
import { subscriptionStatus } from '../utils/qobuz-subscription.mjs';
export default defineEventHandler(event => {
  const settings = config();
  const status = readiness(settings);
  return event.context.user?.role === 'admin'
    ? { ...status, subscription: subscriptionStatus(readQobuzSession(settings.data)) }
    : status;
});
