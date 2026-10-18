// Postmark's inbound webhook: an email sent to a business's invoice address.
// Postmark calls https://postmark:<INBOUND_WEBHOOK_SECRET>@<host>/api/inbound/postmark.
// The reply is fast (queue, then answer); the agent reads the invoices right after.
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { processInbox, receiveEmail } from "../../../../src/web/inbox.ts";
import { HttpError, route } from "../../../../src/web/http.ts";

type Address = { Email?: string; MailboxHash?: string };
type PostmarkInbound = {
  From?: string;
  FromFull?: Address;
  ToFull?: Address[];
  CcFull?: Address[];
  BccFull?: Address[];
  MailboxHash?: string;
  Subject?: string;
  MessageID?: string;
  Date?: string;
  TextBody?: string;
  Headers?: { Name: string; Value: string }[];
  Attachments?: { Name: string; Content: string; ContentType: string; ContentLength: number }[];
};

function authorized(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const expected = `Basic ${Buffer.from(`postmark:${secret}`).toString("base64")}`;
  const given = req.headers.get("authorization") ?? "";
  return !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const POST = route(async (req) => {
  if (!authorized(req)) throw new HttpError(401, "Not allowed.");
  const mail = (await req.json()) as PostmarkInbound;
  const recipients = [...(mail.ToFull ?? []), ...(mail.CcFull ?? []), ...(mail.BccFull ?? [])];

  // Answers 200 even for mail it ignores, so Postmark does not keep retrying it.
  const result = receiveEmail({
    recipients: recipients.map((a) => a.Email ?? "").filter(Boolean),
    keys: [mail.MailboxHash, ...recipients.map((a) => a.MailboxHash)].filter((k): k is string => !!k),
    from: mail.FromFull?.Email ?? mail.From ?? "unknown sender",
    subject: mail.Subject ?? "",
    messageId: mail.MessageID ?? `${Date.now()}`,
    date: mail.Date,
    text: mail.TextBody ?? "",
    attachments: (mail.Attachments ?? []).map((a) => ({
      name: a.Name,
      contentType: a.ContentType,
      content: Buffer.from(a.Content, "base64"),
    })),
    spam: /^yes/i.test(mail.Headers?.find((h) => h.Name.toLowerCase() === "x-spam-status")?.Value ?? ""),
  });
  if ("queued" in result && result.queued > 0) {
    after(() => processInbox().catch((err) => console.error("Processing the inbox failed; the scheduler will retry", err)));
  }
  return result;
}, { external: true });
