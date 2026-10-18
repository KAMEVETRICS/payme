// Invoices that arrive by email. Each business has a private inbox key; mail sent to
// <inbound address>+<key> reaches that business. The webhook queues the invoice files;
// processInbox() runs them through the agent, straight after the webhook answers and
// again from the scheduler for anything left over, so a failure is retried, not lost.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { processInvoice, type InvoiceSource } from "../agent/process.ts";
import { INVOICE_TYPES, inboxKeyFrom, invoiceAddress, invoiceFiles, type InboundFile } from "./email.ts";
import { saveMail } from "./mail.ts";
import { getBusiness, listBusinesses, needsNewVault, saveBusiness, type Business } from "./store.ts";

const QUEUE = "data/inbox";
const MAX_ATTEMPTS = 3;

type Queued = { id: string; ownerId: string; file: string; source: InvoiceSource; attempts: number };

/**
 * The business's invoice address: on INBOUND_DOMAIN (our own, e.g. invoices.example.com)
 * if set, else plus-addressed on INBOUND_ADDRESS (a provider's shared address). Null
 * until one is configured.
 */
export function inboxAddressFor(business: Business): string | null {
  if (!business.inboxKey) return null;
  return invoiceAddress(business.inboxKey, business.business, {
    domain: process.env.INBOUND_DOMAIN,
    address: process.env.INBOUND_ADDRESS,
  });
}

/** Give a business its inbox key if it has none yet. */
export function ensureInboxKey(business: Business): Business {
  if (business.inboxKey) return business;
  business.inboxKey = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  saveBusiness(business);
  return business;
}

export function businessForInboxKey(key: string): Business | undefined {
  const wanted = key.toLowerCase();
  return listBusinesses().find((b) => b.inboxKey === wanted);
}

/** An incoming email, whichever service delivered it. */
export type ReceivedEmail = {
  recipients: string[]; // every address it was sent, copied or forwarded to
  keys?: string[]; // inbox keys the provider already extracted (Postmark's MailboxHash)
  from: string;
  subject: string;
  messageId: string;
  date?: string;
  text: string;
  attachments: InboundFile[];
  spam: boolean;
};

/**
 * Find the business an email was sent to, pick its invoice parts, and queue them.
 * The caller then runs processInbox(); the scheduler catches anything left over.
 */
export function receiveEmail(mail: ReceivedEmail): { queued: number } | { ignored: string } {
  const keys = [...(mail.keys ?? []), ...mail.recipients.map((a) => inboxKeyFrom(a, process.env.INBOUND_DOMAIN))];
  const business = keys.filter((k): k is string => !!k).map(businessForInboxKey).find(Boolean);
  if (!business) return { ignored: "no business has this address" };
  // Keep every email for the owner to read, whatever happens to it next.
  if (mail.spam) {
    saveMail(business.ownerId, mail, "Marked as spam, so Payme did not read it.");
    return { ignored: "marked as spam" };
  }
  const files = invoiceFiles(mail.attachments, mail.subject, mail.text);
  if (!files.length) {
    saveMail(business.ownerId, mail, "Payme found no invoice in this email.");
    return { ignored: "no invoice in this email" };
  }
  const sent = mail.date ? new Date(mail.date) : null;
  const queued = enqueue(business.ownerId, files, {
    kind: "email",
    from: mail.from,
    subject: mail.subject,
    messageId: mail.messageId,
    receivedAt: (sent && !Number.isNaN(sent.getTime()) ? sent : new Date()).toISOString(),
  });
  saveMail(business.ownerId, mail, `Payme read ${files.length === 1 ? "the invoice" : `${files.length} invoice files`} in this email; see its answer on the dashboard.`);
  return { queued };
}

/** Queue invoice files for a business. The same email part is only ever queued once. */
export function enqueue(ownerId: string, files: InboundFile[], source: InvoiceSource): number {
  const dir = `${QUEUE}/${ownerId}`;
  mkdirSync(dir, { recursive: true });
  mkdirSync(`data/uploads/${ownerId}`, { recursive: true });
  let queued = 0;
  files.forEach((f, i) => {
    const id = createHash("sha256").update(`${source.messageId}|${i}|${f.name}`).digest("hex").slice(0, 24);
    if (["json", "working", "done", "failed"].some((s) => existsSync(`${dir}/${id}.${s}`))) return; // a redelivery
    const ext = INVOICE_TYPES[f.contentType.toLowerCase()] ?? (extname(f.name) || ".txt");
    const file = `data/uploads/${ownerId}/${Date.now()}-${id}${ext}`;
    writeFileSync(file, f.content);
    const item: Queued = { id, ownerId, file, source, attempts: 0 };
    writeFileSync(`${dir}/${id}.json`, JSON.stringify(item, null, 2));
    queued++;
  });
  return queued;
}

export type InboxOutcome = { business: string; from: string; outcome: string };

/** Run every queued invoice through the agent. Claims each one first, so two runners never process the same file. */
export async function processInbox(): Promise<InboxOutcome[]> {
  const outcomes: InboxOutcome[] = [];
  if (!existsSync(QUEUE)) return outcomes;
  for (const ownerId of readdirSync(QUEUE)) {
    const business = getBusiness(ownerId);
    if (business && needsNewVault(business)) continue; // read once the owner moves to a new vault
    const dir = `${QUEUE}/${ownerId}`;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const base = `${dir}/${name.slice(0, -".json".length)}`;
      try {
        renameSync(`${base}.json`, `${base}.working`); // the claim
      } catch {
        continue; // another runner took it
      }
      const item = JSON.parse(readFileSync(`${base}.working`, "utf8")) as Queued;
      if (!business) {
        renameSync(`${base}.working`, `${base}.failed`);
        continue;
      }
      try {
        const { decision } = await processInvoice(item.file, business, { source: item.source });
        renameSync(`${base}.working`, `${base}.done`);
        outcomes.push({ business: business.business, from: item.source.from, outcome: `${decision.action}: ${decision.reason}` });
      } catch (err) {
        item.attempts++;
        const next = item.attempts >= MAX_ATTEMPTS ? "failed" : "json";
        writeFileSync(`${base}.working`, JSON.stringify(item, null, 2));
        renameSync(`${base}.working`, `${base}.${next}`);
        const message = err instanceof Error ? err.message : String(err);
        outcomes.push({ business: business.business, from: item.source.from, outcome: `${next === "failed" ? "gave up" : "will retry"}: ${message}` });
      }
    }
  }
  return outcomes;
}
