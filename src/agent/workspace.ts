// A business's off-chain record: its vault, and which supplier each on-chain rule
// belongs to. In the app this lives in Postgres; for now it is one JSON file per business.
import { readFileSync } from "node:fs";
import type { Address } from "viem";

export type Supplier = {
  name: string;
  aliases?: string[];
  address: Address; // where the supplier's rule pays
  ruleId: number;
  terms: string; // the agreed terms, as the owner approved them
};

export type Workspace = {
  business: string;
  vault: Address;
  suppliers: Supplier[];
};

export function loadWorkspace(path: string): Workspace {
  return JSON.parse(readFileSync(path, "utf8")) as Workspace;
}
