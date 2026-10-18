// Every email that reaches a business, kept so the owner can read it: who sent it, the
// text, and the attachments, with what Payer did with it. Stored per business under
// data/mail/<ownerId>/<id>.json, attachments beside it in <id>/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const DIR = "data/mail";
const MAX_TEXT = 200_000;

export type StoredMail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  text: string;
  spam: boolean;
  recovered?: boolean; // Sender/subject/time and invoice files recovered; original body/recipients were not retained.
  attachments: { name: string; contentType: string; size: number; file: string }[];
  outcome: string; // what Payer did: "2 invoices sent to the agent", "No invoice in this email", ...
};

export function mailIdFor(messageId: string, from: string, subject: string): string {
  return createHash("sha256").update(`${messageId}|${from}|${subject}`).digest("hex").slice(0, 24);
}

/** Keep an email. A redelivery of the same message is kept once. */
export function saveMail(
  ownerId: string,
  mail: { from: string; recipients: string[]; subject: string; messageId: string; date?: string; text: string; spam: boolean; recovered?: boolean; attachments: { name: string; contentType: string; content: Buffer }[] },
  outcome: string,
): StoredMail | null {
  const id = mailIdFor(mail.messageId, mail.from, mail.subject);
  const dir = `${DIR}/${ownerId}`;
  if (existsSync(`${dir}/${id}.json`)) return null;
  mkdirSync(`${dir}/${id}`, { recursive: true });
  const sent = mail.date ? new Date(mail.date) : null;
  const stored: StoredMail = {
    id,
    from: mail.from,
    to: mail.recipients,
    subject: mail.subject,
    receivedAt: (sent && !Number.isNaN(sent.getTime()) ? sent : new Date()).toISOString(),
    text: mail.text.length > MAX_TEXT ? `${mail.text.slice(0, MAX_TEXT)}\n…` : mail.text,
    spam: mail.spam,
    ...(mail.recovered ? { recovered: true } : {}),
    attachments: mail.attachments.map((a, i) => {
      const file = `${dir}/${id}/${i}`;
      writeFileSync(file, a.content);
      return { name: a.name || `attachment-${i + 1}`, contentType: a.contentType, size: a.content.length, file };
    }),
    outcome,
  };
  writeFileSync(`${dir}/${id}.json`, JSON.stringify(stored, null, 2));
  return stored;
}

/** A business's emails, newest first. */
export function mailFor(ownerId: string): StoredMail[] {
  const dir = `${DIR}/${ownerId}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(`${dir}/${n}`, "utf8")) as StoredMail)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function findMail(ownerId: string, id: string): StoredMail | undefined {
  if (!/^[0-9a-f]{24}$/.test(id)) return undefined;
  const path = `${DIR}/${ownerId}/${id}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as StoredMail) : undefined;
}
