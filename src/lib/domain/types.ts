/**
 * VerseFlow domain model.
 *
 * Six questions the product must always be able to answer:
 *   Agreement  - what did we promise?
 *   Escrow     - where is the money?
 *   Evidence   - what happened?
 *   Decision   - was the milestone satisfied?
 *   Settlement - what gets paid?
 *   Reputation - what happened over time?
 */

// ---------------------------------------------------------------------------
// Roles & parties
// ---------------------------------------------------------------------------

/** A generalized party role. One model serves freelancers, agencies, DAOs, contractors. */
export type PartyRole = "client" | "provider";

export type ProfessionKind =
  | "freelancer"
  | "agency"
  | "consultant"
  | "developer"
  | "designer"
  | "creator"
  | "marketer"
  | "dao_contributor"
  | "contractor"
  | "client";

export type VerificationStatus = "unverified" | "wallet_verified" | "identity_verified";

export interface User {
  id: string;
  handle: string;
  displayName: string;
  headline: string;
  bio: string;
  avatarColor: string;
  email: string | null;
  professions: ProfessionKind[];
  verification: VerificationStatus;
  isAdmin: boolean;
  /** Public reputation visibility is opt-in. Nothing is published without consent. */
  publicProfileEnabled: boolean;
  publicMetrics: PublicMetricKey[];
  timezone: string;
  createdAt: string;
}

export type PublicMetricKey =
  | "contracts_completed"
  | "value_settled"
  | "on_time_rate"
  | "milestone_success_rate"
  | "dispute_count"
  | "repeat_client_rate"
  | "avg_completion_days";

