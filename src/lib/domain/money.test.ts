import { describe, it, expect } from "vitest";
import {
  formatMoney,
  parseMoney,
  splitEvenly,
  percentOf,
  toChainUnits,
  fromChainUnits,
  sum,
} from "./money";

describe("parseMoney", () => {
  it("parses plain and formatted input", () => {
    expect(parseMoney("1500")).toBe(150_000);
    expect(parseMoney("1,500.50")).toBe(150_050);
    expect(parseMoney("$3,000")).toBe(300_000);
    expect(parseMoney("0.01")).toBe(1);
  });

  it("rounds half-up at display precision rather than truncating", () => {
    expect(parseMoney("10.005")).toBe(1001);
    expect(parseMoney("10.004")).toBe(1000);
  });

  it("rejects invalid input instead of silently returning zero", () => {
    expect(() => parseMoney("")).toThrow();
    expect(() => parseMoney("abc")).toThrow();
    expect(() => parseMoney("1.2.3")).toThrow();
    expect(() => parseMoney("-50")).toThrow();
  });
});

describe("formatMoney", () => {
  it("formats with the right symbol and precision", () => {
    expect(formatMoney(150_000, "USDC")).toBe("$1,500.00");
    expect(formatMoney(300_000, "EURC")).toBe("€3,000.00");
    expect(formatMoney(0, "USDC")).toBe("$0.00");
  });

  it("compacts large values", () => {
    expect(formatMoney(4_820_000, "USDC", { compact: true })).toBe("$48.2K");
  });
});

describe("splitEvenly", () => {
  it("never loses or invents a minor unit", () => {
    for (const total of [100, 1000, 999, 1, 7, 300_000, 123_457]) {
      for (const count of [1, 2, 3, 4, 7, 11]) {
        const parts = splitEvenly(total, count);
        expect(parts).toHaveLength(count);
        expect(sum(parts)).toBe(total);
        expect(parts.every((p) => Number.isInteger(p))).toBe(true);
      }
    }
  });

  it("distributes the remainder to the earliest parts", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  });
});

describe("percentOf", () => {
  it("computes a percentage without exceeding the source amount", () => {
    expect(percentOf(150_000, 60)).toBe(90_000);
    expect(percentOf(150_000, 100)).toBe(150_000);
    expect(percentOf(150_000, 150)).toBe(150_000);
    expect(percentOf(150_000, -10)).toBe(0);
  });
});

describe("chain unit conversion", () => {
  it("round-trips through on-chain base units", () => {
    for (const amount of [1, 100, 150_000, 300_000, 4_820_000]) {
      expect(fromChainUnits(toChainUnits(amount, "USDC"), "USDC")).toBe(amount);
    }
  });

  it("scales to the asset decimals", () => {
    // USDC has 6 decimals, display has 2, so 1500.00 -> 1_500_000_000 base units.
    expect(toChainUnits(150_000, "USDC")).toBe(1_500_000_000n);
    // OAS has 18 decimals; 100 minor units is 1.00 OAS.
    expect(toChainUnits(100, "OAS")).toBe(10n ** 18n);
  });
});
