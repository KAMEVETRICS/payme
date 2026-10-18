import { test } from "node:test";
import assert from "node:assert/strict";
import type { Receipt } from "../../src/agent/process.ts";
import type { Resolution } from "../../src/web/resolutions.ts";
import { buildOverview } from "../../src/web/overview.ts";
import { invoiceContext, liveVaultContext } from "../../src/web/chat-context.ts";
import { itemState } from "../../src/web/resolutions.ts";

const vault = "0x1111111111111111111111111111111111111111" as const;
const paid = { status: "paid", txHash: "0xabc", circleTxId: "tx" } as const;
function invoice(id: string, currency = "USD", total = "12.50"): Receipt {
  return {
    id, at: "2026-09-02T10:00:00Z", business: "Test", vault, file: "invoice.pdf", readBy: "test",
    invoice: { supplierName: "Supplier", payToAddress: vault, invoiceNumber: id, issueDate: null, dueDate: null, currency, total, lineItems: [], paymentDetailsChanged: false, textAddressedToAutomation: null, otherConcerns: null },
    invoiceId: "0x123", supplier: "Supplier", matchedBy: "address", ruleId: 1,
    seen: { chainTime: "2026-09-02T10:00:00Z", vaultBalanceUsdc: "100", capRemainingUsdc: "100", ruleRemainingUsdc: "100" }, checks: [],
    decision: { action: "pay", reason: "Due", holdUntil: null, by: "rules" }, dryRun: false, payment: paid,
  };
}

test("overview counts only confirmed transactions and keeps the currencies separate", () => {
  const usd = invoice("usd");
  const eur = { ...invoice("eur", "EUR", "7.01"), payment: { ...paid, txHash: "0xdef" as const } };
  const unsent = { ...invoice("unsent"), payment: null };
  const result = buildOverview([usd, eur, unsent], new Map(), new Date("2026-10-17T12:00:00Z"));
  assert.equal(result.totals.USDC, "12.5");
  assert.equal(result.totals.EURC, "7.01");
  assert.equal(result.counts.paid, 2);
  assert.equal(result.counts.unpaid, 1);
});

test("scheduled payments are charted at settlement time and repeated hashes count once", () => {
  const held = invoice("held", "USD", "0.000001");
  held.decision = { action: "hold", holdUntil: "2026-10-01", reason: "Wait", by: "rules" };
  held.payment = null;
  const history = new Map<string, Resolution[]>([["held", [{ receiptId: "held", vault, at: "2026-10-03T10:00:00Z", by: "Payer", kind: "scheduled", ruleId: 1, payment: paid }]]]);
  const duplicate = { ...invoice("duplicate", "USD", "0.000001"), at: "2026-10-03T10:00:00Z" };
  const result = buildOverview([held, duplicate], history, new Date("2026-10-17T12:00:00Z"));
  assert.equal(result.totals.USDC, "0.000001");
  assert.equal(result.monthly.USDC.at(-1)?.amount, "0.000001");
  assert.equal(result.monthly.USDC.at(-2)?.amount, "0");
  assert.equal(result.counts.paid, 1);
});

test("an escalated hold appears as needing review, rather than still being scheduled", () => {
  const held = invoice("review");
  held.decision = { action: "hold", holdUntil: "2026-10-01", reason: "Wait", by: "rules" };
  held.payment = null;
  const history = new Map<string, Resolution[]>([["review", [{ receiptId: "review", vault, at: "2026-10-02T00:00:00Z", by: "Payer", kind: "escalated", reason: "Low funds", checks: [] }]]]);
  const result = buildOverview([held], history, new Date("2026-10-17T12:00:00Z"));
  assert.equal(result.counts.review, 1);
  assert.equal(result.counts.held, 0);
  const current = invoiceContext([held], history)[0];
  assert.equal(current.currentReason, "Low funds");
  assert.deepEqual(current.failedChecks, []);
  assert.equal(current.holdUntil, null);
});

test("chat identifies expired vaults even when balance and spending room remain", () => {
  const context = liveVaultContext({ chainTime: 200n, expiresAt: 100n, rules: new Map(), funds: { USDC: { token: vault, balance: 1000000n, capRemaining: 5000000n }, EURC: { token: vault, balance: 0n, capRemaining: 5000000n } } });
  assert.equal(context.isLive, false);
  assert.equal(context.funds?.USDC.balance, "1");
  assert.equal(liveVaultContext(null).liveBalancesAvailable, false);
});

test("historical automatic payments with flagged concerns return to review before any retry", () => {
  const old = invoice("old-concern");
  old.invoice.otherConcerns = "Items differ from the agreed order.";
  old.payment = { status: "failed", circleTxId: "", circleState: "ERROR", error: "Unavailable" };
  const current = itemState(old);
  assert.equal(current.state, "open");
  if (current.state === "open") assert.ok(current.checks.some((check) => check.id === "concerns" && !check.ok));
  const approved: Resolution = { kind: "approved", receiptId: "old-concern", vault, at: "2026-10-17T10:00:00Z", by: "owner", ruleId: 2, payment: old.payment };
  assert.equal(itemState(old, [approved]).state, "unpaid");
  assert.equal(itemState({ ...old, payment: paid }).state, "done");
});
