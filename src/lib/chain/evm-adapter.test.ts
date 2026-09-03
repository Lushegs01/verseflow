/**
 * The live adapter's network preflight.
 *
 * `chainId` is configuration, and configuration can be wrong. It is stamped into every
 * transaction handed to a wallet, so a value that disagrees with the endpoint produces a
 * transaction signed against a network the escrow was never deployed on. These tests hold
 * the adapter to refusing in that case rather than building the transaction anyway.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EvmVerseAdapter } from "./evm-adapter";
import { ChainError } from "./adapter";

const ESCROW = "0x1111111111111111111111111111111111111111";
const CONFIGURED_CHAIN = 9372;

/** Minimal JSON-RPC endpoint. Records what was asked so caching can be asserted. */
function stubRpc(responses: { chainId: number; code: string }) {
  const calls: string[] = [];

  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const requests = Array.isArray(body) ? body : [body];

    const reply = requests.map((req: { id: number; method: string }) => {
      calls.push(req.method);
      switch (req.method) {
        case "eth_chainId":
          return { jsonrpc: "2.0", id: req.id, result: `0x${responses.chainId.toString(16)}` };
        case "eth_getCode":
          return { jsonrpc: "2.0", id: req.id, result: responses.code };
        default:
          return { jsonrpc: "2.0", id: req.id, result: null };
      }
    });

    return new Response(JSON.stringify(Array.isArray(body) ? reply : reply[0]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  return calls;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SETTLEMENT_MODE = "live";
  process.env.VERSE_RPC_URL = "https://rpc.example.test";
  process.env.VERSE_ESCROW_ADDRESS = ESCROW;
  process.env.NEXT_PUBLIC_VERSE_CHAIN_ID = String(CONFIGURED_CHAIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SETTLEMENT_MODE;
  delete process.env.VERSE_RPC_URL;
  delete process.env.VERSE_ESCROW_ADDRESS;
  delete process.env.NEXT_PUBLIC_VERSE_CHAIN_ID;
});

const release = () => ({
  onChainId: `0x${"ab".repeat(32)}`,
  milestoneIndex: 0,
  amount: 150_000,
  asset: "USDC",
});

describe("live adapter network preflight", () => {
  it("refuses to build a transaction when the RPC is on a different chain", async () => {
    stubRpc({ chainId: 1, code: "0xdeadbeef" });
    const adapter = new EvmVerseAdapter();

    await expect(adapter.prepareRelease(release() as never)).rejects.toThrow(ChainError);
    await expect(adapter.prepareRelease(release() as never)).rejects.toThrow(/does not match/i);
  });

  it("names both chains so the misconfiguration is actionable", async () => {
    stubRpc({ chainId: 1, code: "0xdeadbeef" });
    const adapter = new EvmVerseAdapter();

    const error = await adapter.prepareRelease(release() as never).catch((e) => e);
    expect(error.message).toContain(String(CONFIGURED_CHAIN));
    expect(error.message).toContain("chain 1");
  });

  it("refuses when the escrow address holds no code", async () => {
    stubRpc({ chainId: CONFIGURED_CHAIN, code: "0x" });
    const adapter = new EvmVerseAdapter();

    await expect(adapter.prepareRelease(release() as never)).rejects.toThrow(/no contract code/i);
  });

  it("builds the transaction once the network checks out", async () => {
    stubRpc({ chainId: CONFIGURED_CHAIN, code: "0xdeadbeef" });
    const adapter = new EvmVerseAdapter();

    const tx = await adapter.prepareRelease(release() as never);
    // `to` is nullable because the simulated adapter has no contract to call.
    // The live one always does, so state that separately rather than assuming
    // it -- a null here would be a real defect, and it should say so.
    expect(tx.to).not.toBeNull();
    expect(tx.to?.toLowerCase()).toBe(ESCROW);
    expect(tx.chainId).toBe(CONFIGURED_CHAIN);
    expect(tx.simulatedReceipt).toBeNull();
  });

  it("checks the network once, not on every call", async () => {
    const calls = stubRpc({ chainId: CONFIGURED_CHAIN, code: "0xdeadbeef" });
    const adapter = new EvmVerseAdapter();

    await adapter.prepareRelease(release() as never);
    await adapter.prepareRelease(release() as never);
    await adapter.prepareEvidenceAnchor({
      onChainId: `0x${"ab".repeat(32)}`,
      milestoneIndex: 0,
      round: 1,
      bundleHash: `0x${"cd".repeat(32)}`,
    } as never);

    expect(calls.filter((c) => c === "eth_chainId")).toHaveLength(1);
  });

  it("retries the check after a failure rather than caching the outage", async () => {
    // A transient RPC failure must not disable settlement for the adapter's lifetime.
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection reset");
    });
    const adapter = new EvmVerseAdapter();
    await expect(adapter.prepareRelease(release() as never)).rejects.toThrow();

    vi.unstubAllGlobals();
    stubRpc({ chainId: CONFIGURED_CHAIN, code: "0xdeadbeef" });

    const tx = await adapter.prepareRelease(release() as never);
    expect(tx.chainId).toBe(CONFIGURED_CHAIN);
  });
});
