import { formatUnits } from "viem";
import { tokenSymbol } from "../../../src/arc.ts";
import { readVaultState } from "../../../src/agent/vault.ts";
import { businessHistory } from "../../../src/web/business-history.ts";
import { answerChat, validateMessage } from "../../../src/web/chat.ts";
import { readChat, saveExchange } from "../../../src/web/chat-store.ts";
import { invoiceContext, liveVaultContext } from "../../../src/web/chat-context.ts";
import { HttpError, limit, requireBusiness, route } from "../../../src/web/http.ts";
import { mailFor } from "../../../src/web/mail.ts";
import { buildOverview } from "../../../src/web/overview.ts";
import { needsNewVault } from "../../../src/web/store.ts";

const busy = new Set<string>();
export const POST = route(async (req) => {
  const { session, business } = await requireBusiness();
  const input = await req.json().catch(() => { throw new HttpError(400, "Send a valid chat message."); }) as { message?: unknown; id?: unknown } | null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Send a valid chat message.");
  let message: string;
  try { message = validateMessage(input.message); } catch (error) { throw new HttpError(400, (error as Error).message); }
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(input.id)) throw new HttpError(400, "Missing message ID. Try sending again.");
  const history = readChat(session.uid);
  const previous = history.find((e) => e.id === input.id);
  if (previous) return previous;
  limit(`chat:${session.uid}`, 20, 10 * 60 * 1000, "messages");
  if (busy.has(session.uid)) throw new HttpError(409, "Payme is still answering your previous message.");
  busy.add(session.uid);
  try {
    const { decisions, answers } = businessHistory(business);
    const overview = buildOverview(decisions, answers);
    const vault = needsNewVault(business) ? null : await readVaultState(business.vault).catch(() => null);
    const context = {
      business: business.business, capturedAt: new Date().toISOString(), network: "Arc testnet",
      vaultUpgradeRequired: needsNewVault(business), vault: liveVaultContext(vault),
      suppliers: business.suppliers.map((s) => {
        const rule = vault?.rules.get(s.ruleId);
        return { name: s.name, terms: s.terms.slice(0, 1200), rule: rule ? { active: rule.active, token: tokenSymbol(rule.token), budget: formatUnits(rule.budget, 6), remaining: formatUnits(rule.remaining, 6), periodSeconds: rule.period.toString(), startsAt: new Date(Number(rule.startsAt) * 1000).toISOString(), expiresAt: new Date(Number(rule.expiresAt) * 1000).toISOString(), inForce: rule.active && vault!.chainTime >= rule.startsAt && vault!.chainTime < rule.expiresAt } : null };
      }),
      invoiceCounts: overview.counts,
      recentInvoices: overview.payments.slice(0, 20).map((r) => ({ supplier: r.supplier, invoice: r.invoice, amount: r.amount, currency: r.currency, status: r.status, dueDate: r.due })),
      invoiceReasons: invoiceContext(decisions, answers),
      recentEmails: mailFor(session.uid).slice(0, 6).map((m) => ({ subject: m.subject, from: m.from, text: m.text.slice(0, 1000), spam: m.spam, processingNote: m.outcome })),
    };
    let reply: string;
    try { reply = await answerChat(message, context, history); }
    catch { throw new HttpError(503, "Payme couldn't answer just now. Try again in a moment. No payment or rule was changed."); }
    return saveExchange(session.uid, { id: input.id, at: new Date().toISOString(), message, reply });
  } finally { busy.delete(session.uid); }
});
