import { accountStore } from "../utils/account";
export default defineEventHandler(async (event) =>
  (await accountStore()).profile(event.context.user),
);
