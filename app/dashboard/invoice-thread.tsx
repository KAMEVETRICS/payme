import { explorer } from "../../src/arc.ts";
import { holdEndsAt, payableFromMs } from "../../src/agent/checks.ts";
import type { Receipt } from "../../src/agent/process.ts";
import { receiptIdOf } from "../../src/web/activity.ts";
import { approvalFor } from "../../src/web/approvals.ts";
import { itemState, type ItemState, type Resolution } from "../../src/web/resolutions.ts";
import { paymentProblem } from "../../src/web/words.ts";
import { AskActions, RetryPayment } from "./ask-actions";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
function TxLink({ hash, children }: { hash: string; children: React.ReactNode }) {
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** "on 5 Nov 2026" for a due date, "from 17 Oct 2026, 06:02" for a time. */
function untilWords(until: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(until)
    ? `on ${new Date(`${until}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })}`
    : `from ${when(until)}`;
}

/** What happened after the decision, as the next messages in the conversation. */
function FollowUp({ state, receipt, appId }: { state: ItemState; receipt: Receipt; appId: string }) {
  const id = receiptIdOf(receipt);
  const amount = `${receipt.invoice.total} ${receipt.invoice.currency}`;
  switch (state.state) {
    case "held": {
      // The scheduler pays when the hold ends, but never before the invoice is due.
      const dueFrom = payableFromMs(receipt.invoice.dueDate);
      const words = dueFrom > holdEndsAt(state.until) ? `from ${when(new Date(dueFrom).toISOString())}` : untilWords(state.until);
      return <div className="bubble agent note">Payme will pay this {words}, once it checks everything again.</div>;
    }
    case "open":
      if (!state.escalated) return null; // the actions sit in the decision's own message
      return (
        <div className="bubble agent">
          When it came time to pay, {state.escalated.charAt(0).toLowerCase() + state.escalated.slice(1)}
          <OpenActions receipt={receipt} checks={state.checks} appId={appId} />
        </div>
      );
    case "rejected":
      return <div className="bubble owner">You rejected it. Nothing was paid.</div>;
    case "paid":
      return (
        <>
          {state.approvedByOwner && <div className="bubble owner">You approved it.</div>}
          <div className="bubble agent note">
            Paid {amount}
            {state.by === "Payer" ? " when it came due" : ""}. <TxLink hash={state.payment.txHash}>See the payment</TxLink>
          </div>
        </>
      );
    case "unpaid":
      return (
        <>
          {state.approvedByOwner && <div className="bubble owner">You approved it.</div>}
          <div className="bubble agent note">
            Not paid yet: {paymentProblem(state.payment)}. Payme keeps trying.
            <br />
            <RetryPayment receiptId={id} />
          </div>
        </>
      );
    default:
      return null;
  }
}

function OpenActions({ receipt, checks, appId }: { receipt: Receipt; checks: Receipt["checks"]; appId: string }) {
  const approval = approvalFor(receipt, checks);
  return (
    <AskActions appId={appId} receiptId={receiptIdOf(receipt)} canApprove={approval.canApprove} blockers={approval.blockers} warnings={approval.warnings} />
  );
}


export function InvoiceThread({ decisions, answers, appId }: { decisions: Receipt[]; answers: Map<string, Resolution[]>; appId: string }) {
  const stateOf = (receipt: Receipt) => itemState(receipt, answers.get(receiptIdOf(receipt)));
  return (
<div className="thread">
        {decisions.map((d) => {
          const id = receiptIdOf(d);
          const state = stateOf(d);
          return (
            <div key={id} id={id}>
              <div className="bubble agent">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {d.invoice.supplierName} · invoice {d.invoice.invoiceNumber} · {d.invoice.total} {d.invoice.currency}
                  </strong>
                  <span className={`badge ${d.decision.action}`}>{d.decision.action}</span>
                </div>
                <p style={{ margin: "6px 0 4px" }}>{d.decision.reason}</p>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  {when(d.at)}
                  {d.source?.kind === "email" && ` · emailed by ${d.source.from}`} · saw {d.seen.vaultBalanceUsdc} {d.seen.token ?? "USDC"} in the vault
                  {d.payment?.status === "paid" && (
                    <>
                      {" · "}
                      <TxLink hash={d.payment.txHash}>paid on chain</TxLink>
                    </>
                  )}
                  {d.payment && d.payment.status !== "paid" && ` · not paid: ${paymentProblem(d.payment)}`}
                </p>
                {state.state === "open" && !state.escalated && <OpenActions receipt={d} checks={state.checks} appId={appId} />}
              </div>
              <FollowUp state={state} receipt={d} appId={appId} />
            </div>
          );
        })}
      </div>


  );
}
