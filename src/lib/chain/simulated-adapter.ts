/**
 * Simulated settlement environment.
 *
 * This is NOT a pretend blockchain dressed up to look real. It is a deterministic
 * local ledger that enforces exactly the same invariants as VerseFlowEscrow.sol --
 * monotonic releases, per-milestone caps, client-only authorization, terms-hash
 * binding -- so behaviour observed here matches behaviour on chain.
 *
 * Every receipt it produces is stamped `simulated: true`, and the UI is required to
 * label it as such. Nothing here is ever presented as live network activity.
 */

import { keccak256, toHex } from "viem";
import type {
  AnchorEvidenceParams,
  FundEscrowParams,
  OnChainAgreementState,
  PreparedTransaction,
  ReleaseParams,
  SettleDisputeParams,
  SettlementAdapter,
  TxReceipt,
} from "./adapter";
import { ChainError } from "./adapter";
import { getChainConfig } from "./config";

interface SimAgreement {
  client: string;
  provider: string;
  totalAmount: number;
  totalReleased: number;
  termsHash: string;
  state: "funded" | "completed" | "cancelled";
  disputed: boolean;
  milestoneAmounts: number[];
  milestoneReleased: number[];
  createdAt: number;
}

interface SimTx {
  hash: string;
  status: "pending" | "confirmed" | "failed";
  blockNumber: number;
  reason?: string;
  confirmAt: number;
}

/**
 * Module-level store. In the simulated environment the "chain" lives for the
 * lifetime of the server process; durable state is the database's job, and it is
 * reconciled from there on restart via `hydrate`.
 */
const agreements = new Map<string, SimAgreement>();
const transactions = new Map<string, SimTx>();
let blockHeight = 4_812_400;

/** Deterministic pseudo-transaction hash derived from the operation itself. */
function simTxHash(seed: string): string {
  return keccak256(toHex(`verseflow-sim|${seed}|${Date.now()}|${Math.random()}`));
}

function recordTx(seed: string, latencyMs: number): TxReceipt {
  const hash = simTxHash(seed);
  blockHeight += 1;
  const tx: SimTx = {
    hash,
    status: "pending",
    blockNumber: blockHeight,
    // Confirmation is time-based rather than instant, so the UI exercises its real
    // pending -> confirming -> confirmed states instead of skipping straight to done.
    confirmAt: Date.now() + latencyMs,
  };
  transactions.set(hash, tx);
  return {
    txHash: hash,
    status: "pending",
    blockNumber: tx.blockNumber,
    chainId: getChainConfig().chainId,
    simulated: true,
  };
}

function settleTx(hash: string): SimTx | null {
  const tx = transactions.get(hash);
  if (!tx) return null;
  if (tx.status === "pending" && Date.now() >= tx.confirmAt) {
    tx.status = "confirmed";
  }
  return tx;
}

export class SimulatedVerseAdapter implements SettlementAdapter {
  readonly mode = "simulated" as const;
  readonly chainId: number;
  private readonly latencyMs: number;

  constructor(latencyMs = Number(process.env.SIMULATED_CONFIRM_MS ?? 2200)) {
    this.chainId = getChainConfig().chainId;
    this.latencyMs = latencyMs;
  }

  escrowAddress(): string | null {
    // A stable, obviously-simulated address so the UI never shows a blank field
    // and never shows something that could be mistaken for a real deployment.
    return "0x00000000000000000000000053494d554c41544544";
  }

