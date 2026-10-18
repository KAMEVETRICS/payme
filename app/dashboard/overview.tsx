"use client";
import Link from "next/link";
import { useState } from "react";
import type { Overview, PaymentRow } from "../../src/web/overview.ts";
import { Icon } from "../ui";
export const statusLabels = { paid: "Paid", held: "Scheduled", review: "Needs review", unpaid: "Not paid", rejected: "Rejected" };
export function ExportPayments({ payments }: { payments: PaymentRow[] }) {
  function download() {
    const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
    const lines = [["Supplier", "Invoice", "Amount", "Currency", "Status", "Date", "Transaction"], ...payments.map((p) => [p.supplier, p.invoice, p.amount, p.currency, statusLabels[p.status], p.at, p.txHash ?? ""])];
    const url = URL.createObjectURL(new Blob([lines.map((line) => line.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "payme-payments.csv"; a.click(); URL.revokeObjectURL(url);
  }
  return <button className="secondary button-small" onClick={download} disabled={!payments.length}><Icon name="download" size={16} />Export data</button>;
}
export function SpendingChart({ overview }: { overview: Overview }) {
  const [token, setToken] = useState<"USDC" | "EURC">("USDC");
  const points = overview.monthly[token];
  const max = Math.max(...points.map((p) => Number(p.amount)), 1);
  const periodTotal = points.reduce((sum, p) => sum + Number(p.amount), 0);
  return <section className="panel spending-panel" aria-label="Payments over time"><div className="panel-heading"><div><p className="eyebrow">Payments sent</p><div className="chart-total">{periodTotal.toLocaleString("en-US", { maximumFractionDigits: 6 })}<span>{token}</span></div></div><div className="segmented" aria-label="Chart currency">{(["USDC", "EURC"] as const).map((t) => <button key={t} aria-pressed={token === t} onClick={() => setToken(t)}>{t}</button>)}</div></div><div className="chart-meta"><span>Last six months</span><span><i className="legend-dot blue" />Confirmed payments</span></div><div className="bar-chart" role="img" aria-label={`Payments in ${token}: ${points.map((p) => `${p.label} ${p.amount}`).join(", ")}`}><div className="chart-grid" aria-hidden="true"><span /><span /><span /><span /></div>{points.map((p) => <div className="bar-column" key={p.month}><div className="bar-track"><div className="bar-fill" style={{ height: `${Number(p.amount) / max * 90}%`, minHeight: Number(p.amount) ? 5 : 0 }} /><span className="bar-tooltip">{p.amount} {token}</span></div><span className="bar-label">{p.label}</span></div>)}</div>{periodTotal === 0 && <p className="chart-empty">Your first settled payment will appear here.</p>}</section>;
}
export function PaymentHistory({ payments, detailsBase = "/dashboard/chat" }: { payments: PaymentRow[]; detailsBase?: string }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all");
  const filtered = payments.filter((p) => `${p.supplier} ${p.invoice}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || p.status === filter));
  return <section className="panel history-panel"><div className="panel-heading"><div><h2>Payment history</h2><p className="muted">Every invoice, from first check to settlement.</p></div><ExportPayments payments={filtered} /></div><div className="table-toolbar"><label className="search-field"><Icon name="search" size={17} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoices…" aria-label="Search invoices" /></label><select aria-label="Filter invoice status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="result-count">{filtered.length} invoices</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Supplier / invoice</th><th>Status</th><th>Date</th><th className="align-right">Amount</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><Link href={`${detailsBase}#${p.id}`} className="invoice-name">{p.supplier}</Link><span className="cell-subtitle">{p.invoice}</span></td><td><span className={`status-pill ${p.status}`}><i />{statusLabels[p.status]}</span></td><td className="date-cell">{new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}<span className="cell-subtitle">{p.due ? `Due ${p.due}` : "No due date"}</span></td><td className="align-right amount-cell">{p.amount}<span className="cell-subtitle">{p.currency}</span></td><td><Link href={`${detailsBase}#${p.id}`} className="icon-link" aria-label={`View invoice ${p.invoice}`}><Icon name="chevron" size={16} /></Link></td></tr>)}</tbody></table></div>{!filtered.length && <div className="empty-state"><span className="empty-icon"><Icon name="file" size={25} /></span><h3>{payments.length ? "No matching invoices" : "Your payment history starts here"}</h3><p>{payments.length ? "Try another search or status." : "Upload an invoice or send one to your Payme email address."}</p></div>}</section>;
}
export function PaymentStatus({ counts }: { counts: Overview["counts"] }) {
  const groups = [{ label: "Paid", value: counts.paid, color: "#2c65ff" }, { label: "Scheduled", value: counts.held, color: "#1c2230" }, { label: "Needs review", value: counts.review + counts.unpaid, color: "#f6508a" }, { label: "Rejected", value: counts.rejected, color: "#d9dfe9" }];
  const total = groups.reduce((s, g) => s + g.value, 0); let end = 0;
  const stops = groups.map((g) => { const start = end; end += total ? g.value / total * 100 : 0; return `${g.color} ${start}% ${end}%`; });
  return <section className="panel status-panel"><h2>Invoice status</h2><p className="muted">A clear view of what happens next.</p><div className="donut" style={{ background: total ? `conic-gradient(${stops.join(",")})` : "#eaf0fb" }} role="img" aria-label={groups.map((g) => `${g.label}: ${g.value}`).join(", ")}><div><span>Total invoices</span><strong>{total}</strong></div></div><div className="status-legend">{groups.map((g) => <div key={g.label}><span><i style={{ background: g.color }} />{g.label}</span><strong>{g.value}</strong></div>)}</div></section>;
}
