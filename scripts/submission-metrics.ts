// Read-only. Prints aggregates only; never sends payments or exports private records.
import { existsSync, readFileSync } from "node:fs";
import { decodeEventLog, parseAbi, type Hex } from "viem";
import { publicClient } from "../src/arc.ts";
import { summarizeDevelopment, type ConfirmedPayment, type MetricReceipt, type MetricResolution } from "../src/submission/metrics.ts";

let malformedLines = 0;
function lines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line) as T]; } catch { malformedLines++; return []; }
  });
}
const receipts = lines<MetricReceipt>("receipts/decisions.jsonl");
const resolutions = lines<MetricResolution>("receipts/resolutions.jsonl");
const hashes = new Set([...receipts.filter((receipt) => !receipt.dryRun), ...resolutions].flatMap((record) => record.payment?.status === "paid" && record.payment.txHash ? [record.payment.txHash.toLowerCase()] : []));
const v3 = parseAbi(["event Paid(uint256 indexed ruleId, bytes32 indexed invoiceId, address indexed payee, address token, uint256 amount, uint256 periodIndex)"]);
const v2 = parseAbi(["event Paid(uint256 indexed ruleId, bytes32 indexed invoiceId, address indexed payee, uint256 amount, uint256 periodIndex)"]);
const confirmed: ConfirmedPayment[] = [];
let unavailableTransactions = 0;
for (const hash of hashes) {
  try {
    const transaction = await publicClient.getTransactionReceipt({ hash: hash as Hex });
    if (transaction.status !== "success") continue;
    for (const log of transaction.logs) {
      for (const abi of [v3, v2]) {
        try {
          const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
          const args = event.args as { invoiceId: string; token?: string; amount: bigint };
          confirmed.push({ vault: log.address, invoiceId: args.invoiceId, txHash: hash, token: args.token ?? "0x3600000000000000000000000000000000000000", amount: args.amount.toString() });
          break;
        } catch { /* Other event or vault version. */ }
      }
    }
  } catch { unavailableTransactions++; }
}
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...summarizeDevelopment(receipts, resolutions, confirmed), malformedLines, unavailableTransactions, note: "Development/testnet activity only. Customer adoption is owner-reported separately. Values require a successful on-chain Paid event matching the recorded vault, invoice ID and transaction. Legacy standalone cycle logs are excluded." }, null, 2));
