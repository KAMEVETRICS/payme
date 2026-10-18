import { redirect } from "next/navigation";
import { mailFor } from "../../../src/web/mail.ts";
import { getSession } from "../../../src/web/session.ts";
import { getBusiness } from "../../../src/web/store.ts";
import { inboxAddressFor } from "../../../src/web/inbox.ts";
import { EmailInbox } from "./inbox";
export default async function EmailPage() {
  const session = await getSession(); if (!session) redirect("/login");
  const business = getBusiness(session.uid); if (!business) redirect("/onboarding");
  const mails = mailFor(session.uid).map((m) => ({ ...m, attachments: m.attachments.map((a) => ({ name: a.name, size: a.size })) }));
  return <><div className="page-heading"><div><p className="eyebrow">The supplier side of the conversation</p><h1>Emails</h1><p>Every message, attachment, and invoice in one place.</p></div></div><EmailInbox mails={mails} address={inboxAddressFor(business)} /></>;
}
