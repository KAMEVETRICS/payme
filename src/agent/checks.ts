// The hard checks, and the coded decision used when the model is unavailable.
// Pure functions: everything they need is passed in, so they are unit-tested.
import { formatUnits, isAddress, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { tokenForCurrency, tokenSymbol, type TokenSymbol } from "../arc.ts";
import type { Invoice } from "./invoice.ts";
import type { RuleState, VaultState } from "./vault.ts";
import type { Supplier, Workspace } from "./workspace.ts";

export type Check = { id: string; ok: boolean; detail: string; until?: string };

export function invoiceConcern(invoice: Invoice): Check {
  const concern = invoice.otherConcerns?.trim();
  return { id: "concerns", ok: !concern, detail: concern ? `The invoice needs a human review: ${concern}` : "No other invoice concerns were flagged." };
}

/** Checks that only mean "not yet": failing them is a reason to wait, not to ask. */
export const WAIT_CHECKS = new Set(["addressCleared"]);

/** The latest `until` among failed waiting checks (ISO time), if any. */
export function waitUntil(checks: Check[]): string | null {
  const times = checks.filter((c) => !c.ok && c.until).map((c) => c.until!);
  return times.length ? times.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b)) : null;
}

export type Action = "pay" | "hold" | "ask";

export type Decision = {
  action: Action;
  reason: string;
  holdUntil: string | null;
  by: "model" | "rules";
  model?: string;
  modelError?: string;
};

export type Facts = {
  invoice: Invoice;
  supplier: Supplier | undefined;
  matchedBy: "address" | "name" | undefined;
  amount: bigint | null;
  rule: RuleState | undefined;
  vault: VaultState;
  alreadyPaid: boolean;
  payeeActiveAt: bigint | null;
};

const PAY_WHEN_DUE_WITHIN = 3n * 86400n;

/** The on-chain invoice id: the supplier's address plus the invoice number, normalized. */
export function invoiceIdFor(payee: string, invoiceNumber: string): Hex {
  const number = invoiceNumber.trim().toUpperCase().replace(/\s+/g, "");
  return keccak256(toBytes(`${payee.toLowerCase()}:${number}`));
}

/** "1,250.00" -> 1250000000n (USDC and EURC have 6 decimals). Null if it is not a plain positive amount. */
export function parseAmount(total: string): bigint | null {
  const plain = total.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(plain)) return null;
  const amount = parseUnits(plain, 6);
  return amount > 0n ? amount : null;
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match by the address the invoice asks to be paid to first, then by name. */
export function matchSupplier(
  workspace: Workspace,
  invoice: Invoice,
): { supplier: Supplier | undefined; matchedBy: "address" | "name" | undefined } {
  const address = invoice.payToAddress?.toLowerCase();
  const byAddress = address ? workspace.suppliers.find((s) => s.address.toLowerCase() === address) : undefined;
  if (byAddress) return { supplier: byAddress, matchedBy: "address" };
  const name = normalizeName(invoice.supplierName);
  const byName =
    name.length > 2
      ? workspace.suppliers.find((s) =>
          [s.name, ...(s.aliases ?? [])].some((n) => {
            const known = normalizeName(n);
            return known.length > 2 && (name.includes(known) || known.includes(name));
          }),
        )
      : undefined;
  return { supplier: byName, matchedBy: byName ? "name" : undefined };
}

const money = (amount: bigint, symbol: TokenSymbol) => `${formatUnits(amount, 6)} ${symbol}`;

/** The token an invoice is measured in: its currency's token, else its rule's, else USDC. */
export function settlementToken(invoice: Invoice, rule: RuleState | undefined): TokenSymbol {
  return tokenForCurrency(invoice.currency) ?? (rule ? tokenSymbol(rule.token) : null) ?? "USDC";
}

