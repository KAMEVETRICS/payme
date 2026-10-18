# Hosting

Payme runs on one Ubuntu 24.04 server (AWS Lightsail, 2 GB) and is reached only through a Cloudflare tunnel, so the server accepts no web traffic directly. Its firewall allows SSH from one address.

| File | Installed at |
|---|---|
| `payme-web.service` | `/etc/systemd/system/` — `next start` on 127.0.0.1:3000 as the `payme` user |
| `payme-scheduler.service` | `/etc/systemd/system/` — the scheduler, every 60 s |
| `cloudflared.yml` | `/etc/cloudflared/config.yml` — public hostname to the app; `/api/cron` is not exposed |
| `payme-backup.sh` | `/etc/cron.daily/payme-backup` — `data/` and `receipts/` to `/var/backups/payme`, 14 days |

The app lives in `/opt/payme/app`, with its `.env` (runtime settings only: no deployer key or Cloudflare token) readable only by `payme`.

## Updating

Commit the release first, then create a source archive that excludes runtime state and private project notes:

```bash
git archive --format=tar.gz -o source.tar.gz HEAD -- . ':!data' ':!receipts' ':!docs' ':!HANDOFF.md' ':!plan.md' ':!.claude' ':!scripts/cycle.ts' ':!scripts/seed-test-business.ts'
```

Upload it to the server and unpack into a new `/opt/payme/releases/<release-id>/app` directory owned by `payme`. Keep the current services online while building there. Install dependencies with `npm ci`; reusing a copy of the existing Linux `node_modules` is valid only after the lockfile and declared dependency versions match. Link the existing server `.env` for the build without copying or printing its contents. Run `npm run build` and `npm test` in the staging directory.

Before promotion, save the existing source and production build under `/var/backups/payme/releases/<release-id>/`. Stop web and scheduler briefly, install the new source while preserving `.env`, `data/`, `receipts/`, `logs/`, and installed dependencies, and swap the staged `.next` build into place. Update the service units if needed, reload systemd, and start both services. Check localhost and the public URL, authenticated workspace routes, and chat. Restore the saved source/build and restart services if a release check fails.

Runtime state is excluded explicitly. The tracked `data/test-business.json` is a synthetic local fixture and must not overwrite hosted state.

## Wallet address and balances — 17 October 2026

- Active application revision: `a50794ef4666e9ae71a5792e2ab5ec458778b26d`; release ID `20261017T215744Z`; activated at `2026-10-17T22:00:30Z`.
- Manage funds shows the complete wallet address first with Copy address/Copied feedback, then separate highlighted USDC/EURC balances. Manual address selection is available if clipboard access fails. Funding and withdrawal handlers are unchanged.
- Local clipboard instrumentation confirmed the exact address argument reached a successful native clipboard write. Standard and narrow layouts were checked. The Linux production build and all 84 tests passed; authenticated hosted checks verified address ordering, full-address display, copy control, both currency cards, and existing funding buttons.
- Release logs/metadata: `/opt/payme/releases/20261017T215744Z/`. Rollback source/build: `/var/backups/payme/releases/20261017T215744Z/`. Local source archive, scripts, and visual checks are in ignored `cache/releases/20261017T215744Z/`. Runtime business state and credentials were preserved.

## Dismiss and historical email fix — 17 October 2026

- Active application revision: `b77ff53df9f3ff02cc983a501897aadceccbfe0c`; release ID `20261017T211553Z`; activated at `2026-10-17T21:19:52Z`.
- Staged Linux production build and all **84 tests** passed. The blocked-invoice Dismiss action is filled blue and full width.
- `node scripts/recover-mail.ts` previews completed email queue records; `--apply` restores missing mail records and copies retained invoice files under their original owner. It skips existing messages and never queues, processes, or pays invoices. Repeated preview after applying reported zero remaining messages.
- Five earlier emails across two accounts were restored with all five attachments. Records are marked recovered; original bodies, recipient lists, and attachment names were not saved, so the UI explains this and uses generated attachment labels. Incoming emails continue to use full-message storage.
- Hosted checks verified both inboxes, recovered-message explanations, Dismiss rendering, attachment byte hashes, and owner-only downloads (401 without a session, 404 for the other owner). Original queue/upload SHA-256 hashes were unchanged.
- `/var/backups/payme/releases/20261017T211553Z/` holds `source-before.tar.gz`, `next-before/`, a protected `state-before-mail-recovery.tar.gz` (business data and receipts), and `legacy-files.sha256`. The state archive contains private business records and stays on the server. `.env` was not included. Release logs/metadata are under `/opt/payme/releases/20261017T211553Z/`.

