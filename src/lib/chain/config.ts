/**
 * Settlement network configuration.
 *
 * Verse is an EVM-compatible OP Stack L2, so every chain-specific value here is a
 * plain environment variable. Pointing VerseFlow at a live Verse deployment means
 * setting these -- no code changes, no redeploy of application logic.
 */

import { defineChain } from "viem";

export type SettlementMode = "simulated" | "live";

export interface VerseChainConfig {
  mode: SettlementMode;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  escrowAddress: string | null;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Blocks to wait before treating a transaction as final. */
  confirmations: number;
}

function readInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * `live` requires an RPC endpoint AND a deployed escrow address. If either is
 * missing we stay in `simulated` mode rather than pretending to be on a network,
 * because a product that reports fake confirmations is worse than one that is
 * honest about running a local settlement simulation.
 */
export function getChainConfig(): VerseChainConfig {
  const rpcUrl = process.env.VERSE_RPC_URL ?? process.env.NEXT_PUBLIC_VERSE_RPC_URL ?? "";
  const escrowAddress =
    process.env.VERSE_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_VERSE_ESCROW_ADDRESS ?? "";
  const requested = (process.env.NEXT_PUBLIC_SETTLEMENT_MODE ?? "simulated") as SettlementMode;

  const canGoLive = Boolean(rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(escrowAddress);
  const mode: SettlementMode = requested === "live" && canGoLive ? "live" : "simulated";

  return {
    mode,
    chainId: readInt(process.env.NEXT_PUBLIC_VERSE_CHAIN_ID, 20197),
    name: process.env.NEXT_PUBLIC_VERSE_CHAIN_NAME ?? "Verse",
    rpcUrl,
    explorerUrl:
      process.env.NEXT_PUBLIC_VERSE_EXPLORER_URL ?? "https://explorer.verse.example",
    escrowAddress: canGoLive ? escrowAddress : null,
    nativeCurrency: {
      name: process.env.NEXT_PUBLIC_VERSE_CURRENCY_NAME ?? "OAS",
      symbol: process.env.NEXT_PUBLIC_VERSE_CURRENCY_SYMBOL ?? "OAS",
      decimals: 18,
    },
    confirmations: readInt(process.env.VERSE_CONFIRMATIONS, 1),
  };
}

/** viem chain definition, built from the same configuration. */
export function verseChain() {
  const cfg = getChainConfig();
  return defineChain({
    id: cfg.chainId,
    name: cfg.name,
    nativeCurrency: cfg.nativeCurrency,
    rpcUrls: { default: { http: cfg.rpcUrl ? [cfg.rpcUrl] : [] } },
    blockExplorers: { default: { name: `${cfg.name} Explorer`, url: cfg.explorerUrl } },
    testnet: process.env.NEXT_PUBLIC_VERSE_TESTNET === "true",
  });
}

export function explorerTxUrl(txHash: string, cfg = getChainConfig()): string | null {
  if (cfg.mode !== "live") return null;
  return `${cfg.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string, cfg = getChainConfig()): string | null {
  if (cfg.mode !== "live") return null;
  return `${cfg.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

/** Public-safe subset, sent to the browser so the UI can label settlement honestly. */
export function publicChainInfo() {
  const cfg = getChainConfig();
  return {
    mode: cfg.mode,
    chainId: cfg.chainId,
    name: cfg.name,
    explorerUrl: cfg.explorerUrl,
    escrowAddress: cfg.escrowAddress,
    currencySymbol: cfg.nativeCurrency.symbol,
    hasExplorer: cfg.mode === "live",
  };
}
