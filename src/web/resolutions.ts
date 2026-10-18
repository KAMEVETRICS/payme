// What happened after each decision: the owner's answers to "ask", and the scheduler's
// work on held and approved invoices. Append-only, next to the decisions. Both logs move
// to Postgres before real customers.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { Address } from "viem";
import { invoiceConcern, type Check } from "../agent/checks.ts";
import type { Payment } from "../agent/pay.ts";
import type { Receipt } from "../agent/process.ts";

export const RESOLUTIONS_LOG = "receipts/resolutions.jsonl";
export const SCHEDULER = "Payer";

type Base = { receiptId: string; vault: Address; at: string; by: string };

export type Resolution =
  | (Base & { kind: "rejected" })
  | (Base & { kind: "approved"; ruleId: number; payment: Payment })
  | (Base & { kind: "retried"; ruleId: number; payment: Payment })
  // The scheduler paid (or tried to pay) a held or approved invoice.
  | (Base & { kind: "scheduled"; ruleId: number; payment: Payment })
  // A held invoice no longer passed its checks when it came due, so it needs the owner.
  | (Base & { kind: "escalated"; reason: string; checks: Check[] });

export function addResolution(r: Resolution) {
  mkdirSync("receipts", { recursive: true });
  appendFileSync(RESOLUTIONS_LOG, JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
}

/** Every follow-up for a vault, grouped by the decision it follows, oldest first. */
export function resolutionsFor(vault: Address): Map<string, Resolution[]> {
  const byReceipt = new Map<string, Resolution[]>();
  if (!existsSync(RESOLUTIONS_LOG)) return byReceipt;
  for (const line of readFileSync(RESOLUTIONS_LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Resolution;
      if (r.vault.toLowerCase() !== vault.toLowerCase()) continue;
      byReceipt.set(r.receiptId, [...(byReceipt.get(r.receiptId) ?? []), r]);
    } catch {
      // Skip a partly written line.
    }
  }
  return byReceipt;
}

type Paid = Extract<Payment, { status: "paid" }>;

/** Where an invoice stands now. */
export type ItemState =
  | { state: "done" } // the agent paid it when it decided
  | { state: "held"; until: string } // the scheduler pays it when the hold ends
  | { state: "open"; checks: Check[]; escalated?: string } // waiting for the owner
  | { state: "rejected" }
  | { state: "paid"; payment: Paid; by: string; approvedByOwner: boolean }
  | { state: "unpaid"; ruleId: number; payment: Payment; approvedByOwner: boolean }; // payment not out yet; retried

export function itemState(receipt: Receipt, history: Resolution[] = []): ItemState {
  let state: ItemState;
  const { action, holdUntil } = receipt.decision;
  if (action === "pay") {
    state =
      receipt.payment?.status === "paid" || !receipt.payment || receipt.ruleId === null
        ? { state: "done" }
        : { state: "unpaid", ruleId: receipt.ruleId, payment: receipt.payment, approvedByOwner: false };
  } else if (action === "hold") {
    state = { state: "held", until: holdUntil ?? receipt.invoice.dueDate ?? receipt.at };
  } else {
    state = { state: "open", checks: receipt.checks };
  }

  let approvedByOwner = false;
  for (const e of history) {
    if (e.kind === "rejected") state = { state: "rejected" };
    else if (e.kind === "escalated") state = { state: "open", checks: e.checks, escalated: e.reason };
    else {
      if (e.kind === "approved") approvedByOwner = true;
      state =
        e.payment.status === "paid"
          ? { state: "paid", payment: e.payment, by: e.by, approvedByOwner }
          : { state: "unpaid", ruleId: e.ruleId, payment: e.payment, approvedByOwner };
    }
  }
  const concern = invoiceConcern(receipt.invoice);
  if (state.state === "unpaid" && !state.approvedByOwner && !concern.ok) {
    return { state: "open", checks: [...receipt.checks.filter((check) => check.id !== "concerns"), concern], escalated: concern.detail };
  }
  return state;
}