export interface WalletAddress {
  id: string;
  userId: string;
  address: string;
  chainId: number;
  label: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

export type AgreementStatus =
  | "draft"
  | "awaiting_signature"
  | "awaiting_funding"
  | "funded"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "paused"
  | "disputed";

export interface Agreement {
  id: string;
  /** Human reference, e.g. VF-1042 */
  reference: string;
  title: string;
  description: string;
  clientId: string;
  providerId: string | null;
  /** Invite address used when the counterparty has not joined yet. */
  providerInviteAddress: string | null;
  totalAmount: number;
  asset: string;
  status: AgreementStatus;
  /** keccak256 of the canonical signed terms. Null until locked. */
  agreementHash: string | null;
  /** Deterministic on-chain agreement identifier derived from the hash. Null until locked. */
  onChainId: string | null;
  escrowAddress: string | null;
  fundingTxHash: string | null;
  chainId: number | null;
  /** Rules snapshot at lock time - immutable once signed. */
  rules: AgreementRules;
  clientSignature: PartySignature | null;
  providerSignature: PartySignature | null;
  expectedCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** True when this agreement settles in the simulated environment rather than a live network. */
  isSimulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgreementRules {
  /** Total revision rounds allowed per milestone. */
  revisionRounds: number;
  /** Hours the client has to review a submitted milestone before it escalates to attention. */
  approvalWindowHours: number;
  /** Hours after approval during which a dispute may still be opened. */
  disputeWindowHours: number;
  /** Whether each milestone must carry at least one evidence item. */
  evidenceRequired: boolean;
  /** Whether the client may release a partial amount for a milestone. */
  partialReleaseAllowed: boolean;
  /** Optional late-delivery note carried in the human-readable terms. */
  lateDeliveryPolicy: string | null;
  /** Free-form additional clauses agreed by both parties. */
  additionalTerms: string[];
}

export const DEFAULT_AGREEMENT_RULES: AgreementRules = {
  revisionRounds: 2,
  approvalWindowHours: 72,
  disputeWindowHours: 120,
  evidenceRequired: true,
  partialReleaseAllowed: true,
  lateDeliveryPolicy: null,
  additionalTerms: [],
};

export interface PartySignature {
  userId: string;
  address: string;
  /** Hash of the terms actually signed - must match agreementHash. */
  termsHash: string;
  signature: string;
  signedAt: string;
  method: "wallet_signature" | "simulated_signature";
}

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

export type MilestoneStatus =
  | "locked"
  | "in_progress"
  | "submitted"
  | "under_review"
  | "revision_requested"
  | "approved"
  | "partially_approved"
  | "released"
  | "disputed"
  | "cancelled";

export type EvidenceKind =
  | "github_repo"
  | "github_commits"
  | "deployment_url"
  | "figma"
  | "document"
  | "file"
  | "screenshot"
  | "note"
  | "link";

export interface AcceptanceCriterion {
  id: string;
  text: string;
  /** How this criterion is checked: automatically from evidence, or by human judgement. */
  verification: "evidence" | "manual";
  /** Set by the ambiguity detector. Advisory only - never blocks. */
  ambiguityFlag: string | null;
}

export interface Milestone {
  id: string;
  agreementId: string;
  position: number;
  title: string;
  description: string;
  amount: number;
  dueAt: string | null;
  deliverables: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  requiredEvidence: EvidenceKind[];
  status: MilestoneStatus;
  revisionCount: number;
  /** Minor units already released for this milestone (supports partial release). */
  releasedAmount: number;
  submittedAt: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  /** Deadline for the client to act on a submitted milestone. */
  reviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface Evidence {
  id: string;
  milestoneId: string;
  agreementId: string;
  submittedBy: string;
  /** Submission round - increments with each revision. */
  round: number;
  kind: EvidenceKind;
  title: string;
  /** URL, repo slug, or stored file reference. */
  source: string;
  description: string;
  metadata: EvidenceMetadata;
  /** sha256 of the canonical evidence payload, anchored with the milestone submission. */
  hash: string;
  submittedAt: string;
}

export interface EvidenceMetadata {
  [key: string]: string | number | boolean | null | string[];
}

export interface EvidenceBundle {
  /** keccak256 over the ordered evidence hashes - this is what gets anchored on chain. */
  bundleHash: string;
  evidenceIds: string[];
  round: number;
  anchoredTxHash: string | null;
}

// ---------------------------------------------------------------------------
// AI analysis (advisory only - never an authority over funds)
// ---------------------------------------------------------------------------

export type CriterionAssessment = "met" | "likely_met" | "unverified" | "not_met";

export interface CriterionFinding {
  criterionId: string;
  criterionText: string;
  assessment: CriterionAssessment;
  reasoning: string;
  supportingEvidenceIds: string[];
}

export type Recommendation =
  | "likely_satisfies"
  | "partially_satisfies"
  | "needs_clarification"
  | "likely_insufficient";

export interface EvidenceAnalysis {
  id: string;
  milestoneId: string;
  agreementId: string;
  round: number;
  consistency: "high" | "medium" | "low";
  findings: CriterionFinding[];
  recommendation: Recommendation;
  /** 0-100. Presented as a confidence, never as a decision. */
  confidence: number;
  summary: string;
  openQuestions: string[];
  /** Which engine produced this: the language model, or the deterministic rule engine. */
  engine: "model" | "rules";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentStatus = "pending" | "submitted" | "confirmed" | "failed";
export type PaymentKind = "milestone_release" | "partial_release" | "refund" | "dispute_settlement";

export interface Payment {
  id: string;
  agreementId: string;
  milestoneId: string | null;
  kind: PaymentKind;
  amount: number;
  asset: string;
  recipientAddress: string;
  status: PaymentStatus;
  txHash: string | null;
  chainId: number | null;
  blockNumber: number | null;
  /** Client-supplied key that makes release operations safe to retry. */
  idempotencyKey: string;
  /** Reason is mandatory for partial releases and dispute settlements. */
  reason: string | null;
  failureReason: string | null;
  isSimulated: boolean;
  initiatedBy: string;
  createdAt: string;
  confirmedAt: string | null;
}

// ---------------------------------------------------------------------------
// Revisions & disputes
// ---------------------------------------------------------------------------

export interface RevisionRequest {
  id: string;
  agreementId: string;
  milestoneId: string;
  requestedBy: string;
  round: number;
  issue: string;
  requestedAction: string;
  /** Criteria the client considers unmet. */
  unmetCriterionIds: string[];
  resolvedAt: string | null;
  createdAt: string;
}

export type DisputeStatus = "open" | "under_review" | "negotiating" | "resolved" | "withdrawn";
export type DisputeResolution =
  | "released_full"
  | "released_partial"
  | "refunded_full"
  | "withdrawn"
  | "negotiated";

export interface Dispute {
  id: string;
  agreementId: string;
  milestoneId: string;
  openedBy: string;
  reason: string;
  detail: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolutionNote: string | null;
  /** Minor units released to the provider as part of the resolution. */
  resolvedProviderAmount: number | null;
  resolvedByUserId: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

export interface DisputeMessage {
  id: string;
  disputeId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Activity, notifications, reputation
// ---------------------------------------------------------------------------

export type ActivityType =
  | "agreement_created"
  | "agreement_updated"
  | "ai_agreement_generated"
  | "agreement_signed"
  | "agreement_locked"
  | "escrow_created"
  | "escrow_funded"
  | "milestone_started"
  | "milestone_submitted"
  | "evidence_uploaded"
  | "evidence_analyzed"
  | "milestone_approved"
  | "milestone_partially_approved"
  | "payment_released"
  | "payment_failed"
  | "revision_requested"
  | "revision_submitted"
  | "dispute_opened"
  | "dispute_message"
  | "dispute_resolved"
  | "agreement_completed"
  | "agreement_cancelled"
  | "agreement_paused"
  | "admin_action";

export interface ActivityEvent {
  id: string;
  agreementId: string | null;
  milestoneId: string | null;
  actorId: string | null;
  /** "System" for automated events, otherwise the acting display name at the time. */
  actorLabel: string;
  type: ActivityType;
  summary: string;
  metadata: Record<string, unknown>;
  txHash: string | null;
  createdAt: string;
}

export type NotificationKind =
  | "milestone_ready_for_review"
  | "payment_released"
  | "revision_requested"
  | "revision_submitted"
  | "agreement_awaiting_signature"
  | "escrow_funded"
  | "dispute_opened"
  | "dispute_resolved"
  | "deadline_approaching"
  | "agreement_completed";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  agreementId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  userId: string;
  /** Per-kind in-app toggles. Digest mode batches low-priority items. */
  channels: Record<NotificationKind, boolean>;
  digestMode: boolean;
}

export interface Reputation {
  userId: string;
  contractsCompleted: number;
  valueSettled: number;
  /** Percentages 0-100, rounded. */
  onTimeRate: number;
  milestoneSuccessRate: number;
  disputeCount: number;
  disputeRate: number;
  repeatClientRate: number;
  avgCompletionDays: number;
  milestonesCompleted: number;
  firstSettlementAt: string | null;
  lastSettlementAt: string | null;
}

export interface ShowcaseItem {
  id: string;
  userId: string;
  agreementId: string;
  /** Public-facing title - may be anonymized by the user. */
  publicTitle: string;
  summary: string;
  /** When true, the exact contract value is hidden and only a band is shown. */
  anonymizeValue: boolean;
  position: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type AnalyticsEventName =
  | "wallet_connected"
  | "agreement_created"
  | "ai_agreement_generated"
  | "agreement_signed"
  | "escrow_funded"
  | "milestone_submitted"
  | "evidence_uploaded"
  | "milestone_approved"
  | "payment_released"
  | "partial_payment_executed"
  | "revision_requested"
  | "dispute_opened"
  | "dispute_resolved"
  | "reputation_profile_viewed"
  | "public_agreement_shared"
  | "demo_mode_started"
  | "command_palette_opened";

export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  userId: string | null;
  anonymousId: string;
  agreementId: string | null;
  properties: Record<string, unknown>;
  /** Whether the event was accepted by the Verse App Analytics forwarder. */
  forwarded: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit (append-only; admin actions can never rewrite financial history)
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}
