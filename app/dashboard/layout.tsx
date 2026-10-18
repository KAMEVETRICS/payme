import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "../../src/web/session.ts";
import { getBusiness } from "../../src/web/store.ts";
import { mailFor } from "../../src/web/mail.ts";
import { WorkspaceShell } from "./shell";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession(); if (!session) redirect("/login");
  const business = getBusiness(session.uid); if (!business) redirect("/onboarding");
  return <WorkspaceShell business={business.business} email={session.email} mailCount={mailFor(session.uid).length}>{children}</WorkspaceShell>;
}
