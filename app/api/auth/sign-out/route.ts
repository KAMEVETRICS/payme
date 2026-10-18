import { route } from "../../../../src/web/http.ts";
import { clearSession } from "../../../../src/web/session.ts";

export const POST = route(async () => {
  await clearSession();
  return { next: "/" };
});
