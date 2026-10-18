// Upload an invoice; the agent reads it, decides, and pays if the rules allow.
import { mkdirSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { processInvoice } from "../../../src/agent/process.ts";
import { HttpError, limit, requireBusiness, route } from "../../../src/web/http.ts";

const ALLOWED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt"]);
const MAX_BYTES = 10 * 1024 * 1024;

export const POST = route(async (req) => {
  // Check the size before reading the body into memory.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) throw new HttpError(413, "That file is over 10 MB.");
  const { session, business } = await requireBusiness();
  // Each upload is a paid model call; cap them per business.
  limit(`upload:${session.uid}`, 60, 60 * 60 * 1000, "uploads");
  const form = await req.formData();
  const file = form.get("invoice");
  if (!(file instanceof File)) throw new HttpError(400, "Choose an invoice file.");
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) throw new HttpError(400, "Upload a PDF, an image, or a text file.");
  if (file.size > MAX_BYTES) throw new HttpError(400, "That file is over 10 MB.");

  const dir = `data/uploads/${session.uid}`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/${Date.now()}${ext}`;
  writeFileSync(path, Buffer.from(await file.arrayBuffer()));

  const receipt = await processInvoice(path, business);
  return { decision: receipt.decision, payment: receipt.payment };
});
