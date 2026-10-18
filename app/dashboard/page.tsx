import Link from "next/link";
import { redirect } from "next/navigation";
import { erc20Abi, formatUnits } from "viem";
import { TOKENS, TOKEN_SYMBOLS, explorer, publicClient, tokenSymbol } from "../../src/arc.ts";
import { readVaultState } from "../../src/agent/vault.ts";
import { businessHistory } from "../../src/web/business-history.ts";
import { ensureInboxKey, inboxAddressFor } from "../../src/web/inbox.ts";
import { buildOverview } from "../../src/web/overview.ts";
import { getSession } from "../../src/web/session.ts";
import { getBusiness, needsNewVault } from "../../src/web/store.ts";
import { Icon } from "../ui";
import { AddSupplier } from "./add-supplier";
import { Funds } from "./funds";
import { ExportPayments, PaymentHistory, PaymentStatus, SpendingChart } from "./overview";
import { Upgrade } from "./upgrade";
import { Upload } from "./upload";

const money = (value: bigint) => Number(formatUnits(value, 6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const periods: Record<string, string> = { "0": "in total", "604800": "per week", "2592000": "per month" };
export default async function Dashboard() {
  const session = await getSession(); if (!session) redirect("/login");
  const found = getBusiness(session.uid); if (!found) redirect("/onboarding");
  const business = ensureInboxKey(found);
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
  if (needsNewVault(business)) return <><div className="page-heading"><div><h1>Dashboard</h1><p>Move to your new multi-currency vault to continue.</p></div></div><Upgrade appId={appId} suppliers={business.suppliers.map((s) => s.name)} /></>;
  const [vault, wallet] = await Promise.all([readVaultState(business.vault), Promise.all(TOKEN_SYMBOLS.map((s) => publicClient.readContract({ address: TOKENS[s].address, abi: erc20Abi, functionName: "balanceOf", args: [business.ownerAddress] })))]);
  const { decisions, answers } = businessHistory(business);
  const overview = buildOverview(decisions, answers);
  const inbox = inboxAddressFor(business);
  const empty = TOKEN_SYMBOLS.every((s) => vault.funds[s].balance === 0n);
  return <>
    <div className="page-heading"><div><p className="eyebrow">Your business, in view</p><h1>Dashboard</h1><p>Payments on track. Every decision accounted for.</p></div><ExportPayments payments={overview.payments} /></div>
    {overview.counts.review > 0 && <Link href="/dashboard/chat#invoice-decisions" className="attention-banner"><span><strong>{overview.counts.review} {overview.counts.review === 1 ? "invoice needs" : "invoices need"} your review.</strong> Payme is waiting for your answer.</span><span>Open Chat <Icon name="arrow" size={17} /></span></Link>}
    <div className="dashboard-columns">
      <div className="dashboard-primary"><SpendingChart overview={overview} /><PaymentHistory payments={overview.payments} /><section className="panel upload-panel"><div><span className="section-icon"><Icon name="upload" /></span><h2>Add an invoice</h2><p className="muted">Payme will read it and check it against your rules.</p></div><Upload /></section></div>
      <aside className="dashboard-secondary"><section className="panel vault-panel"><div className="panel-heading"><h2>Your business vault</h2><Icon name="wallet" /></div><div className="vault-card"><div className="vault-card-top"><span className="vault-symbol">p.</span><span>ARC TESTNET</span></div><p>Available balance</p>{TOKEN_SYMBOLS.map((s) => <div className="vault-amount" key={s}>{money(vault.funds[s].balance)}<span>{s}</span></div>)}<div className="vault-card-bottom"><span>{business.business}</span><a href={`${explorer}/address/${business.vault}`} target="_blank" rel="noreferrer">{short(business.vault)} ↗</a></div></div><div className="cap-grid">{TOKEN_SYMBOLS.map((s) => <div key={s}><span>Spending room · {s}</span><strong>{money(vault.funds[s].capRemaining)}</strong><small>Under your vault cap</small></div>)}</div>{empty && <div className="funding-note"><Icon name="plus" size={17} /><span><strong>Fund your vault to get started.</strong> Add USDC for dollar invoices or EURC for euro invoices.</span></div>}<details className="funds-disclosure" open={empty}><summary>Manage funds <Icon name="chevron" size={16} /></summary><Funds appId={appId} walletAddress={business.ownerAddress} walletBalances={Object.fromEntries(TOKEN_SYMBOLS.map((s, i) => [s, money(wallet[i])]))} /></details></section><PaymentStatus counts={overview.counts} /><section className="panel inbox-address-panel"><span className="section-icon"><Icon name="mail" /></span><h2>Your invoice address</h2><p className="address-value">{inbox ?? "Email intake is not configured yet."}</p><p className="muted">Give this address to your suppliers, or forward invoices here.</p><Link href="/dashboard/email" className="text-link">Open emails <Icon name="arrow" size={16} /></Link></section></aside>
    </div>
    <section className="panel suppliers-panel" id="suppliers"><div className="panel-heading"><div><h2>Suppliers &amp; rules</h2><p className="muted">You set the terms. Payme stays inside them.</p></div><span className="count-tag">{business.suppliers.length} suppliers</span></div><div className="supplier-list">{business.suppliers.map((s) => { const rule = vault.rules.get(s.ruleId); return <div className="supplier-row" key={s.ruleId}><span className="supplier-avatar">{s.name.slice(0, 1)}</span><div><strong>{s.name}</strong><span className="cell-subtitle mono">{short(s.address)}</span></div><div className="supplier-rule">{rule ? <><strong>{money(rule.budget)} {tokenSymbol(rule.token) ?? "USDC"} <span>{periods[rule.period.toString()] ?? "per period"}</span></strong><span className="cell-subtitle">{money(rule.remaining)} remaining{rule.active ? "" : " · Stopped"}</span></> : <span className="muted">Rule unavailable</span>}</div></div>; })}{!business.suppliers.length && <p className="muted">Add your first supplier and approve a spending rule.</p>}</div><AddSupplier appId={appId} /></section>
  </>;
}
