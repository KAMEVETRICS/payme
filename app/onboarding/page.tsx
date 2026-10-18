import { redirect } from "next/navigation";
import { getSession } from "../../src/web/session.ts";
import { getBusiness } from "../../src/web/store.ts";
import { Setup } from "./setup";
import { Brand } from "../ui";

export default async function Onboarding() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (getBusiness(session.uid)) redirect("/dashboard");
  return (
    <main className="onboarding-page">
      <Brand />
      <div className="setup-step"><span>1</span>Wallet <span>2</span>Business <span>3</span>Fund your vault</div>
      <h1>Set up your business</h1>
      <p className="muted">Signed in as {session.email}.</p>
      <Setup appId={process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? ""} />
    </main>
  );
}
