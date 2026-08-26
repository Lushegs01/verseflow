/**
 * Adapter selection. One place decides whether the product is settling on a live
 * Verse network or in the local simulation, and everything downstream is told the
 * answer rather than guessing.
 */

import type { SettlementAdapter } from "./adapter";
import { getChainConfig } from "./config";
import { SimulatedVerseAdapter } from "./simulated-adapter";
import { EvmVerseAdapter } from "./evm-adapter";

let cached: SettlementAdapter | null = null;

export function getSettlementAdapter(): SettlementAdapter {
  if (cached) return cached;
  const cfg = getChainConfig();

  if (cfg.mode === "live") {
    try {
      cached = new EvmVerseAdapter();
      return cached;
    } catch (error) {
      // Falling back is the honest behaviour: a misconfigured live mode must not
      // silently produce transactions that look real. The mode reported to the UI
      // becomes "simulated", so every surface labels itself accordingly.
      console.error("[verseflow] live settlement unavailable, using simulation:", error);
    }
  }

  cached = new SimulatedVerseAdapter();
  return cached;
}

export function resetAdapterCache(): void {
  cached = null;
}

export * from "./adapter";
export { getChainConfig, publicChainInfo, explorerTxUrl, explorerAddressUrl } from "./config";
