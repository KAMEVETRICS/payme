// The agent's decisions for one vault, from the receipts log.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Address } from "viem";
import { DECISIONS_LOG, type Receipt } from "../agent/process.ts";

/** A receipt's id. Receipts written before ids existed get one derived from when and what. */
export function receiptIdOf(r: Receipt): string {
  return r.id ?? createHash("sha256").update(`${r.at}|${r.file}`).digest("hex").slice(0, 32);
}

/** Every real (not dry-run) decision for a vault, oldest first. */
export function decisionsFor(vault: Address): Receipt[] {
  if (!existsSync(DECISIONS_LOG)) return [];
  const mine: Receipt[] = [];
  for (const line of readFileSync(DECISIONS_LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Receipt;
      if (r.vault?.toLowerCase() === vault.toLowerCase() && !r.dryRun) mine.push(r);
    } catch {
      // Skip a partly written line.
    }
  }
  return mine;
}

export function findDecision(vault: Address, receiptId: string): Receipt | undefined {
  return decisionsFor(vault).find((r) => receiptIdOf(r) === receiptId);
}
