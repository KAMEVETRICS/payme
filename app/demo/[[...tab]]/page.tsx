import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DemoWorkspace } from "../demo-workspace";

export const metadata: Metadata = { title: "Payme · Demo", robots: { index: false, follow: false } };

export default async function DemoPage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab = [] } = await params;
  if (tab.length > 1 || (tab.length && !["chat", "email"].includes(tab[0]))) notFound();
  return <DemoWorkspace tab={tab[0] === "chat" ? "chat" : tab[0] === "email" ? "email" : "dashboard"} />;
}
