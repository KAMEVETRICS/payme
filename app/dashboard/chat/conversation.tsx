"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatExchange } from "../../../src/web/chat-store.ts";
import { api } from "../../circle-client";
import { Icon } from "../../ui";

const suggestions = ["What needs my attention?", "How much can Payme spend?", "Why is an invoice on hold?"];
export function Conversation({ initial, business }: { initial: ChatExchange[]; business: string }) {
  const [turns, setTurns] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const request = useRef<{ id: string; message: string } | null>(null);
  const sending = useRef(false);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, pending]);
  async function send(text: string) {
    const message = text.trim();
    if (!message || sending.current) return;
    sending.current = true; setError(""); setPending(message); setDraft("");
    if (request.current?.message !== message) request.current = { id: crypto.randomUUID(), message };
    try {
      const turn = await api<ChatExchange>("/api/chat", request.current);
      setTurns((previous) => previous.some((e) => e.id === turn.id) ? previous : [...previous, turn]);
      request.current = null;
    } catch (err) { setError((err as Error).message); setDraft(message); }
    finally { sending.current = false; setPending(""); }
  }
  return <section className="panel conversation-panel" aria-label="Conversation with Payme">
    <div className="conversation-header"><span className="agent-avatar">p.</span><div><h2>Payme</h2><p>Your payments agent · {business}</p></div><span className="agent-tag">Payments</span></div>
    <div className="conversation-messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
      {!turns.length && !pending && <div className="chat-welcome"><span className="chat-welcome-icon"><Icon name="chat" size={30} /></span><p className="eyebrow">A little clarity goes a long way</p><h2>Let’s talk about your business.</h2><p>Ask about your balances, supplier rules, or an invoice.<br />I’ll help you understand what needs to happen next.</p><div className="suggestions">{suggestions.map((s) => <button className="secondary" key={s} onClick={() => send(s)}>{s}<Icon name="arrow" size={16} /></button>)}</div></div>}
      {turns.map((t) => <div className="chat-turn" key={t.id}><div className="typed-message owner-message"><span>You</span><p>{t.message}</p></div><div className="typed-message agent-message"><span><i className="mini-agent">p.</i>Payme</span><p>{t.reply}</p></div></div>)}
      {pending && <div className="chat-turn"><div className="typed-message owner-message"><span>You</span><p>{pending}</p></div><div className="typing-indicator" role="status"><span className="mini-agent">p.</span>Payme is checking your workspace<span className="typing-dots">…</span></div></div>}<div ref={end} />
    </div>
    <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void send(draft); }}><label className="sr-only" htmlFor="chat-message">Message Payme</label><textarea id="chat-message" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} rows={2} placeholder="Ask Payme a question…" disabled={!!pending} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }} /><div className="composer-footer"><span>Payments and rule changes still need your signed approval.</span><button type="submit" disabled={!!pending || !draft.trim()} aria-label="Send message"><Icon name="send" size={18} /></button></div>{error && <p role="alert" className="error">{error}</p>}</form>
  </section>;
}
