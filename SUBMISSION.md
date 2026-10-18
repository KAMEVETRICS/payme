# Payme — Tameion submission

Payme is an accounts-payable agent for small businesses. It reads supplier invoices from email or upload, checks them against owner-signed rules, and pays, waits, or asks for an owner decision. US dollar invoices settle in USDC and euro invoices in EURC on Arc testnet.

- Live application: https://payme.deplace.space
- Read-only judge demo: https://payme.deplace.space/demo
- Source: https://github.com/KAMEVETRICS/payme

## Try it without a wallet

Open the demo and explore Dashboard, Chat, and Emails. Read the sample supplier message, ask why DEMO-1042 needs approval, and step through its decision, approval, and receipt explanations. Search/filter history, switch the chart between USDC and EURC, and open the synthetic attachment.

The demo is isolated from private workspaces. Its invoices, balances, emails, scripted chat replies, and receipt examples are illustrative. It cannot sign, fund, withdraw, approve, or send payments. Sign in to use a real testnet workspace and the live agent.

## Build and safety boundaries

Circle user-controlled wallets authenticate the owner and sign EIP-712 supplier rules. The agent uses a Circle developer-controlled wallet to execute within the vault’s approved payee, token, budget, cap, expiry, duplicate-invoice protection, and new-address delay. Hard checks constrain model decisions. Flagged invoice concerns require owner review, including during a decision-model outage. Approvals are separate signed actions; typed chat has no payment tools.

The stack is Next.js/React/TypeScript, Solidity/Hardhat, Circle Wallets, Arc testnet, OpenRouter, Cloudflare Email Routing/Worker, and a single hosted application with a scheduler. See README.md for setup and environment requirements.

## Usage, stated precisely

As of 17 October 2026, the builder reports **zero onboarded businesses** and no external-customer validation. Production customer payment volume is **zero**. This project was started over the last few days.

A read-only check of hosted development receipts at **22:35:07 UTC** found:

| Metric | Arc testnet development activity |
|---|---:|
| Invoice decision records | 18 |
| Decision records originating from email | 5 |
| Confirmed payment transactions / invoices | 7 / 7 |
| Verified USDC paid | 10.25 USDC |
| Verified EURC paid | 0 EURC |

These figures are **testing, not traction or real-world value moved**. Decision records include repeated submissions; they are not 18 distinct customer invoices. Each counted payment required a successful on-chain Paid event matching the logged vault, invoice ID, and transaction hash. Repeated transaction records and dry runs are excluded. Standalone historical cycle-script logs are excluded. No private email, invoice contents, owner identifiers, or wallet records are included here.

## Prototype limits

This is a testnet prototype with a source security review and automated tests. No independent professional contract audit or mainnet readiness is claimed. Email sender identity does not prove that an invoice is a genuine supplier obligation. Recovery from interrupted jobs or uncertain provider outcomes, intake quotas, durable storage, monitoring, and independent review need further work before customer funds or mainnet use. Bank payouts, foreign-exchange conversion, and compliance screening are outside the implemented product.
