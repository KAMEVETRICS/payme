// Recover email metadata and invoice files received before full email storage existed.
// Completed queue records stay untouched; this never queues or processes an invoice.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { InvoiceSource } from "../agent/process.ts";
import { INVOICE_TYPES, type InboundFile } from "./email.ts";
import { findMail, mailIdFor, saveMail } from "./mail.ts";

const inside = (directory: string, file: string) => {
  const path = relative(directory, file);
  return !!path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const contentTypes = Object.fromEntries(Object.entries(INVOICE_TYPES).map(([type, extension]) => [extension, type]));

export function recoverLegacyMail({ apply = false } = {}) {
  const result = { recovered: 0, skipped: 0, missingAttachments: 0 };
  if (!existsSync("data/inbox")) return result;
  const messages = new Map<string, { ownerId: string; source: InvoiceSource; files: Map<string, InboundFile> }>();
  for (const ownerId of readdirSync("data/inbox")) {
    if (!/^[a-zA-Z0-9-]+$/.test(ownerId) || !existsSync(`data/businesses/${ownerId}.json`)) continue;
    const business = JSON.parse(readFileSync(`data/businesses/${ownerId}.json`, "utf8")) as { ownerId?: string };
    if (business.ownerId !== ownerId) continue;
    const directory = `data/inbox/${ownerId}`;
    if (!statSync(directory).isDirectory()) continue;
    for (const name of readdirSync(directory).filter(n => n.endsWith(".done")).sort()) {
      let item: { ownerId?: unknown; file?: unknown; source?: Partial<InvoiceSource> } | null;
      try { item = JSON.parse(readFileSync(`${directory}/${name}`, "utf8")); }
      catch { result.skipped++; continue; }
      const source = item?.source;
      if (item?.ownerId !== ownerId || typeof item.file !== "string" || source?.kind !== "email" ||
        typeof source.from !== "string" || typeof source.subject !== "string" || typeof source.messageId !== "string" ||
        typeof source.receivedAt !== "string" || Number.isNaN(Date.parse(source.receivedAt))) { result.skipped++; continue; }
      const id = mailIdFor(source.messageId, source.from, source.subject);
      if (findMail(ownerId, id)) continue;
      const uploads = resolve("data/uploads", ownerId);
      const file = resolve(item.file);
      if (!inside(uploads, file) || (existsSync(file) && (!statSync(file).isFile() || !inside(uploads, realpathSync(file))))) { result.skipped++; continue; }
      const key = `${ownerId}/${id}`;
      const message = messages.get(key) ?? { ownerId, source: source as InvoiceSource, files: new Map<string, InboundFile>() };
      if (existsSync(file)) {
        const extension = extname(file).toLowerCase();
        message.files.set(file, { name: `Invoice attachment ${message.files.size + 1}${extension}`, contentType: contentTypes[extension] ?? "application/octet-stream", content: apply ? readFileSync(file) : Buffer.alloc(0) });
      } else result.missingAttachments++;
      messages.set(key, message);
    }
  }
  for (const { ownerId, source, files } of messages.values()) {
    if (apply) saveMail(ownerId, {
      from: source.from, subject: source.subject, messageId: source.messageId, date: source.receivedAt,
      recipients: [], text: "", spam: false, recovered: true, attachments: [...files.values()],
    }, "Recovered from an earlier invoice email. Its invoice was already processed; see Chat for the current decision.");
    result.recovered++;
  }
  return result;
}