export function runChecks(f: Facts): Check[] {
  const checks: Check[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const { invoice, supplier, rule, amount, vault } = f;

  add(
    "supplier",
    !!supplier,
    supplier
      ? `Matched ${supplier.name} by ${f.matchedBy}.`
      : `No supplier on file called "${invoice.supplierName}" or paid at ${invoice.payToAddress ?? "an address"}.`,
  );

  const payTo = invoice.payToAddress;
  if (!payTo || !isAddress(payTo)) {
    add("address", false, "The invoice gives no valid wallet address to pay.");
  } else if (supplier && payTo.toLowerCase() !== supplier.address.toLowerCase()) {
    add("address", false, `The invoice asks to be paid at ${payTo}, but ${supplier.name}'s approved address is ${supplier.address}.`);
  } else {
    add("address", !!supplier, supplier ? `Pays to ${supplier.name}'s approved address.` : "No approved address to compare with.");
  }

  add(
    "paymentDetails",
    !invoice.paymentDetailsChanged,
    invoice.paymentDetailsChanged ? "The invoice says the payment details have changed." : "No change of payment details.",
  );

  add(
    "noInstructions",
    !invoice.textAddressedToAutomation,
    invoice.textAddressedToAutomation
      ? `The invoice contains text aimed at an automated reader: "${invoice.textAddressedToAutomation}".`
      : "No instructions aimed at the agent.",
  );

  checks.push(invoiceConcern(invoice));

  if (!rule) {
    add("rule", false, supplier ? `Rule ${supplier.ruleId} for ${supplier.name} is not on the vault.` : "No signed rule to pay under.");
  } else if (!rule.active) {
    add("rule", false, `Rule ${rule.id} has been stopped.`);
  } else if (vault.chainTime < rule.startsAt || vault.chainTime >= rule.expiresAt) {
    add("rule", false, `Rule ${rule.id} is not in force now.`);
  } else {
    add("rule", true, `Rule ${rule.id} is in force.`);
  }

  // The invoice's currency picks the token (EUR -> EURC); the rule must pay in that token.
  // Payme never converts: a EUR invoice is paid in EURC, a USD invoice in USDC.
  const currency = invoice.currency.toUpperCase();
  const token = tokenForCurrency(currency);
  const ruleToken = rule ? tokenSymbol(rule.token) : null;
  const symbol = settlementToken(invoice, rule);
  if (!token) {
    add("currency", false, `Billed in ${currency}, which Payme cannot settle.`);
  } else if (rule && ruleToken !== token) {
    add("currency", false, `Billed in ${currency}, but rule ${rule.id} pays in ${ruleToken ?? "another token"}, not ${token}.`);
  } else {
    add("currency", true, `Billed in ${currency}, paid in ${token}.`);
  }

  add("amount", amount !== null, amount !== null ? `Amount due ${money(amount, symbol)}.` : `Cannot read the amount "${invoice.total}".`);

  if (amount !== null) {
    const funds = vault.funds[symbol];
    if (rule) {
      add("budget", amount <= rule.remaining, `${money(amount, symbol)} against ${money(rule.remaining, symbol)} left on rule ${rule.id} this period.`);
    }
    add("cap", amount <= funds.capRemaining, `${money(amount, symbol)} against ${money(funds.capRemaining, symbol)} left under the vault's ${symbol} cap.`);
    add("balance", amount <= funds.balance, `${money(amount, symbol)} against ${money(funds.balance, symbol)} in the vault.`);
  }

  add("notPaid", !f.alreadyPaid, f.alreadyPaid ? `Invoice ${invoice.invoiceNumber} has already been paid.` : "Not paid before.");

  if (f.payeeActiveAt !== null && f.payeeActiveAt > 0n) {
    const cleared = vault.chainTime >= f.payeeActiveAt;
    const clearsAt = new Date(Number(f.payeeActiveAt) * 1000).toISOString();
    checks.push({
      id: "addressCleared",
      ok: cleared,
      detail: cleared
        ? "The supplier's address has cleared the new-address delay."
        : `The supplier's address is new and can be paid from ${clearsAt}.`,
      ...(cleared ? {} : { until: clearsAt }),
    });
  }

  add("vaultLive", vault.chainTime < vault.expiresAt, vault.chainTime < vault.expiresAt ? "The vault is live." : "The vault has expired.");
  return checks;
}

const dueAt = (dueDate: string | null) => (dueDate ? BigInt(Math.floor(Date.parse(`${dueDate}T00:00:00Z`) / 1000)) : null);

/** The due date, if the invoice is not due within the pay-now window yet; otherwise null. */
function dueLater(invoice: Invoice, chainTime: bigint): string | null {
  const due = dueAt(invoice.dueDate);
  return due !== null && due > chainTime + PAY_WHEN_DUE_WITHIN ? invoice.dueDate : null;
}

/** The later of two hold ends (a due date or a time). */
const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : holdEndsAt(a) >= holdEndsAt(b) ? a : b);

