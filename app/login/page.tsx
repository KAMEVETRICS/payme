import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../src/web/session.ts";
import { getBusiness } from "../../src/web/store.ts";
import { SignIn } from "../sign-in";
import { Brand, Icon } from "../ui";

export const metadata = { title: "Sign in | Payme" };

export default async function Home() {
  const session = await getSession();
  if (session) redirect(getBusiness(session.uid) ? "/dashboard" : "/onboarding");

  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  return (
    <main className="auth-page">
      <section className="auth-content">
      <Link href="/" className="auth-home" aria-label="Payme home"><Brand /></Link>
      <p className="eyebrow">YOUR BUSINESS WORKSPACE</p>
      <h1>A clearer way to pay your suppliers.</h1>
      <p className="auth-intro">Sign in to your workspace. Keep an eye on your money, talk to your agent, and let your rules handle the routine.</p>
      {appId ? (
        <SignIn appId={appId} />
      ) : (
        <div className="card">
          <p className="error">Sign-in is not set up yet.</p>
          <p className="muted">
            Please contact the workspace administrator to finish setting up sign-in.
          </p>
        </div>
      )}
      <p className="auth-footnote">Secured with Circle Wallets · Arc testnet<br />Your vault. Your rules. Your approval.</p>
      <a className="text-link" href="/demo">Explore the sample workspace <Icon name="arrow" size={16} /></a>
      </section>
      <aside className="auth-aside"><span className="section-icon"><Icon name="shield" size={23} /></span><h2>Less chasing invoices.<br />More running your business.</h2><p>Payme checks supplier invoices against the rules you approve. You step in when your judgment is needed.</p><div className="flow-preview"><div><span className="section-icon"><Icon name="mail" /></span><span><strong>An invoice arrives</strong><small>Email it in, or upload a document.</small></span></div><div><span className="section-icon"><Icon name="shield" /></span><span><strong>Your agent checks the details</strong><small>Supplier, amount, timing, and signed rules.</small></span></div><div><span className="section-icon"><Icon name="wallet" /></span><span><strong>Payments stay under your control</strong><small>USDC and EURC, inside your vault’s limits.</small></span></div></div></aside>
    </main>
  );
}
