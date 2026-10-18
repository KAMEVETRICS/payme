// Runs the scheduler: every business in data/businesses, plus any --workspace files.
// Usage: npm run scheduler -- [--once] [--every 60] [--workspace <workspace JSON>]
// In production this runs as a cron job; locally, leave it running beside the app.
import { loadWorkspace, type Workspace } from "../src/agent/workspace.ts";
import { processInbox } from "../src/web/inbox.ts";
import { watchAgentGas } from "../src/web/ops.ts";
import { runDueWork } from "../src/web/scheduler.ts";
import { listBusinesses, needsNewVault } from "../src/web/store.ts";

const args = process.argv.slice(2);
const once = args.includes("--once");
const everyIndex = args.indexOf("--every");
const everySeconds = everyIndex >= 0 ? Number(args[everyIndex + 1]) : 60;
const extra = args.flatMap((a, i) => (args[i - 1] === "--workspace" ? [a] : []));

async function tick() {
  // Businesses still on a v2 vault wait until their owner moves them to a new one.
  const workspaces: Workspace[] = [...listBusinesses().filter((b) => !needsNewVault(b)), ...extra.map(loadWorkspace)];
  const started = new Date().toISOString();
  try {
    // Invoices that arrived by email and were not processed yet, then everything waiting to be paid.
    for (const o of await processInbox()) console.log(`${started} ${o.business} · email from ${o.from} · ${o.outcome}`);
    for (const note of await watchAgentGas()) console.error(`${started} ${note}`);
    const outcomes = await runDueWork(workspaces);
    if (outcomes.length === 0) console.log(`${started} checked ${workspaces.length} business(es): nothing due`);
    for (const o of outcomes) console.log(`${started} ${o.business} · ${o.invoice} · ${o.outcome}`);
  } catch (err) {
    console.error(`${started} the run failed; it will try again next time:`, err instanceof Error ? err.message : err);
  }
}

await tick();
if (!once) {
  console.log(`Checking every ${everySeconds}s. Press Ctrl+C to stop.`);
  setInterval(tick, everySeconds * 1000);
}
