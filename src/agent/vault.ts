// Reads what the agent needs from a vault on chain.
import { erc20Abi, type Address, type Hex } from "viem";
import { TOKENS, TOKEN_SYMBOLS, publicClient, type TokenSymbol } from "../arc.ts";
import { vaultAbi } from "../rules.ts";

export type RuleState = {
  id: number;
  payee: Address;
  token: Address;
  budget: bigint;
  period: bigint;
  startsAt: bigint;
  expiresAt: bigint;
  active: boolean;
  remaining: bigint; // what can still be paid this period
};

/** One token in the vault: what it holds and what the cap still allows. */
export type Funds = { token: Address; balance: bigint; capRemaining: bigint };

export type VaultState = {
  chainTime: bigint;
  funds: Record<TokenSymbol, Funds>;
  expiresAt: bigint;
  rules: Map<number, RuleState>;
};

const read = (vault: Address, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: vault, abi: vaultAbi, functionName, args });

async function fundsOf(vault: Address, symbol: TokenSymbol): Promise<Funds> {
  const token = TOKENS[symbol].address;
  const [balance, capRemaining] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
    read(vault, "capRemaining", [token]) as Promise<bigint>,
  ]);
  return { token, balance, capRemaining };
}

export async function readVaultState(vault: Address): Promise<VaultState> {
  const [{ timestamp }, funds, expiresAt, ruleCount] = await Promise.all([
    publicClient.getBlock(),
    Promise.all(TOKEN_SYMBOLS.map((s) => fundsOf(vault, s))),
    read(vault, "expiresAt") as Promise<bigint>,
    read(vault, "ruleCount") as Promise<bigint>,
  ]);
  const rules = new Map<number, RuleState>();
  for (let id = 1; id <= Number(ruleCount); id++) {
    const [[terms, active], remaining] = await Promise.all([
      read(vault, "rule", [BigInt(id)]) as Promise<
        [{ payee: Address; token: Address; budget: bigint; period: bigint; startsAt: bigint; expiresAt: bigint }, boolean]
      >,
      read(vault, "ruleRemaining", [BigInt(id)]) as Promise<bigint>,
    ]);
    rules.set(id, { id, ...terms, active, remaining });
  }
  return {
    chainTime: timestamp,
    funds: Object.fromEntries(TOKEN_SYMBOLS.map((s, i) => [s, funds[i]])) as Record<TokenSymbol, Funds>,
    expiresAt,
    rules,
  };
}

export const isInvoicePaid = (vault: Address, invoiceId: Hex) =>
  read(vault, "invoicePaid", [invoiceId]) as Promise<boolean>;

export const payeeActiveAt = (vault: Address, payee: Address) =>
  read(vault, "payeeActiveAt", [payee]) as Promise<bigint>;
