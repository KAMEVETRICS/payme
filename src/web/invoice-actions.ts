import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";

export class InvoiceBusyError extends Error {
  constructor() { super("Another action is already processing this invoice. Please wait and refresh."); }
}
export class InvoiceStateError extends Error {}

export function requireOpenInvoice(state: string) {
  if (state !== "open") throw new InvoiceStateError("This invoice is no longer waiting for your answer. Refresh to see its current status.");
}

/** A filesystem claim also excludes actions in separately bundled route handlers. */
export async function withInvoiceAction<T>(vault: string, receiptId: string, action: () => Promise<T>, root = "data/invoice-locks"): Promise<T> {
  mkdirSync(root, { recursive: true });
  const path = `${root}/${createHash("sha256").update(`${vault.toLowerCase()}:${receiptId}`).digest("hex")}.lock`;
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new InvoiceBusyError(); throw error; }
  try { return await action(); }
  finally { closeSync(descriptor); unlinkSync(path); }
}
