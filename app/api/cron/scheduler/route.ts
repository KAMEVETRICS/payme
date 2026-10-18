// The scheduler as an endpoint for a hosted cron job (for example Vercel Cron, every
// minute). Requires "Authorization: Bearer <CRON_SECRET>". Locally, run
// `npm run scheduler` instead.
import { timingSafeEqual } from "node:crypto";
import { HttpError, route } from "../../../../src/web/http.ts";
import { processInbox } from "../../../../src/web/inbox.ts";
import { runDueWork } from "../../../../src/web/scheduler.ts";
import { listBusinesses, needsNewVault } from "../../../../src/web/store.ts";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function run(req: Request) {
  if (!authorized(req)) throw new HttpError(401, "Not allowed.");
  const inbox = await processInbox();
  return { inbox, outcomes: await runDueWork(listBusinesses().filter((b) => !needsNewVault(b))) };
}

export const GET = route(run, { external: true });
export const POST = route(run, { external: true });
