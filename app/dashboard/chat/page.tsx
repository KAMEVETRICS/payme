import { redirect } from "next/navigation";
import { getSession } from "../../../src/web/session.ts";
import { getBusiness } from "../../../src/web/store.ts";
import { businessHistory } from "../../../src/web/business-history.ts";
import { readChat } from "../../../src/web/chat-store.ts";
import { buildOverview } from "../../../src/web/overview.ts";
import { Icon } from "../../ui";
import { InvoiceThread } from "../invoice-thread";
import { Conversation } from "./conversation";

export default async function ChatPage() {
  const session = await getSession(); if (!session) redirect("/login");
  const business = getBusiness(session.uid); if (!business) redirect("/onboarding");
  const { decisions, answers } = businessHistory(business);
  const overview = buildOverview(decisions, answers);
  return <><div className="page-heading"><div><p className="eyebrow">A conversation with context</p><h1>Chat</h1><p>Your agent knows the details. Ask what’s on your mind.</p></div><span className="info-tag"><Icon name="shield" size={16} />You stay in control</span></div><div className="chat-layout"><Conversation initial={readChat(session.uid)} business={business.business} /><aside className="panel decisions-panel" id="invoice-decisions"><div className="panel-heading"><div><h2>Invoice decisions</h2><p className="muted">Review the agent’s reasoning and answer requests here.</p></div><span className="count-tag">{overview.counts.review} to review</span></div>{decisions.length ? <InvoiceThread decisions={[...decisions].reverse()} answers={answers} appId={process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? ""} /> : <div className="empty-state"><Icon name="file" size={28} /><h3>No invoice decisions yet</h3><p>Upload an invoice from the dashboard to get started.</p></div>}</aside></div></>;
}