## Initial Payme UI release — 17 October 2026

- Application revision: `1002e6c570a000b07a2995eac4e25228cf36037b`; release ID `20261017T205115Z`; activated at `2026-10-17T20:55:08Z`.
- Staging/build log and release metadata: `/opt/payme/releases/20261017T205115Z/`. The active build is now `/opt/payme/app/.next`; `.release.json` records its revision.
- Rollback: `/var/backups/payme/releases/20261017T205115Z/source-before.tar.gz` and `next-before/`. The archive excludes credentials and business state. The release script also restores the previous build if activation health checks fail.
- Linux production build and all 80 tests passed before activation. Public checks passed for sign-in/assets, authentication/origin restrictions, all three authenticated workspace tabs, an existing v3 vault with USDC/EURC panels, and real-model chat with retry persistence. Temporary test records were removed. Web, scheduler, and tunnel were active after verification.
- Local archive, promotion script, verification script, and hosted sign-in screenshot are retained in ignored `cache/releases/20261017T205115Z/`. No contract redeployment occurred. Real-wallet funding and a fresh invoice-email test remain separate checks.

## Current state and local refresh

Last reconciled 17 October 2026. Host `13.220.6.36` was reached with `ssh -i ~/.ssh/payme-lightsail.pem ubuntu@13.220.6.36`; web, scheduler, and Cloudflare tunnel reported active. SSH remains intermittent. The AWS CLI session was expired at the earlier check and was not renewed; no firewall change was needed for the successful refresh.

The server is the authority for business records, invoice uploads, queued mail, pending approvals, decisions, and owner answers. Local `data/` and `receipts/` were refreshed from a snapshot captured at **12:59 PM PDT** (`2026-10-17T19:59:08Z`) on 17 October: 22 regular files, stable before/after server hashes, safe archive paths, valid JSON/JSONL, and matching installed SHA-256 hashes. The tracked synthetic fixture was preserved. Do not run a second local scheduler against this snapshot.

The new snapshot/archive/manifests and prior local directories are retained in ignored `cache/state-refresh/20261017T195832Z/`; original directories are under `before/`. The earlier 19-file archive at `cache/state-refresh/20261017T172247Z/local-before.tar.gz` remains available too. No credentials were included. The Payme template UI and typed chat were subsequently deployed at **1:55 PM PDT** (`2026-10-17T20:55:08Z`), application revision `1002e6c570a000b07a2995eac4e25228cf36037b`.

To refresh local state safely:

1. Restore AWS access and inspect the instance's current IP and port rules. SSH is restricted to a single client IP; if that IP changed, update only the SSH rule and retain the other rules.
2. Back up the existing local `data/` and `receipts/` in an ignored directory such as `cache/state-refresh/<capture-time>/before/`.
3. Download only `data/` and `receipts/` into a separate ignored staging directory. Keep `.env`, keys, and tunnel credentials out of the archive. Capture file hashes before and after the remote archive and retry if files changed during capture.
4. Validate archive paths, JSON/JSONL parsing, file counts, and checksums before replacing local business state. Preserve the tracked synthetic `data/test-business.json` fixture separately.
5. Record the capture time, file counts, and hashes in an ignored local manifest. Retain the previous local snapshot until validation is complete.

A downloaded snapshot is for inspection and local UI work. The hosted scheduler continues to change state, so a snapshot does not make the local machine an authoritative payment runner.
