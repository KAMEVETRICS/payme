"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Brand, Icon } from "../ui";
import { SignOut } from "./sign-out";
const tabs = [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }, { href: "/dashboard/chat", label: "Chat", icon: "chat" }, { href: "/dashboard/email", label: "Emails", icon: "mail" }] as const;
export function WorkspaceShell({ children, business, email, mailCount }: { children: ReactNode; business: string; email: string; mailCount: number }) {
  const pathname = usePathname();
  return <div className="workspace"><a className="skip-link" href="#workspace-content">Skip to content</a>
    <header className="workspace-header"><Link href="/dashboard" className="brand-link" aria-label="Payme home"><Brand /></Link><div className="workspace-business"><span className="business-avatar">{business.slice(0, 1).toUpperCase()}</span><span><strong>{business}</strong><small>Business workspace</small></span></div><div className="header-actions"><span className="network-label"><span />Arc testnet</span><Link href="/dashboard/email" className="header-mail" aria-label={`${mailCount} emails`}><Icon name="mail" />{mailCount > 0 && <span className="notification-count">{mailCount > 99 ? "99+" : mailCount}</span>}</Link><details className="account-menu"><summary aria-label="Account menu" title={email}>{email.slice(0, 1).toUpperCase()}</summary><div className="account-popover"><strong>{business}</strong><p>{email}</p><SignOut /></div></details></div></header>
    <nav className="workspace-nav" aria-label="Main navigation">{tabs.map((tab) => <Link key={tab.href} href={tab.href} className={pathname === tab.href ? "nav-link active" : "nav-link"} aria-current={pathname === tab.href ? "page" : undefined}><Icon name={tab.icon} size={21} /><span>{tab.label}</span></Link>)}<div className="nav-security" title="Payments stay inside your signed rules"><Icon name="shield" /><span>Rules<br />protected</span></div></nav><main id="workspace-content" className="workspace-content">{children}</main></div>;
}
