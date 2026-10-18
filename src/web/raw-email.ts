// A raw email (RFC 822, as Cloudflare Email Routing hands it to a Worker) turned into
// the fields Payer needs.
import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import type { InboundFile } from "./email.ts";
import type { ReceivedEmail } from "./inbox.ts";

type Address = { address?: string; group?: { address: string }[] };

const addresses = (list?: Address[]) =>
  (list ?? []).flatMap((a) => (a.group ? a.group.map((m) => m.address) : a.address ? [a.address] : []));

const bytes = (content: ArrayBuffer | Uint8Array | string) =>
  typeof content === "string" ? Buffer.from(content) : Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content));

/** `envelope` is what the mail server saw, which forwarded and Bcc'd mail does not show in its headers. */
export async function parseRawEmail(raw: Buffer, envelope: { to?: string | null; from?: string | null } = {}): Promise<ReceivedEmail> {
  const email = await PostalMime.parse(raw);
  const header = (name: string) => email.headers.find((h) => h.key === name)?.value ?? "";
  const attachments: InboundFile[] = email.attachments.map((a) => ({
    name: a.filename ?? "attachment",
    contentType: a.mimeType,
    content: bytes(a.content),
  }));
  return {
    recipients: [envelope.to, email.deliveredTo, ...addresses(email.to), ...addresses(email.cc)].filter((a): a is string => !!a),
    from: (email.from as Address | undefined)?.address ?? envelope.from ?? "unknown sender",
    subject: email.subject ?? "",
    messageId: email.messageId ?? createHash("sha256").update(raw).digest("hex"),
    date: email.date,
    text: email.text ?? "",
    attachments,
    spam: /^yes/i.test(header("x-spam-status")),
  };
}
