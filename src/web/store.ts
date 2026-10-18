// Business records, one JSON file per owner. A business record is the agent's
// Workspace plus who owns it. Postgres replaces this when there is more than a handful.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import type { Workspace } from "../agent/workspace.ts";

export type Business = Workspace & {
  ownerId: string; // Circle user id
  ownerEmail: string;
  ownerWalletId: string;
  ownerAddress: Address;
  vaultTx: Hex;
  createdAt: string;
  inboxKey?: string; // private part of the business's invoice email address
  vaultVersion?: number; // 3 pays USDC and EURC; absent means a v2 vault (USDC only), which must move
  previousVaults?: { vault: Address; suppliers: Workspace["suppliers"]; movedAt: string }[];
};

/** Vault v3 can pay USDC and EURC. Older (v2) vaults must move to a new one before Payer uses them. */
export const CURRENT_VAULT_VERSION = 3;
export const needsNewVault = (b: Business) => (b.vaultVersion ?? 2) < CURRENT_VAULT_VERSION;

const DIR = "data/businesses";
const pathFor = (ownerId: string) => `${DIR}/${ownerId.replace(/[^a-zA-Z0-9-]/g, "")}.json`;

export function getBusiness(ownerId: string): Business | null {
  const path = pathFor(ownerId);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Business) : null;
}

export function listBusinesses(): Business[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as Business);
}

export function saveBusiness(business: Business) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(pathFor(business.ownerId), JSON.stringify(business, null, 2) + "\n");
}
