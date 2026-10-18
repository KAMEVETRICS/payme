import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withInvoiceAction, InvoiceBusyError, requireOpenInvoice } from "../../src/web/invoice-actions.ts";

test("a delayed approval is refused after an owner rejection, before its chain callback", async () => {
  let calls = 0;
  assert.throws(() => { requireOpenInvoice("rejected"); calls++; }, /no longer waiting/);
  assert.equal(calls, 0);
  assert.doesNotThrow(() => requireOpenInvoice("open"));
  for (const state of ["done", "held", "paid", "unpaid"]) assert.throws(() => requireOpenInvoice(state));
});

test("concurrent approval/rejection for one invoice is excluded, then the lock is released", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "payme-action-test-"));
  t.after(() => { if (!resolve(root).startsWith(resolve(tmpdir()) + "/payme-action-test-") && !resolve(root).startsWith(resolve(tmpdir()) + "\\payme-action-test-")) throw new Error("Unsafe test cleanup"); rmSync(root, { recursive: true, force: true }); });
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const first = withInvoiceAction("vault", "invoice", () => waiting, root);
  await assert.rejects(withInvoiceAction("vault", "invoice", async () => "rejected", root), InvoiceBusyError);
  assert.equal(await withInvoiceAction("vault", "other", async () => "independent", root), "independent");
  finish(); await first;
  await assert.rejects(withInvoiceAction("vault", "invoice", async () => { throw new Error("chain failed"); }, root), /chain failed/);
  assert.equal(await withInvoiceAction("vault", "invoice", async () => "released", root), "released");
});
