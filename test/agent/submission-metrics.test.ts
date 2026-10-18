import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDevelopment, type MetricReceipt, type ConfirmedPayment } from "../../src/submission/metrics.ts";
import { receiptIdOf } from "../../src/web/activity.ts";
import type { Receipt } from "../../src/agent/process.ts";

const vault = "0x1111111111111111111111111111111111111111";
const usd = "0x3600000000000000000000000000000000000000";
const eur = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const receipt = (id: string, hash: string | null, dryRun = false): MetricReceipt => ({ id, vault, invoiceId: id, dryRun, source: { kind: "email" }, payment: hash ? { status: "paid", txHash: hash } : null });
const event = (id: string, hash: string, token = usd, amount = "12500000"): ConfirmedPayment => ({ vault, invoiceId: id, txHash: hash, token, amount });

test("submission metrics count only matched on-chain events, excluding dry runs and repeated records", () => {
  const result = summarizeDevelopment([receipt("a", "0xABC"), receipt("a", "0xabc"), receipt("dry", "0xdry", true), receipt("missing", "0xmissing")], [], [event("a", "0xabc"), event("dry", "0xdry"), event("wrong-invoice", "0xmissing")]);
  assert.equal(result.decisionRecords, 3);
  assert.equal(result.confirmedPaymentTransactions, 1);
  assert.equal(result.confirmedInvoices, 1);
  assert.deepEqual(result.testnetPaymentVolume, { USDC: "12.5", EURC: "0" });
  assert.equal(result.unverifiedClaimedTransactions, 1);
  assert.equal(JSON.stringify(result).includes(vault), false);
});

test("submission metrics include follow-up payments, separate tokens, and reject unrelated follow-ups", () => {
  const results = summarizeDevelopment([receipt("a", null), receipt("b", "0xb")], [
    { receiptId: "a", vault, payment: { status: "paid", txHash: "0xa" } },
    { receiptId: "a", vault: "other-vault", payment: { status: "paid", txHash: "0xother" } },
    { receiptId: "unknown", vault, payment: { status: "paid", txHash: "0xunknown" } },
  ], [event("a", "0xa", usd, "1"), event("b", "0xb", eur, "7010000"), event("a", "0xother")]);
  assert.equal(results.confirmedPaymentTransactions, 2);
  assert.deepEqual(results.testnetPaymentVolume, { USDC: "0.000001", EURC: "7.01" });
  assert.equal(results.unverifiedClaimedTransactions, 0);
});

test("submission metrics never turn a recorded payment into confirmed volume without chain evidence", () => {
  const result = summarizeDevelopment([receipt("a", "0xa")], [], []);
  assert.equal(result.confirmedPaymentTransactions, 0);
  assert.equal(result.unverifiedClaimedTransactions, 1);
  assert.deepEqual(result.testnetPaymentVolume, { USDC: "0", EURC: "0" });
  assert.equal(result.network, "Arc testnet");
});

test("submission metrics match follow-up payments for legacy receipts using their established derived ID", () => {
  const legacy = { ...receipt("legacy", null), id: undefined, at: "2026-10-01T10:00:00Z", file: "fixtures/invoice.txt" };
  const derived = receiptIdOf(legacy as unknown as Receipt);
  const result = summarizeDevelopment([legacy], [{ receiptId: derived, vault, payment: { status: "paid", txHash: "0xlegacy" } }], [event("legacy", "0xlegacy")]);
  assert.equal(result.confirmedPaymentTransactions, 1);
  assert.equal(result.testnetPaymentVolume.USDC, "12.5");
});
