/**
 * Live Verse settlement adapter.
 *
 * Two properties matter most here:
 *
 *  1. The server never holds a private key. Every state-changing call is returned
 *     as an unsigned `PreparedTransaction` for the user's own wallet to sign. The
 *     backend orchestrates; it does not custody.
 *
 *  2. `verifyTransaction` reads the receipt from the chain. A wallet returning a
 *     hash means the transaction was broadcast, not that it succeeded -- so a
 *     payment is only ever marked confirmed after the receipt says `status: success`
 *     and enough confirmations have accumulated.
 */

import { createPublicClient, http, encodeFunctionData, type PublicClient } from "viem";
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
import { getChainConfig, verseChain } from "./config";
import { VERSEFLOW_ESCROW_ABI } from "./abi";
import { getAsset, toChainUnits, fromChainUnits } from "@/lib/domain/money";

const STATE_NAMES = ["none", "funded", "completed", "cancelled"] as const;

export class EvmVerseAdapter implements SettlementAdapter {
  readonly mode = "live" as const;
  readonly chainId: number;
  private readonly client: PublicClient;
  private readonly escrow: `0x${string}`;

  constructor() {
    const cfg = getChainConfig();
    if (!cfg.escrowAddress || !cfg.rpcUrl) {
      throw new ChainError(
        "Live settlement is enabled but VERSE_RPC_URL or VERSE_ESCROW_ADDRESS is missing.",
        "config",
      );
    }
    this.chainId = cfg.chainId;
    this.escrow = cfg.escrowAddress as `0x${string}`;
    this.client = createPublicClient({
      chain: verseChain(),
      transport: http(cfg.rpcUrl, { retryCount: 2, timeout: 15_000 }),
    }) as PublicClient;
  }

  escrowAddress(): string | null {
    return this.escrow;
  }

  /**
   * Confirm the configured network is the network actually being talked to, once.
   *
   * `chainId` comes from the environment and is stamped into every transaction handed
   * to a wallet. If it disagrees with the endpoint -- an RPC swapped without updating
   * the chain id, a Verse layer's value left at another network's -- the wallet signs
   * for a chain the escrow is not deployed on. Checking the escrow address carries
   * code catches the matching mistake of pointing at the right chain but a dead address.
   *
   * Cached as a promise so concurrent callers share one round trip, and cleared on
   * failure so a transient RPC outage does not poison the adapter for its lifetime.
   */
  private preflight: Promise<void> | null = null;

  private async assertNetwork(): Promise<void> {
    this.preflight ??= (async () => {
      const actual = await this.client.getChainId();
      if (actual !== this.chainId) {
        throw new ChainError(
          `Configured chain ${this.chainId} does not match the RPC endpoint, which reports ` +
            `chain ${actual}. Settlement is halted: a transaction built for the wrong chain ` +
            "would be signed against a network the escrow is not deployed on.",
          "config",
        );
      }
      const code = await this.client.getCode({ address: this.escrow });
      if (!code || code === "0x") {
        throw new ChainError(
          `No contract code at ${this.escrow} on chain ${actual}. Check VERSE_ESCROW_ADDRESS.`,
          "config",
        );
      }
    })().catch((error) => {
      this.preflight = null;
      throw error;
    });

    return this.preflight;
  }

  async prepareFunding(params: FundEscrowParams): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const asset = getAsset(params.asset);
    const amounts = params.milestoneAmounts.map((a) => toChainUnits(a, params.asset));
    const total = amounts.reduce((a, b) => a + b, 0n);

    const data = encodeFunctionData({
      abi: VERSEFLOW_ESCROW_ABI,
      functionName: "fundAgreement",
      args: [
        params.onChainId as `0x${string}`,
        params.providerAddress as `0x${string}`,
        (asset.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        amounts,
        params.termsHash as `0x${string}`,
      ],
    });

    return {
      to: this.escrow,
      data,
      // Native settlement sends value; ERC-20 settlement requires a prior approve().
      value: asset.address === null ? total.toString() : "0",
      chainId: this.chainId,
      summary: `Lock the full contract value in escrow on ${getChainConfig().name}.`,
      simulatedReceipt: null,
    };
  }

