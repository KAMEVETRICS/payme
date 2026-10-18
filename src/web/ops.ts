// Keeping Payme's agent wallet able to work. It pays the gas (in USDC on Arc) for every
// vault, rule and payment; if it runs dry, vaults cannot be created and invoices cannot
// be paid. The scheduler calls this each run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther, type Address } from "viem";
import { publicClient, requireEnv } from "../arc.ts";
import { ARC_TESTNET, circleClient } from "../circle.ts";

export const LOW_GAS = 2n * 10n ** 18n;
const STATE = "data/ops.json";
const HOUR = 60 * 60 * 1000;
const FAUCET_EVERY = 12 * HOUR;
const ALERT_EVERY = 6 * HOUR;

type OpsState = { faucetAt?: string; alertAt?: string };
const load = (): OpsState => (existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as OpsState) : {});
const save = (s: OpsState) => {
  mkdirSync("data", { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
};
const since = (iso: string | undefined) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

/** Email whoever runs Payme, through Resend, if RESEND_API_KEY and OPS_EMAIL are set. */
export async function alertOps(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OPS_EMAIL;
  if (!key || !to) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.OPS_FROM ?? "Payme <alerts@deplace.space>", to: to.split(","), subject, text }),
  });
  if (!response.ok) throw new Error(`Resend refused the alert: ${response.status} ${await response.text()}`);
  return true;
}

/**
 * Check the agent wallet's gas. When it is low: on testnet ask Circle's faucet for more
 * (at most every 12 hours), and alert whoever runs Payme (at most every 6 hours).
 * Returns lines for the scheduler log; never throws.
 */
export async function watchAgentGas(): Promise<string[]> {
  const notes: string[] = [];
  try {
    const agent = requireEnv("CIRCLE_AGENT_ADDRESS") as Address;
    const gas = await publicClient.getBalance({ address: agent });
    if (gas >= LOW_GAS) return notes;
    const state = load();
    notes.push(`the agent wallet has ${formatEther(gas)} USDC for gas`);
    if (since(state.faucetAt) > FAUCET_EVERY) {
      state.faucetAt = new Date().toISOString();
      save(state);
      await circleClient()
        .requestTestnetTokens({ address: agent, blockchain: ARC_TESTNET as never, native: true, usdc: true })
        .then(() => notes.push("asked Circle's testnet faucet for more"))
        .catch((err) => notes.push(`Circle's faucet refused: ${err instanceof Error ? err.message : err}`));
    }
    if (since(state.alertAt) > ALERT_EVERY) {
      const sent = await alertOps(
        "Payme: agent wallet is low on gas",
        `Payme's agent wallet ${agent} has ${formatEther(gas)} USDC left for gas. Below 2 USDC, new vaults and payments may fail.\n\n${notes.join("\n")}\n\nTop it up with testnet USDC from https://faucet.circle.com (Arc Testnet).`,
      ).catch((err) => {
        notes.push(`could not send the alert: ${err instanceof Error ? err.message : err}`);
        return false;
      });
      if (sent) {
        state.alertAt = new Date().toISOString();
        save(state);
        notes.push("alert emailed");
      }
    }
  } catch (err) {
    notes.push(`could not check the agent wallet's gas: ${err instanceof Error ? err.message : err}`);
  }
  return notes;
}
