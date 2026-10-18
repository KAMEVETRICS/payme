// Raw inbound email from the Cloudflare Email Worker (workers/email): the original
// message bytes, with the envelope recipient and sender in headers.
// Requires "Authorization: Bearer <INBOUND_WEBHOOK_SECRET>".
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { processInbox, receiveEmail } from "../../../../src/web/inbox.ts";
import { HttpError, route } from "../../../../src/web/http.ts";
import { parseRawEmail } from "../../../../src/web/raw-email.ts";

const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare Email Routing's own limit

function authorized(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const expected = `Bearer ${secret}`;
  const given = req.headers.get("authorization") ?? "";
  return !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const POST = route(async (req) => {
  if (!authorized(req)) throw new HttpError(401, "Not allowed.");
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length === 0) throw new HttpError(400, "Empty email.");
  if (raw.length > MAX_BYTES) throw new HttpError(413, "Email too large.");

  const mail = await parseRawEmail(raw, { to: req.headers.get("x-envelope-to"), from: req.headers.get("x-envelope-from") });
  const result = receiveEmail(mail);
  if ("queued" in result && result.queued > 0) {
    after(() => processInbox().catch((err) => console.error("Processing the inbox failed; the scheduler will retry", err)));
  }
  return result;
}, { external: true });
