/**
 * The settlement boundary.
 *
 * Everything the application knows about moving money goes through this interface.
 * Services depend on `SettlementAdapter`, never on viem, an RPC client, or a wallet
 * object -- so the simulated environment and a live Verse deployment are genuinely
 * interchangeable, and the rest of the codebase cannot drift into chain-specific
 * assumptions.
 */

export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxReceipt {
  txHash: string;
  status: TxStatus;
  blockNumber: number | null;
  chainId: number;
  /** True when this receipt came from the local simulation rather than a network. */
  simulated: boolean;
  /** Present when status is "failed". */
  reason?: string;
}

export interface FundEscrowParams {
  agreementId: string;
  onChainId: string;
  clientAddress: string;
  providerAddress: string;
  /** Per-milestone amounts in display minor units, in order. */
  milestoneAmounts: number[];
  asset: string;
  termsHash: string;
}

export interface ReleaseParams {
  onChainId: string;
  milestoneIndex: number;
  /** Display minor units. */
  amount: number;
  asset: string;
  recipientAddress: string;
  clientAddress: string;
}

export interface AnchorEvidenceParams {
  onChainId: string;
  milestoneIndex: number;
  round: number;
  bundleHash: string;
  submitterAddress: string;
}

export interface SettleDisputeParams {
  onChainId: string;
  milestoneIndex: number;
  providerAmount: number;
  asset: string;
  providerAddress: string;
  clientAddress: string;
}

export interface OnChainAgreementState {
  exists: boolean;
  client: string;
  provider: string;
  totalAmount: number;
  totalReleased: number;
  termsHash: string;
  state: "none" | "funded" | "completed" | "cancelled";
  disputed: boolean;
  milestoneAmounts: number[];
  milestoneReleased: number[];
}

export interface SettlementAdapter {
  readonly mode: "simulated" | "live";
  readonly chainId: number;

  /** Escrow contract address, or null when running simulated. */
  escrowAddress(): string | null;

  /**
   * Prepare the escrow funding transaction. In live mode this returns an unsigned
   * request for the client's wallet to sign -- the server never holds a key.
   */
  prepareFunding(params: FundEscrowParams): Promise<PreparedTransaction>;

  prepareRelease(params: ReleaseParams): Promise<PreparedTransaction>;

  prepareEvidenceAnchor(params: AnchorEvidenceParams): Promise<PreparedTransaction>;

  prepareDisputeSettlement(params: SettleDisputeParams): Promise<PreparedTransaction>;

  /**
   * Verify a transaction against the network. Never trust a wallet's success
   * response -- this is the only thing that may mark a payment confirmed.
   */
  verifyTransaction(txHash: string): Promise<TxReceipt>;

  /** Read escrow state directly from the settlement layer. */
  readAgreement(onChainId: string): Promise<OnChainAgreementState | null>;

  /** Confirm the on-chain terms hash still matches what the app is showing. */
  verifyTerms(onChainId: string, expectedTermsHash: string): Promise<boolean>;
}

export interface PreparedTransaction {
  /** Contract to call. Null in simulated mode. */
  to: string | null;
  /** ABI-encoded calldata. Null in simulated mode. */
  data: string | null;
  /** Native value to send, as a decimal string of base units. */
  value: string;
  chainId: number;
  /** A description shown to the user before they sign. */
  summary: string;
  /**
   * In simulated mode the adapter can execute immediately and return a receipt,
   * because there is no wallet to sign. In live mode this is always null and the
   * browser wallet performs the signature.
   */
  simulatedReceipt: TxReceipt | null;
}

export class ChainError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "reverted" | "not_found" | "config",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ChainError";
  }
}
