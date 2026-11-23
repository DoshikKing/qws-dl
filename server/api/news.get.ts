import { requireCurrentUser } from '../utils/account';
import { newsFor } from '../utils/news.mjs';
export default defineEventHandler(event => newsFor(requireCurrentUser(event)));
