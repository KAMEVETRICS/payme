# Payme

Payme pays a small business's supplier invoices in USDC (dollar invoices) or EURC (euro invoices) on [Arc](https://www.arc.io), Circle's stablecoin chain. Suppliers email invoices to the business's Payme address; an AI agent reads each one, checks it against what the owner has approved, and pays it, holds it until it is due, or asks the owner. The owner never hands over the money: it sits in a vault contract the owner's wallet controls, and the contract refuses any payment outside the rules the owner signed.

> **Status:** working end to end on **Arc testnet**. It is not ready for real funds; see [Limits](#limits).

Hosted at [payme.deplace.space](https://payme.deplace.space), application revision `3df2ad6`, released on **17 October 2026**. Try the isolated [judge demo](https://payme.deplace.space/demo) without signing in. It uses synthetic invoices and scripted chat, and cannot send payments. The Linux production build and all **92 tests** passed. Flagged invoice concerns now require owner review even during model outages and historical automatic retries; delayed confirmations cannot override a recorded rejection. The owner reports the hosted payment walkthrough completed. [Submission notes](SUBMISSION.md) distinguish zero customer adoption from verified testnet development activity.

Follow-up release **`b77ff53`**, deployed at **2:19 PM PDT** (`2026-10-17T21:19:52Z`): blocked invoices now have a prominent blue **Dismiss invoice** button. Older invoice emails were recovered into their original accounts with saved attachments and a clear **Recovered** label. Their original email bodies and recipient lists were not retained; the inbox explains this rather than inventing message text.

Wallet controls were updated in **`a50794e`** at **3:00 PM PDT** (`2026-10-17T22:00:30Z`): the full wallet address appears first with one-click copying, followed by separate highlighted USDC and EURC balances. Clipboard success feedback and manual-selection fallback are included.

## How it works

The public landing page is `/`. **Get started** and **Sign in** lead to `/login`; successful sign-in opens `/dashboard`, with first-time owners completing `/onboarding` first. The landing page previews Dashboard, Chat and Emails using labeled synthetic screenshots and links to the interactive `/demo` workspace.

```
supplier ──email──▶ Cloudflare Email Routing ──▶ email Worker ──▶ Payme
                                                                  │
                                    agent reads the invoice (LLM) │
                                    hard checks in code           │
                                    decision: pay · hold · ask    │
                                                                  ▼
            owner's dashboard ◀── conversation ── vault contract on Arc ──▶ supplier paid in USDC or EURC
```

1. **Setup.** The owner signs in with an email code. Circle creates the owner a wallet, and Payme creates a fresh **vault** for the business: a contract the owner's wallet owns, with a total spending cap.
2. **Rules.** For each supplier, the owner signs a rule in their wallet: pay this address, up to this much per week or month (or once), until this date. Payme's agent submits the signed rule; the contract checks the signature is the owner's.
3. **Invoices.** Invoices arrive by email (or upload). The agent reads the PDF or image and extracts the supplier, payout address, invoice number, amount, currency and due date.
4. **Checks.** Code, not the model, checks the invoice: a known supplier, the approved address, no change of payment details, no text aimed at the agent, a rule in force, currency, budget left this period, the vault's cap and balance, not already paid, and a waiting period for addresses the vault has never paid.
5. **Decision.** The model chooses **pay**, **hold** (until the due date or until a new address clears), or **ask**, with one sentence of reasoning. It can be stricter than the checks but never looser: a failed check always becomes *ask*. If the model is unavailable, coded rules decide.
6. **Payment.** Payments go out through the agent's Circle wallet, only after the contract confirms it would accept them. A scheduler pays held invoices when they come due.
7. **The workspace.** Three separate tabs: **Dashboard** for balances, confirmed-payment charts, searchable invoice history, CSV export, funding and supplier rules; **Chat** for typed conversations with Payme and invoice approvals; **Emails** for received messages and attachments. Navigation becomes a bottom bar on mobile. For an *ask*, the owner can approve (sign a one-off rule for exactly that invoice, after which the agent pays it) or reject.
8. **Funding.** Dashboard **Manage funds** shows the owner's USDC/EURC balances and address, with token selection, **Add to vault**, and **Withdraw** confirmed in Circle's window. Funding transfers the selected token from the owner wallet; withdrawal calls the vault as its owner. The wallet needs USDC for gas as well as the token being moved. Onboarding explains funding, and an empty vault shows the next-step prompt.

Typed chat uses the existing OpenRouter configuration and saves conversations per business. It receives current vault/rule data, recorded invoice states, and recent email excerpts. It explains and suggests next steps; typed messages do not execute payments or approve rules. If live balance reads fail, the agent is told they are unavailable. Stock and analyst agents remain planned work. Chat and mail data live under ignored `data/chat/` and `data/mail/` on the single server.

## Safety model

- **The business keeps custody.** Payme never holds customer funds. The vault belongs to the owner's wallet; Payme's agent can only pay within rules that wallet signed.
- **The contract is the limit, not the prompt.** Each payment must go to the rule's address, fit the rule's budget for the period and the vault's cap, arrive while the rule and vault are live, and use an invoice that has not been paid. Anything else reverts with a named reason.
- **New addresses wait.** An address the vault has never paid cannot be paid for 24 hours, which blunts the "our bank details changed" fraud.
- **Untrusted input stays untrusted.** Invoices and emails are data. Text in them aimed at the agent is reported and blocks payment.
- **Every decision has a receipt:** the invoice, each check, the balance the agent saw, the decision and reason, and the transaction.

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | `PayerVault` (owner-signed rules, budgets, cap, expiry, pay-once, new-address delay) and `VaultFactory` (one vault per business) |
| `src/agent/` | The agent: reading invoices, checks, decisions, payment |
| `src/web/` | Server code for the app: sessions, Circle user wallets, approvals, email intake, scheduler |
| `src/` | Shared clients for Arc, Circle and OpenRouter, and owner-signed rules (EIP-712) |
| `app/` | The Next.js web app and its API routes |
| `workers/email/` | Cloudflare Email Worker that hands incoming mail to Payme |
| `scripts/` | Deploy the contracts, set up Circle wallets, run the scheduler, run the agent on one file |
| `test/` | Contract tests (Solidity) and agent tests (Node) |
| `deployments/` | Addresses of the deployed contracts |
| `deploy/` | How the hosted instance runs: systemd services, tunnel config, backups |

## What it uses

- **Arc testnet** for settlement; USDC and EURC through their ERC-20 interfaces (6 decimals). Each rule names the token it pays in; a EUR invoice is paid in EURC and a USD invoice in USDC. Payme never converts between them (vault v3, factory `0x288cacfa0a3d200c3beff740b5e3e783ae4358c8`; businesses on a v2 vault are offered a move).
- **Circle Wallets:** user-controlled wallets for owners (email sign-in, signing rules), a developer-controlled wallet for the agent.
- **OpenRouter** for the model (default `anthropic/claude-sonnet-5.5`, configurable).
- **Next.js 16**, **viem**, **Hardhat 3** for the contracts.
- **Cloudflare** Email Routing, an Email Worker, and a tunnel for receiving email.

## Setup

Requirements: Node.js 24 or later (scripts run TypeScript directly), accounts with Circle (developer console) and OpenRouter, and, for email, a domain on Cloudflare.

```bash
npm install
cp .env.example .env    # then fill it in; every setting is explained in the file
npm test                # contract and agent tests
```

1. **Contracts.** Fund `DEPLOYER_ADDRESS` with testnet USDC from [faucet.circle.com](https://faucet.circle.com), then run `npm run deploy:testnet`. It deploys the factory and writes its address to `deployments/arc-testnet.json`. (The address of an existing deployment is already there.)
2. **Agent wallet.** With `CIRCLE_API_KEY` set, run `npm run circle:setup`. It registers the Circle entity secret (keep the recovery file it writes to `secrets/`), creates the agent's wallet, and funds it with testnet gas.
3. **Owner sign-in.** In the Circle console, enable **email** under Wallets → User Controlled → Configurator, configure SMTP for the sign-in emails, and copy the App ID to `NEXT_PUBLIC_CIRCLE_APP_ID`. The hosted instance uses Resend with the verified sender `signin@deplace.space`; SMTP credentials belong in Circle's console, not in the repository. SES is a pending fallback, not the active provider.
4. **Run it.**

   ```bash
   npm run dev                       # compiles the contracts, then the app on http://localhost:3000
   npm run scheduler                 # pays held and approved invoices when due; leave it running
   ```

   Run a local scheduler only with a separate test workspace. For the existing hosted business, the server owns the current `data/` and `receipts/`; the older local copies must not drive payments. Even after a download, a local snapshot becomes stale as soon as the server processes more work. See `deploy/README.md` for state-refresh precautions.

For production, build with `npm run build` and serve with `npm start`, and run the scheduler as a long-running service (or call `/api/cron/scheduler` with `CRON_SECRET` from a cron job).

## Receiving invoices by email

Each business has an address of the form `<business-name>-<key>@<INBOUND_DOMAIN>`, shown on its dashboard.

1. Put the domain on Cloudflare and set `INBOUND_DOMAIN` (for example `invoices.example.com`).
2. Make the app reachable at a public HTTPS address (for example a Cloudflare tunnel). Only `/api/inbound/email` needs to be public for email.
3. Deploy the Worker from `workers/email/`: set `WEBHOOK_URL` in `wrangler.toml` to that public address, then `npx wrangler deploy`, and set its secrets: `WEBHOOK_SECRET` (the same value as `INBOUND_WEBHOOK_SECRET`) and `FALLBACK_ADDRESS` (a verified Email Routing destination that receives mail if Payme is unreachable).
4. In Cloudflare **Email Routing**, add the subdomain, and set its **catch-all** rule to **Send to a Worker** → `payer-email`.

The Worker passes each raw email to Payme, which keeps the invoice attachments (PDFs, or scans and text files when there is no PDF), ignores spam and duplicates, and queues them for the agent. Postmark is supported as an alternative (`/api/inbound/postmark`, see `.env.example`).

## Tests

```bash
npm test               # both suites
npx hardhat test solidity
npm run test:agent
```

The contract tests cover every refusal, signatures (forged, altered, reused, wrong vault, smart-account owners), budgets per period, and a fuzz test that a period's payments never exceed its budget. The agent tests cover the checks, the coded decisions, waiting for new addresses and due dates, and email parsing.

Latest verification: **17 October 2026**, the Linux production build and all **38 contract tests and 54 Node tests** passed before release. Hosted checks passed for the three public sample tabs, their disclosures, synthetic attachment, security headers, and unauthenticated protection of private workspace/mail/chat/approval/intake routes. Earlier releases were also checked against authenticated live vault and chat data. Desktop and 390px/320px sample layouts were visually checked. No payment was sent during this release verification.

## Limits

- **Testnet only.** Contracts have not been independently reviewed; do not use real funds.
- **File storage.** Businesses, decisions and the email queue are files under `data/` and `receipts/` on one server. A database is needed before more than a few businesses.
- **One server process.** Rate limits and sign-in state live in memory.
- **Sign-in email** depends on the SMTP provider configured in Circle. Resend was tested on the hosted app on 17 October 2026; sending limits and delivery still need monitoring.
- **Operations and recovery.** Durable email quotas, interrupted-job recovery, uncertain provider/chain outcome reconciliation, and off-site operational controls need further work. A crash during an invoice action leaves a fail-closed claim that must be reconciled before an operator removes it.
- **Invoice authenticity.** An approved payout address constrains where funds can go; it does not prove that an email is a genuine supplier obligation. Sender/business verification remains needed.
- **Payouts are USDC or EURC on Arc** only, to suppliers with a wallet. Converting between them (for example Circle StableFX) and paying bank accounts are not built.

## License

MIT. See [LICENSE](LICENSE).
