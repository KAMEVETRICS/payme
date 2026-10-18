// Rules the owner has been asked to sign but has not confirmed yet.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { RuleTerms } from "../rules.ts";

export type PendingRule = {
  id: string;
  ownerId: string;
  // A standing rule for a new supplier, or a one-off rule to pay one invoice the agent asked about.
  purpose: { kind: "supplier"; name: string; terms: string } | { kind: "invoice"; receiptId: string };
  terms: RuleTerms;
  challengeId: string; // the Circle signing request the owner approves
  createdAt: string;
};

const DIR = "data/pending";
const pathFor = (id: string) => `${DIR}/${id.replace(/[^a-zA-Z0-9-]/g, "")}.json`;
const BIGINTS = ["budget", "period", "startsAt", "expiresAt"] as const;

export function savePending(p: PendingRule) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(pathFor(p.id), JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

export function takePending(id: string, ownerId: string): PendingRule | null {
  const path = pathFor(id);
  if (!existsSync(path)) return null;
  const p = JSON.parse(readFileSync(path, "utf8")) as PendingRule;
  if (p.ownerId !== ownerId) return null;
  for (const k of BIGINTS) (p.terms as Record<string, unknown>)[k] = BigInt(p.terms[k] as unknown as string);
  return p;
}

export function dropPending(id: string) {
  rmSync(pathFor(id), { force: true });
}