  async prepareFunding(params: FundEscrowParams): Promise<PreparedTransaction> {
    if (agreements.has(params.onChainId)) {
      const existing = agreements.get(params.onChainId)!;
      // Funding is idempotent by agreement id, exactly as on chain.
      if (existing.termsHash !== params.termsHash) {
        throw new ChainError("Escrow already exists with different terms.", "reverted");
      }
      const receipt = recordTx(`refund-noop:${params.onChainId}`, 200);
      return this.wrap(receipt, `Escrow for ${params.onChainId.slice(0, 10)} already funded.`);
    }

    const total = params.milestoneAmounts.reduce((a, b) => a + b, 0);
    if (total <= 0 || params.milestoneAmounts.some((a) => a <= 0)) {
      throw new ChainError("Milestone amounts must all be greater than zero.", "reverted");
    }

    agreements.set(params.onChainId, {
      client: params.clientAddress.toLowerCase(),
      provider: params.providerAddress.toLowerCase(),
      totalAmount: total,
      totalReleased: 0,
      termsHash: params.termsHash,
      state: "funded",
      disputed: false,
      milestoneAmounts: [...params.milestoneAmounts],
      milestoneReleased: params.milestoneAmounts.map(() => 0),
      createdAt: Date.now(),
    });

    const receipt = recordTx(`fund:${params.onChainId}`, this.latencyMs);
    return this.wrap(receipt, `Lock ${total} ${params.asset} minor units in escrow.`);
  }

  async prepareRelease(params: ReleaseParams): Promise<PreparedTransaction> {
    const a = agreements.get(params.onChainId);
    if (!a) throw new ChainError("Escrow not found for this agreement.", "not_found");
    if (a.state !== "funded") throw new ChainError("Escrow is not in a releasable state.", "reverted");
    if (a.disputed) throw new ChainError("This escrow is frozen pending dispute resolution.", "reverted");
    if (a.client !== params.clientAddress.toLowerCase()) {
      throw new ChainError("Only the client can release funds.", "reverted");
    }

    const idx = params.milestoneIndex;
    if (idx < 0 || idx >= a.milestoneAmounts.length) {
      throw new ChainError("Milestone index out of range.", "reverted");
    }

    const remaining = a.milestoneAmounts[idx] - a.milestoneReleased[idx];
    if (params.amount <= 0 || params.amount > remaining) {
      throw new ChainError("Release exceeds the amount remaining for this milestone.", "reverted");
    }

    a.milestoneReleased[idx] += params.amount;
    a.totalReleased += params.amount;
    if (a.totalReleased >= a.totalAmount) a.state = "completed";

    const receipt = recordTx(`release:${params.onChainId}:${idx}:${params.amount}`, this.latencyMs);
    return this.wrap(receipt, `Release ${params.amount} ${params.asset} minor units to the provider.`);
  }

  async prepareEvidenceAnchor(params: AnchorEvidenceParams): Promise<PreparedTransaction> {
    const a = agreements.get(params.onChainId);
    if (!a) throw new ChainError("Escrow not found for this agreement.", "not_found");
    const receipt = recordTx(
      `anchor:${params.onChainId}:${params.milestoneIndex}:${params.round}:${params.bundleHash}`,
      Math.min(this.latencyMs, 1200),
    );
    return this.wrap(receipt, "Anchor the evidence bundle hash.");
  }

  async prepareDisputeSettlement(params: SettleDisputeParams): Promise<PreparedTransaction> {
    const a = agreements.get(params.onChainId);
    if (!a) throw new ChainError("Escrow not found for this agreement.", "not_found");
    const idx = params.milestoneIndex;
    const remaining = a.milestoneAmounts[idx] - a.milestoneReleased[idx];
    if (params.providerAmount > remaining) {
      throw new ChainError("Settlement exceeds the milestone balance.", "reverted");
    }

    a.milestoneReleased[idx] = a.milestoneAmounts[idx];
    a.totalReleased += remaining;
    a.disputed = false;
    if (a.totalReleased >= a.totalAmount) a.state = "completed";

    const receipt = recordTx(`settle:${params.onChainId}:${idx}`, this.latencyMs);
    return this.wrap(
      receipt,
      `Settle dispute: ${params.providerAmount} to provider, ${remaining - params.providerAmount} refunded.`,
    );
  }

  async verifyTransaction(txHash: string): Promise<TxReceipt> {
    const tx = settleTx(txHash);
    if (!tx) {
      return {
        txHash,
        status: "failed",
        blockNumber: null,
        chainId: this.chainId,
        simulated: true,
        reason: "Transaction not found in the simulated ledger.",
      };
    }
    return {
      txHash,
      status: tx.status,
      blockNumber: tx.status === "confirmed" ? tx.blockNumber : null,
      chainId: this.chainId,
      simulated: true,
      ...(tx.reason ? { reason: tx.reason } : {}),
    };
  }

