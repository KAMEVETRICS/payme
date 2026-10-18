// One invoice through the agent: read it, match the supplier and its signed rule,
// run the hard checks, decide pay / hold / ask, pay if the decision is pay, and
// append a receipt. Used by the CLI and the web app.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { formatUnits, type Address, type Hex } from "viem";
import type { TokenSymbol } from "../arc.ts";
import { invoiceIdFor, matchSupplier, parseAmount, payeeFor, ruleFor, runChecks, settlementToken, type Check, type Decision } from "./checks.ts";
import { decide } from "./decide.ts";
import { readInvoice, type Invoice } from "./invoice.ts";
import { payInvoice, type Payment } from "./pay.ts";
import { isInvoicePaid, payeeActiveAt, readVaultState, type VaultState } from "./vault.ts";
import type { Workspace } from "./workspace.ts";

export const DECISIONS_LOG = "receipts/decisions.jsonl";

/** Where an invoice came from. Uploads and the CLI leave it out. */
export type InvoiceSource = { kind: "email"; from: string; subject: string; messageId: string; receivedAt: string };

export type Receipt = {
  id?: string; // absent on receipts written before ids existed; see receiptIdOf
  at: string;
  business: string;
  vault: Address;
  file: string;
  source?: InvoiceSource;
  readBy: string;
  invoice: Invoice;
  invoiceId: Hex | null;
  supplier: string | null;
  matchedBy: string | null;
  ruleId: number | null;
  // Amounts are in `token` (receipts from before EURC have no token: USDC).
  seen: { chainTime: string; token?: TokenSymbol; vaultBalanceUsdc: string; capRemainingUsdc: string; ruleRemainingUsdc: string | null };
  checks: Check[];
  decision: Decision;
  dryRun: boolean;
  payment: Payment | null;
};

/** Match an invoice to its supplier and rule, and run the hard checks against the vault as it is now. */
export async function checkInvoice(invoice: Invoice, workspace: Workspace, vault: VaultState) {
  const { supplier, matchedBy } = matchSupplier(workspace, invoice);
  const rule = ruleFor(vault, supplier);
  const amount = parseAmount(invoice.total);
  const payee = payeeFor(supplier, invoice);
  const invoiceId = payee ? invoiceIdFor(payee, invoice.invoiceNumber) : null;
  const checks = runChecks({
    invoice,
    supplier,
    matchedBy,
    amount,
    rule,
    vault,
    alreadyPaid: invoiceId ? await isInvoicePaid(workspace.vault, invoiceId) : false,
    payeeActiveAt: supplier ? await payeeActiveAt(workspace.vault, supplier.address) : null,
  });
  return { supplier, matchedBy, rule, amount, invoiceId, checks };
}

export async function processInvoice(
  file: string,
  workspace: Workspace,
  { dryRun = false, source }: { dryRun?: boolean; source?: InvoiceSource } = {},
): Promise<Receipt> {
  const { invoice, model: readBy } = await readInvoice(file);
  const vault = await readVaultState(workspace.vault);
  const { supplier, matchedBy, rule, amount, invoiceId, checks } = await checkInvoice(invoice, workspace, vault);

  const decision = await decide({ invoice, checks, supplier, rule, vault });

  let payment: Payment | null = null;
  if (decision.action === "pay" && !dryRun && rule && amount !== null && invoiceId && invoice.payToAddress) {
    payment = await payInvoice({
      vault: workspace.vault,
      ruleId: rule.id,
      invoiceId,
      payee: invoice.payToAddress as Address,
      amount,
    });
  }

  const token = settlementToken(invoice, rule);
  const receipt: Receipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    business: workspace.business,
    vault: workspace.vault,
    file,
    ...(source ? { source } : {}),
    readBy,
    invoice,
    invoiceId,
    supplier: supplier?.name ?? null,
    matchedBy: matchedBy ?? null,
    ruleId: rule?.id ?? null,
    seen: {
      chainTime: new Date(Number(vault.chainTime) * 1000).toISOString(),
      token,
      vaultBalanceUsdc: formatUnits(vault.funds[token].balance, 6),
      capRemainingUsdc: formatUnits(vault.funds[token].capRemaining, 6),
      ruleRemainingUsdc: rule ? formatUnits(rule.remaining, 6) : null,
    },
    checks,
    decision,
    dryRun,
    payment,
  };
  mkdirSync("receipts", { recursive: true });
  appendFileSync(DECISIONS_LOG, JSON.stringify(receipt, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
  return receipt;
}
