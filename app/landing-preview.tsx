"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "./ui";
import dashboard from "../public/landing/dashboard.png";
import chat from "../public/landing/chat.png";
import email from "../public/landing/email.png";

const views = [
  { name: "Dashboard", icon: "dashboard", image: dashboard, description: "Balances, supplier rules, and payment history. Your business, in view.", href: "/demo", alt: "Payme sample dashboard showing invoice history, USDC and EURC balances, and supplier rules" },
  { name: "Chat", icon: "chat", image: chat, description: "Ask your agent about an invoice and understand why it needs your attention.", href: "/demo/chat", alt: "Payme sample Chat explaining why an invoice above the supplier budget needs owner approval" },
  { name: "Emails", icon: "mail", image: email, description: "Read supplier messages, open attachments, and follow each invoice’s progress.", href: "/demo/email", alt: "Payme sample Emails inbox with a supplier invoice and its attachment" },
] as const;

export function LandingPreview() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const view = views[active];
  return <div className="landing-product">
    <div role="tablist" aria-label="Preview the Payme workspace" className="landing-tabs">
      {views.map((item, i) => <button key={item.name} ref={(el) => { tabs.current[i] = el; }} id={`preview-tab-${i}`} role="tab" aria-selected={active === i} aria-controls="workspace-preview" tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={(event) => {
        let next = active;
        if (event.key === "ArrowRight") next = (active + 1) % views.length;
        else if (event.key === "ArrowLeft") next = (active + views.length - 1) % views.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = views.length - 1;
        else return;
        event.preventDefault(); setActive(next); tabs.current[next]?.focus();
      }}><Icon name={item.icon} size={19} />{item.name}</button>)}
    </div>
    <div id="workspace-preview" role="tabpanel" aria-labelledby={`preview-tab-${active}`} tabIndex={0} className="landing-preview-panel">
      <div className="landing-preview-caption"><p>{view.description}</p><span>Sample workspace · synthetic data</span></div>
      <div className="landing-screen" role="region" aria-label="Workspace screenshot. Scroll horizontally on smaller screens." tabIndex={0}><Image src={view.image} alt={view.alt} unoptimized /></div>
      <p className="landing-screen-hint">Swipe across the preview to see more.</p>
      <div className="landing-preview-footer"><span><Icon name="shield" size={16} />Explore without connecting a wallet</span><Link href={view.href}>Open {view.name.toLowerCase()} demo <Icon name="arrow" size={16} /></Link></div>
    </div>
  </div>;
}
