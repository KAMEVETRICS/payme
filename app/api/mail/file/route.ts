// An attachment from an email the business received. Only the signed-in owner of that
// business can fetch it. PDFs and images open in the browser; anything else downloads,
// so a file sent by a stranger never runs as a page on our site.
import { readFileSync } from "node:fs";
import { findMail } from "../../../../src/web/mail.ts";
import { getSession } from "../../../../src/web/session.ts";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Please sign in.", { status: 401 });
  const url = new URL(req.url);
  const mail = findMail(session.uid, url.searchParams.get("mail") ?? "");
  const attachment = mail?.attachments[Number(url.searchParams.get("n"))];
  if (!attachment) return new Response("Not found.", { status: 404 });
  const type = attachment.contentType.toLowerCase();
  const inline = INLINE.has(type);
  const name = attachment.name.replace(/[^\w.\- ]/g, "_");
  return new Response(readFileSync(attachment.file), {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
    },
  });
}
