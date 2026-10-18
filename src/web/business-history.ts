import { decisionsFor } from "./activity.ts";
import { resolutionsFor } from "./resolutions.ts";
import type { Business } from "./store.ts";

export function businessHistory(business: Business) {
  const vaults = [business.vault, ...(business.previousVaults ?? []).map((p) => p.vault)];
  return {
    decisions: vaults.flatMap(decisionsFor).sort((a, b) => a.at.localeCompare(b.at)),
    answers: new Map(vaults.flatMap((v) => [...resolutionsFor(v)])),
  };
}