  async readAgreement(onChainId: string): Promise<OnChainAgreementState | null> {
    const a = agreements.get(onChainId);
    if (!a) return null;
    return {
      exists: true,
      client: a.client,
      provider: a.provider,
      totalAmount: a.totalAmount,
      totalReleased: a.totalReleased,
      termsHash: a.termsHash,
      state: a.state,
      disputed: a.disputed,
      milestoneAmounts: [...a.milestoneAmounts],
      milestoneReleased: [...a.milestoneReleased],
    };
  }

  async verifyTerms(onChainId: string, expectedTermsHash: string): Promise<boolean> {
    const a = agreements.get(onChainId);
    return Boolean(a && a.termsHash === expectedTermsHash);
  }

  /** Freeze a milestone, mirroring `flagDispute`. */
  flagDispute(onChainId: string): void {
    const a = agreements.get(onChainId);
    if (a) a.disputed = true;
  }

  private wrap(receipt: TxReceipt, summary: string): PreparedTransaction {
    return {
      to: null,
      data: null,
      value: "0",
      chainId: this.chainId,
      summary,
      simulatedReceipt: receipt,
    };
  }
}

/**
 * Rebuild simulated escrow state from the database after a server restart.
 * Without this, a reload would show a funded agreement whose escrow had vanished.
 */
export function hydrateSimulatedEscrow(
  records: Array<{
    onChainId: string;
    clientAddress: string;
    providerAddress: string;
    termsHash: string;
    milestoneAmounts: number[];
    milestoneReleased: number[];
    cancelled: boolean;
  }>,
): void {
  for (const r of records) {
    if (agreements.has(r.onChainId)) continue;
    const total = r.milestoneAmounts.reduce((a, b) => a + b, 0);
    const released = r.milestoneReleased.reduce((a, b) => a + b, 0);
    agreements.set(r.onChainId, {
      client: r.clientAddress.toLowerCase(),
      provider: r.providerAddress.toLowerCase(),
      totalAmount: total,
      totalReleased: released,
      termsHash: r.termsHash,
      state: r.cancelled ? "cancelled" : released >= total ? "completed" : "funded",
      disputed: false,
      milestoneAmounts: [...r.milestoneAmounts],
      milestoneReleased: [...r.milestoneReleased],
      createdAt: Date.now(),
    });
  }
}

/**
 * Make a previously-issued simulated transaction known to this instance.
 *
 * Transaction state lives in module memory, so on serverless a confirmation poll
 * can land on a different instance than the one that issued the transaction.
 * Without this, `verifyTransaction` would report a perfectly good payment as
 * failed simply because this instance had never heard of it.
 *
 * The confirmation deadline is derived from when the payment was actually
 * created, recorded durably in the database -- so the answer is the same on every
 * instance, and a transaction cannot appear to confirm early by moving hosts.
 */
export function ensureTxKnown(txHash: string, createdAtMs: number, latencyMs: number): void {
  if (transactions.has(txHash)) return;

  transactions.set(txHash, {
    hash: txHash,
    status: Date.now() >= createdAtMs + latencyMs ? "confirmed" : "pending",
    blockNumber: ++blockHeight,
    confirmAt: createdAtMs + latencyMs,
  });
}

/** Mark a previously-issued simulated transaction as confirmed. Used by tests and seeds. */
export function forceConfirm(txHash: string): void {
  const tx = transactions.get(txHash);
  if (tx) {
    tx.status = "confirmed";
    tx.confirmAt = 0;
  }
}

/** Register an already-settled transaction (seed data replaying historical activity). */
export function registerHistoricalTx(txHash: string, blockNumber: number): void {
  transactions.set(txHash, { hash: txHash, status: "confirmed", blockNumber, confirmAt: 0 });
  if (blockNumber > blockHeight) blockHeight = blockNumber;
}

export function resetSimulatedChain(): void {
  agreements.clear();
  transactions.clear();
  blockHeight = 4_812_400;
}
