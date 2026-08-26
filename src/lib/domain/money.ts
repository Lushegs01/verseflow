/**
 * Money. All monetary values in VerseFlow are integer minor units (cents / wei-scaled).
 * Floating point is never used for money. Ever.
 */

export type Asset = {
  symbol: string;
  name: string;
  /** Decimals used for on-chain representation. */
  decimals: number;
  /** Minor units used for display accounting (2 for USD/EUR-style). */
  displayDecimals: number;
  /** ERC-20 address on the settlement chain, or null for the native coin. */
  address: string | null;
  kind: "stablecoin" | "native";
};

export const ASSETS: Record<string, Asset> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    displayDecimals: 2,
    address: process.env.NEXT_PUBLIC_VERSE_USDC_ADDRESS ?? null,
    kind: "stablecoin",
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    decimals: 6,
    displayDecimals: 2,
    address: process.env.NEXT_PUBLIC_VERSE_EURC_ADDRESS ?? null,
    kind: "stablecoin",
  },
  OAS: {
    symbol: "OAS",
    name: "Oasys",
    decimals: 18,
    displayDecimals: 2,
    address: null,
    kind: "native",
  },
};

export const DEFAULT_ASSET = "USDC";

export function getAsset(symbol: string): Asset {
  const a = ASSETS[symbol];
  if (!a) throw new Error(`Unknown asset: ${symbol}`);
  return a;
}

const SYMBOL_PREFIX: Record<string, string> = { USDC: "$", EURC: "€" };

/** Format integer minor units for display, e.g. 150000 + USDC -> "$1,500.00" */
export function formatMoney(
  minor: number,
  assetSymbol: string = DEFAULT_ASSET,
  opts: { compact?: boolean; showSymbol?: boolean } = {},
): string {
  const asset = getAsset(assetSymbol);
  const { compact = false, showSymbol = true } = opts;
  const divisor = 10 ** asset.displayDecimals;
  const value = minor / divisor;
  const prefix = SYMBOL_PREFIX[asset.symbol] ?? "";

  if (compact && Math.abs(value) >= 1000) {
    const formatted = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
    return showSymbol ? `${prefix}${formatted}${prefix ? "" : ` ${asset.symbol}`}` : formatted;
  }

  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 && compact ? 0 : asset.displayDecimals,
    maximumFractionDigits: asset.displayDecimals,
  }).format(value);

  if (!showSymbol) return formatted;
  return prefix ? `${prefix}${formatted}` : `${formatted} ${asset.symbol}`;
}

/** Parse user input ("1,500.50", "$1500.5") into integer minor units. Throws on invalid input. */
export function parseMoney(input: string, assetSymbol: string = DEFAULT_ASSET): number {
  const asset = getAsset(assetSymbol);
  const cleaned = String(input).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") {
    throw new Error("Enter a valid amount.");
  }
  if ((cleaned.match(/\./g) ?? []).length > 1) throw new Error("Enter a valid amount.");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error("Enter a valid amount.");
  if (value < 0) throw new Error("Amount cannot be negative.");
  // Round half-up at the display precision, then convert to integer minor units.
  const scaled = Math.round(value * 10 ** asset.displayDecimals);
  if (!Number.isSafeInteger(scaled)) throw new Error("Amount is too large.");
  return scaled;
}

/** Convert display minor units into the on-chain base-unit string (decimal-safe, no float). */
export function toChainUnits(minor: number, assetSymbol: string = DEFAULT_ASSET): bigint {
  const asset = getAsset(assetSymbol);
  const exponent = asset.decimals - asset.displayDecimals;
  if (exponent < 0) throw new Error("Unsupported asset precision.");
  return BigInt(Math.round(minor)) * 10n ** BigInt(exponent);
}

/** Convert on-chain base units back into display minor units. */
export function fromChainUnits(base: bigint, assetSymbol: string = DEFAULT_ASSET): number {
  const asset = getAsset(assetSymbol);
  const exponent = BigInt(asset.decimals - asset.displayDecimals);
  return Number(base / 10n ** exponent);
}

/**
 * Split a total into `count` parts whose sum is exactly the total.
 * Remainder minor units are distributed to the earliest parts so nothing is lost.
 */
export function splitEvenly(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Apply a percentage (0-100) to a minor-unit amount, rounding half-up, clamped to [0, amount]. */
export function percentOf(amountMinor: number, percent: number): number {
  const raw = Math.round((amountMinor * percent) / 100);
  return Math.min(Math.max(raw, 0), amountMinor);
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