/** From when (ms) an invoice counts as due soon enough to pay: three days before its due date. */
export function payableFromMs(dueDate: string | null): number {
  const due = dueAt(dueDate);
  return due === null ? 0 : Number(due - PAY_WHEN_DUE_WITHIN) * 1000;
}

/**
 * The coded decision: ask on any failed check that is not just a wait; hold until a
 * waiting check clears; otherwise pay if due soon, else hold until due.
 */
export function rulesDecision(checks: Check[], invoice: Invoice, chainTime: bigint): Decision {
  const failed = checks.filter((c) => !c.ok);
  const blocking = failed.filter((c) => !WAIT_CHECKS.has(c.id));
  if (blocking.length) {
    const more = blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : "";
    return { action: "ask", reason: `Asking the owner: ${blocking[0].detail}${more}`, holdUntil: null, by: "rules" };
  }
  const until = waitUntil(failed);
  if (until) {
    // Wait for the address, and do not pay before the invoice is due either.
    return {
      action: "hold",
      reason: `Holding ${invoice.supplierName}'s invoice ${invoice.invoiceNumber} until the supplier's new address clears and it is due; every other check passes.`,
      holdUntil: laterOf(until, dueLater(invoice, chainTime)),
      by: "rules",
    };
  }
  const due = dueAt(invoice.dueDate);
  if (due !== null && due > chainTime + PAY_WHEN_DUE_WITHIN) {
    return {
      action: "hold",
      reason: `Holding ${invoice.supplierName}'s invoice ${invoice.invoiceNumber} until it is due on ${invoice.dueDate}; every check passes.`,
      holdUntil: invoice.dueDate,
      by: "rules",
    };
  }
  return {
    action: "pay",
    reason: `Paying ${invoice.supplierName}'s invoice ${invoice.invoiceNumber}: every check passes and it is due${invoice.dueDate ? ` on ${invoice.dueDate}` : ""}.`,
    holdUntil: null,
    by: "rules",
  };
}

/**
 * The model may be stricter than the checks, never looser: a failed check means ask,
 * unless it only means "not yet", in which case it can hold but not pay. With the
 * invoice and chain time, a wait also lasts until the invoice is due.
 */
export function enforceChecks(decision: Decision, checks: Check[], invoice?: Invoice, chainTime?: bigint): Decision {
  if (decision.action === "ask") return decision;
  const failed = checks.filter((c) => !c.ok);
  const blocking = failed.filter((c) => !WAIT_CHECKS.has(c.id));
  if (blocking.length) {
    return {
      ...decision,
      action: "ask",
      holdUntil: null,
      reason: `Asking the owner: ${blocking[0].detail} (the model suggested "${decision.action}")`,
    };
  }
  const wait = waitUntil(failed);
  if (!wait) return decision;
  const until = invoice && chainTime !== undefined ? laterOf(wait, dueLater(invoice, chainTime))! : wait;
  if (decision.action === "pay") {
    return { ...decision, action: "hold", holdUntil: until, reason: `${decision.reason} Holding it until the supplier's new address clears.` };
  }
  // A hold must last at least until the wait is over.
  return { ...decision, holdUntil: laterOf(decision.holdUntil, until) };
}

/** When a hold is over: a due date means the start of that day (UTC); a time means that time. */
export function holdEndsAt(holdUntil: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(holdUntil) ? `${holdUntil}T00:00:00Z` : holdUntil);
}

export const ruleFor = (vault: VaultState, supplier: Supplier | undefined): RuleState | undefined =>
  supplier ? vault.rules.get(supplier.ruleId) : undefined;

export const payeeFor = (supplier: Supplier | undefined, invoice: Invoice): Address | undefined =>
  (supplier?.address ?? (invoice.payToAddress && isAddress(invoice.payToAddress) ? invoice.payToAddress : undefined)) as
    | Address
    | undefined;
