import { accountStore, requireAdmin } from "../../utils/account";
export default defineEventHandler(async event => {
  requireAdmin(event);
  return (await accountStore()).list();
});
