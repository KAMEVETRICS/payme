import Link from "next/link";
import { Brand, Icon } from "./ui";
import { LandingPreview } from "./landing-preview";
import "./landing.css";

export const metadata = {
  title: "Payme | Your payables agent",
  description: "Payme reads supplier invoices, checks your signed rules, and pays eligible bills in USDC or EURC on Arc. You decide the exceptions.",
};

function InvoiceJourney() {
  return <div className="landing-journey" aria-label="Illustrative invoice checked against an owner-signed supplier rule">
    <div className="journey-topline"><span><Icon name="mail" size={17} />An invoice comes in</span><span>Sample workflow</span></div>
    <div className="journey-invoice">
      <div className="journey-invoice-head"><span className="journey-file"><Icon name="file" size={25} /></span><div><strong>Atlas Packaging</strong><small>Invoice DEMO-1041</small></div><span className="journey-amount">12.50 <small>USD</small></span></div>
      <div className="journey-invoice-line"><span>Packaging supplies</span><span>Due today</span></div>
    </div>
    <div className="journey-connector"><span /><span><Icon name="shield" size={17} />Payme checks your rules</span><span /></div>
    <div className="journey-rule"><div className="journey-rule-heading"><span className="journey-rule-icon"><Icon name="wallet" size={21} /></span><div><strong>Your supplier rule</strong><small>Approved by you</small></div><span className="journey-signed"><Icon name="shield" size={15} />Signed</span></div><div className="journey-rule-values"><div><span>Weekly budget</span><strong>25 <small>USDC</small></strong></div><div><span>Payment address</span><strong>Owner-approved</strong></div></div></div>
    <div className="journey-outcomes"><div><span className="journey-dot pay" /><strong>Pay</strong><small>Inside your rules</small></div><div><span className="journey-dot hold" /><strong>Hold</strong><small>Check again later</small></div><div><span className="journey-dot ask" /><strong>Ask</strong><small>You make the call</small></div></div>
    <div className="journey-note"><Icon name="chat" size={17} /><span>A reason for every decision.</span><Icon name="arrow" size={17} /></div>
  </div>;
}

export default function Home() {
  return <div className="landing-shell">
    <a href="#landing-content" className="skip-link">Skip to content</a>
    <header className="landing-header">
      <Link href="/" className="landing-brand" aria-label="Payme home"><Brand /></Link>
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#workspace">Your workspace</a><a href="#your-rules">Your controls</a></nav>
      <div className="landing-header-actions"><Link href="/login" className="landing-signin">Sign in</Link><Link href="/login" className="landing-button">Get started <Icon name="arrow" size={17} /></Link></div>
    </header>
    <main id="landing-content">
      <section className="landing-hero">
        <div className="landing-hero-copy"><p className="landing-eyebrow"><span />YOUR PAYABLES AGENT</p><h1>Supplier invoices,<br />handled by<br />your rules.</h1><p className="landing-lead">Payme reads your invoices, checks the details, and pays eligible bills in USDC or EURC. You step in when your judgment is needed.</p><div className="landing-hero-actions"><Link className="landing-button" href="/login">Get started with Payme <Icon name="arrow" size={18} /></Link><Link className="landing-button landing-button-secondary" href="/demo">Explore the demo <Icon name="dashboard" size={18} /></Link></div><p className="landing-hero-note"><Icon name="shield" size={16} />Your vault. Your limits. Your approval.</p></div>
        <InvoiceJourney />
      </section>
      <div className="landing-foundations"><span>Built for the way your business pays</span><div><span><Icon name="wallet" size={18} />Circle Wallets</span><span><i />Arc testnet</span><span className="landing-currencies"><b>USDC</b><span>+</span><b>EURC</b></span></div></div>
      <section id="how-it-works" className="landing-section landing-how">
        <div className="landing-section-heading"><p className="landing-eyebrow">FROM INVOICE TO DECISION</p><h2>A little setup.<br />Less routine work.</h2><p>Give your agent the boundaries. Let it handle the checks.</p></div>
        <div className="landing-steps">{[
          { number: "01", icon: "shield", title: "Set the rules", text: "Choose your suppliers, approve their payment addresses, and sign their budgets and expiry dates with your wallet." },
          { number: "02", icon: "mail", title: "Send the invoice", text: "Email it to your Payme address or upload it. AI extracts the details and considers the context alongside hard checks." },
          { number: "03", icon: "file", title: "Follow the decision", text: "Pay, hold, or ask. See what happened, why it happened, and the transaction after a payment is confirmed." },
        ].map((step) => <article key={step.number}><div className="landing-step-top"><span>{step.number}</span><Icon name={step.icon as "shield" | "mail" | "file"} size={25} /></div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
      </section>
      <section id="workspace" className="landing-section landing-workspace">
        <div className="landing-section-heading"><p className="landing-eyebrow">ONE PLACE TO KEEP UP</p><h2>Your money, messages,<br />and agent. Together.</h2><p>Move between the big picture and the details that need you.</p></div>
        <LandingPreview />
      </section>
      <section id="your-rules" className="landing-section landing-controls">
        <div><span className="landing-control-icon"><Icon name="shield" size={28} /></span><p className="landing-eyebrow">DELEGATE WITH BOUNDARIES</p><h2>Your agent does the checks.<br />You keep the final say.</h2><p>AI can decide to be more cautious. It cannot override your payment checks. When an invoice needs an exception, Payme explains why and asks you.</p><Link href="/demo/chat" className="landing-text-link">See an approval example <Icon name="arrow" size={17} /></Link></div>
        <div className="landing-control-list">{[
          ["Signed spending limits", "Supplier budgets, payment addresses, and expiry dates are approved by you and enforced by your vault."],
          ["A deliberate approval", "An exception needs a separate Circle Wallets signature. A chat message alone cannot authorize a payment."],
          ["Separate currency controls", "USDC for dollar invoices. EURC for euro invoices. Each has its own budgets and caps."],
          ["A record you can follow", "Invoice details, checks, reasoning, and a transaction link after confirmed payment."],
        ].map(([title, text]) => <article key={title}><span><Icon name="shield" size={19} /></span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
      </section>
      <section className="landing-close"><div><p className="landing-eyebrow">PUT YOUR RULES TO WORK</p><h2>Keep the business moving.<br />Let Payme handle the routine.</h2><p>Start your workspace and set the first supplier rule.</p></div><div><Link className="landing-button" href="/login">Get started with Payme <Icon name="arrow" size={18} /></Link><span>Currently on Arc testnet · use test tokens</span></div></section>
    </main>
    <footer className="landing-footer"><Link href="/" aria-label="Payme home"><Brand /></Link><p>Your payables agent. Working inside your rules.</p><div><Link href="/demo">Explore demo</Link><a href="https://github.com/KAMEVETRICS/payme" target="_blank" rel="noreferrer">GitHub <Icon name="arrow" size={15} /></a><Link href="/login">Sign in</Link></div></footer>
  </div>;
}
