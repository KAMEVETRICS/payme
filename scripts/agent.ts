// The deciding agent on one invoice from the command line.
// Usage: npm run agent -- <invoice file> --workspace <workspace or business JSON> [--dry-run]
import { explorer } from "../src/arc.ts";
import { DECISIONS_LOG, processInvoice } from "../src/agent/process.ts";
import { loadWorkspace } from "../src/agent/workspace.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--workspace");
if (!file || !args.includes("--workspace")) {
  console.error("Usage: npm run agent -- <invoice file> --workspace <workspace or business JSON> [--dry-run]");
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const workspace = loadWorkspace(option("--workspace", ""));

const { invoice, checks, decision, payment } = await processInvoice(file, workspace, { dryRun });

console.log(`\n${invoice.supplierName} · invoice ${invoice.invoiceNumber} · ${invoice.total} ${invoice.currency}${invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}`);
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.id}: ${c.detail}`);
const label = decision.action.toUpperCase() + (decision.holdUntil ? ` until ${decision.holdUntil}` : "");
console.log(`\n${label} (${decision.by === "model" ? decision.model : "coded rules"}): ${decision.reason}`);
if (decision.modelError) console.log(`  The model was unavailable, so the coded rules decided: ${decision.modelError}`);
if (dryRun && decision.action === "pay") console.log("  Dry run: not paid.");
if (payment?.status === "paid") console.log(`  Paid: ${explorer}/tx/${payment.txHash}`);
if (payment?.status === "refused") console.log(`  The contract refused it: ${payment.reason}`);
if (payment?.status === "failed") console.log(`  Circle could not send it: ${payment.circleState} ${payment.error}`);
console.log(`  Receipt appended to ${DECISIONS_LOG}`);