  async prepareRelease(params: ReleaseParams): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const data = encodeFunctionData({
      abi: VERSEFLOW_ESCROW_ABI,
      functionName: "releaseMilestone",
      args: [
        params.onChainId as `0x${string}`,
        BigInt(params.milestoneIndex),
        toChainUnits(params.amount, params.asset),
      ],
    });
    return {
      to: this.escrow,
      data,
      value: "0",
      chainId: this.chainId,
      summary: "Release the approved amount to the provider.",
      simulatedReceipt: null,
    };
  }

  async prepareEvidenceAnchor(params: AnchorEvidenceParams): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const data = encodeFunctionData({
      abi: VERSEFLOW_ESCROW_ABI,
      functionName: "anchorEvidence",
      args: [
        params.onChainId as `0x${string}`,
        BigInt(params.milestoneIndex),
        BigInt(params.round),
        params.bundleHash as `0x${string}`,
      ],
    });
    return {
      to: this.escrow,
      data,
      value: "0",
      chainId: this.chainId,
      summary: "Anchor the evidence bundle hash on chain.",
      simulatedReceipt: null,
    };
  }

  async prepareDisputeSettlement(params: SettleDisputeParams): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const data = encodeFunctionData({
      abi: VERSEFLOW_ESCROW_ABI,
      functionName: "settleDispute",
      args: [
        params.onChainId as `0x${string}`,
        BigInt(params.milestoneIndex),
        toChainUnits(params.providerAmount, params.asset),
      ],
    });
    return {
      to: this.escrow,
      data,
      value: "0",
      chainId: this.chainId,
      summary: "Settle the disputed milestone.",
      simulatedReceipt: null,
    };
  }

  /**
   * The single source of truth for whether money actually moved.
   * A missing receipt means "still pending", not "failed" -- treating an
   * unconfirmed transaction as failed would be as wrong as treating it as settled.
   */
  async verifyTransaction(txHash: string): Promise<TxReceipt> {
    await this.assertNetwork();
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: txHash as `0x${string}` });

      if (receipt.status === "reverted") {
        return {
          txHash,
          status: "failed",
          blockNumber: Number(receipt.blockNumber),
          chainId: this.chainId,
          simulated: false,
          reason: "The transaction reverted on chain.",
        };
      }

      const head = await this.client.getBlockNumber();
      const confirmations = Number(head - receipt.blockNumber) + 1;
      const required = getChainConfig().confirmations;

      return {
        txHash,
        status: confirmations >= required ? "confirmed" : "pending",
        blockNumber: Number(receipt.blockNumber),
        chainId: this.chainId,
        simulated: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // viem throws when a receipt is not yet available; that is a pending
      // transaction, not a failure.
      if (/not be found|not found|could not be found/i.test(message)) {
        return { txHash, status: "pending", blockNumber: null, chainId: this.chainId, simulated: false };
      }
      throw new ChainError("Could not reach the settlement network.", "unavailable", message);
    }
  }

  async readAgreement(onChainId: string): Promise<OnChainAgreementState | null> {
    await this.assertNetwork();
    try {
      const [result, milestones] = await Promise.all([
        this.client.readContract({
          address: this.escrow,
          abi: VERSEFLOW_ESCROW_ABI,
          functionName: "getAgreement",
          args: [onChainId as `0x${string}`],
        }),
        this.client.readContract({
          address: this.escrow,
          abi: VERSEFLOW_ESCROW_ABI,
          functionName: "getMilestones",
          args: [onChainId as `0x${string}`],
        }),
      ]);

      const [client, provider, token, totalAmount, totalReleased, termsHash, , state, disputed] = result;
      const assetSymbol = this.symbolForToken(token as string);
      const [amounts, released] = milestones as readonly [readonly bigint[], readonly bigint[]];

      return {
        exists: true,
        client: (client as string).toLowerCase(),
        provider: (provider as string).toLowerCase(),
        totalAmount: fromChainUnits(totalAmount as bigint, assetSymbol),
        totalReleased: fromChainUnits(totalReleased as bigint, assetSymbol),
        termsHash: termsHash as string,
        state: STATE_NAMES[Number(state)] ?? "none",
        disputed: Boolean(disputed),
        milestoneAmounts: amounts.map((a) => fromChainUnits(a, assetSymbol)),
        milestoneReleased: released.map((a) => fromChainUnits(a, assetSymbol)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/NotFound/i.test(message)) return null;
      throw new ChainError("Could not read escrow state.", "unavailable", message);
    }
  }

  async verifyTerms(onChainId: string, expectedTermsHash: string): Promise<boolean> {
    await this.assertNetwork();
    try {
      return (await this.client.readContract({
        address: this.escrow,
        abi: VERSEFLOW_ESCROW_ABI,
        functionName: "verifyTerms",
        args: [onChainId as `0x${string}`, expectedTermsHash as `0x${string}`],
      })) as boolean;
    } catch {
      return false;
    }
  }

  private symbolForToken(token: string): string {
    const zero = "0x0000000000000000000000000000000000000000";
    if (token.toLowerCase() === zero) return getChainConfig().nativeCurrency.symbol;
    const usdc = process.env.NEXT_PUBLIC_VERSE_USDC_ADDRESS;
    if (usdc && token.toLowerCase() === usdc.toLowerCase()) return "USDC";
    const eurc = process.env.NEXT_PUBLIC_VERSE_EURC_ADDRESS;
    if (eurc && token.toLowerCase() === eurc.toLowerCase()) return "EURC";
    return "USDC";
  }
}
