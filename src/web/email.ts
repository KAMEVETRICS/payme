// Invoice email addresses, and which parts of an incoming email are invoices.
// Pure, so it is unit-tested.

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");

/**
 * A business's invoice address. On our own inbound domain the local part is the
 * business name and its key ("acme-imports-k3x9q2m7p1z4@invoices.example.com");
 * on a provider's shared address the key rides after a "+".
 */
export function invoiceAddress(key: string, businessName: string, env: { domain?: string; address?: string }): string | null {
  if (env.domain) return `${slug(businessName) || "invoices"}-${key}@${env.domain}`;
  if (env.address) {
    const [local, domain] = env.address.split("@");
    return `${local}+${key}@${domain}`;
  }
  return null;
}

/**
 * The inbox key in an address we receive mail at: the last "-" segment of the local
 * part on our own inbound domain, or the part after "+" on a shared address.
 */
export function inboxKeyFrom(address: string, inboundDomain?: string): string | null {
  const [local = "", domain = ""] = address.trim().toLowerCase().split("@");
  if (inboundDomain && domain === inboundDomain.toLowerCase()) return local.split("-").at(-1) || null;
  return local.includes("+") ? local.split("+").at(-1) || null : null;
}

export type InboundFile = { name: string; contentType: string; content: Buffer };

export const INVOICE_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "text/plain": ".txt",
};

const SMALL_IMAGE = 30 * 1024; // logos and signature images, not scans
const LOOKS_LIKE_INVOICE = /\b(invoice|bill|amount due|total due|payment due|remittance)\b/i;

/**
 * An email's PDFs if it has any; otherwise images big enough to be scans, and text
 * files; otherwise the body itself, if it reads like an invoice.
 */
export function invoiceFiles(attachments: InboundFile[], subject: string, textBody: string): InboundFile[] {
  const type = (a: InboundFile) => a.contentType.toLowerCase();
  const known = attachments.filter((a) => INVOICE_TYPES[type(a)]);
  const pdfs = known.filter((a) => type(a) === "application/pdf");
  if (pdfs.length) return pdfs;
  const others = known.filter((a) => !type(a).startsWith("image/") || a.content.length >= SMALL_IMAGE);
  if (others.length) return others;
  if (textBody.trim() && LOOKS_LIKE_INVOICE.test(`${subject}\n${textBody}`)) {
    return [{ name: "email.txt", contentType: "text/plain", content: Buffer.from(`Subject: ${subject}\n\n${textBody}`) }];
  }
  return [];
}
