import { getQueue } from '../utils/queue.mjs';
export default defineEventHandler(event => getQueue().statistics.snapshot(event.context.user.id));
