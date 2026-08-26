/**
 * Demo seed.
 *
 * Builds a believable operating history rather than a handful of placeholder rows:
 * two years of completed agreements for the provider, repeat clients, one real
 * dispute that was resolved, and the headline project mid-flight with a milestone
 * genuinely waiting for review.
 *
 * Reputation and analytics are COMPUTED from this data, never written directly.
 * That is deliberate -- if the seed produced the numbers, the metrics would prove
 * nothing about the product.
 *
 * Every settlement here runs through the simulated adapter and is stamped as
 * simulated. Nothing in this file claims to be live network activity.
 */

import { getDb, transaction } from "@/lib/db/client";
import {
  usersRepo, walletsRepo, agreementsRepo, milestonesRepo, evidenceRepo,
  analysisRepo, paymentsRepo, activityRepo, notificationsRepo, disputesRepo,
  showcaseRepo, searchRepo,
} from "@/lib/db/repositories";
import type {
  Agreement, Milestone, User, Evidence, AcceptanceCriterion,
  EvidenceKind, ActivityType, AgreementRules,
} from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";
import { newId, nowIso } from "@/lib/domain/ids";
import { canonicalTerms, hashTerms, deriveOnChainId, hashEvidence, hashEvidenceBundle } from "@/lib/domain/hashing";
import { registerHistoricalTx, hydrateSimulatedEscrow, resetSimulatedChain } from "@/lib/chain/simulated-adapter";
import { indexAgreement, indexPublicProfile } from "@/lib/services/activity";
import { analyzeEvidence } from "@/lib/ai/evidence-analyzer";

// ---------------------------------------------------------------------------
// Deterministic randomness -- the same seed always produces the same demo.
// ---------------------------------------------------------------------------

let seedState = 0x5eed_1042;
function rand(): number {
  seedState ^= seedState << 13;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5;
  return ((seedState >>> 0) % 100_000) / 100_000;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}
function between(min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}
function resetRandom() {
  seedState = 0x5eed_1042;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

function daysAgo(days: number, hourOfDay = 10, minute = 0): string {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hourOfDay, minute, 0, 0);
  return d.toISOString();
}

function txHash(seed: string): string {
  // Deterministic 32-byte hex derived from the label, so the same seed run
  // produces the same explorer-shaped hashes.
  let h = 0;
  let out = "";
  for (let i = 0; i < 64; i++) {
    h = (h * 31 + seed.charCodeAt(i % seed.length) + i * 7) >>> 0;
    out += "0123456789abcdef"[h % 16];
  }
  return `0x${out}`;
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

export const DEMO_ADDRESSES = {
  alex: "0x7A3f9C21b4E8d5F06a1B2c3D4e5F60718293A4b5",
  northstar: "0x2B8e4D19a6C7f3E05b9A8c7D6e5F40312a1B9c8D",
  operator: "0x9F1a2B3c4D5e6F708192A3b4C5d6E7f809A1b2C3",
} as const;

interface SeedContext {
  alex: User;
  northstar: User;
  operator: User;
  historicalClients: User[];
}

function makeUser(spec: {
  handle: string;
  displayName: string;
  headline: string;
  bio?: string;
  color: string;
  address?: string;
  isAdmin?: boolean;
  professions: string[];
  publicProfile?: boolean;
  createdDaysAgo: number;
}): User {
  const user = usersRepo.create({
    id: newId("usr"),
    handle: spec.handle,
    displayName: spec.displayName,
    headline: spec.headline,
    bio: spec.bio ?? "",
    avatarColor: spec.color,
    email: null,
    professions: spec.professions as never,
    verification: "wallet_verified",
    isAdmin: spec.isAdmin ?? false,
    publicProfileEnabled: spec.publicProfile ?? false,
    publicMetrics: spec.publicProfile
      ? ["contracts_completed", "value_settled", "on_time_rate", "milestone_success_rate", "repeat_client_rate", "avg_completion_days"]
      : [],
    timezone: "Europe/Lisbon",
    createdAt: daysAgo(spec.createdDaysAgo),
  });

  if (spec.address) {
    walletsRepo.add({
      userId: user.id,
      address: spec.address,
      chainId: 20197,
      label: "Primary wallet",
      isPrimary: true,
      verifiedAt: daysAgo(spec.createdDaysAgo),
    });
  } else {
    // Historical counterparties still need an address for escrow to be coherent.
    walletsRepo.add({
      userId: user.id,
      address: `0x${user.id.slice(4, 8)}${"0".repeat(28)}${user.id.slice(-8)}`.slice(0, 42),
      chainId: 20197,
      label: "Wallet",
      isPrimary: true,
      verifiedAt: daysAgo(spec.createdDaysAgo),
    });
  }

  notificationsRepo.savePreferences({ userId: user.id, channels: {} as never, digestMode: false });
  return user;
}

// ---------------------------------------------------------------------------
// Agreement construction
// ---------------------------------------------------------------------------

interface MilestoneSpec {
  title: string;
  description: string;
  amount: number;
  deliverables: string[];
  criteria: string[];
  evidence: EvidenceKind[];
  dueOffsetDays: number;
}

function criteria(texts: string[]): AcceptanceCriterion[] {
  return texts.map((text) => ({
    id: newId("mst"),
    text,
    verification: "manual" as const,
    ambiguityFlag: null,
  }));
}

function buildAgreement(spec: {
  title: string;
  description: string;
  client: User;
  provider: User;
  milestones: MilestoneSpec[];
  startedDaysAgo: number;
  status: Agreement["status"];
  rules?: Partial<AgreementRules>;
  sequence: number;
}): { agreement: Agreement; milestones: Milestone[] } {
  const total = spec.milestones.reduce((a, m) => a + m.amount, 0);
  const createdAt = daysAgo(spec.startedDaysAgo + 3, 9, 12);
  const signedAt = daysAgo(spec.startedDaysAgo + 1, 14, 30);
  const startedAt = daysAgo(spec.startedDaysAgo, 9, 43);

  const clientAddress = walletsRepo.primaryAddress(spec.client.id)!;
  const providerAddress = walletsRepo.primaryAddress(spec.provider.id)!;
  const rules: AgreementRules = { ...DEFAULT_AGREEMENT_RULES, ...spec.rules };

  const expectedCompletionAt = new Date(
    Date.parse(startedAt) + Math.max(...spec.milestones.map((m) => m.dueOffsetDays)) * DAY,
  ).toISOString();

  const draft: Agreement = {
    id: newId("agr"),
    reference: `VF-${1000 + spec.sequence}`,
    title: spec.title,
    description: spec.description,
    clientId: spec.client.id,
    providerId: spec.provider.id,
    providerInviteAddress: null,
    totalAmount: total,
    asset: "USDC",
    status: spec.status,
    agreementHash: null,
    onChainId: null,
    escrowAddress: "0x00000000000000000000000053494d554c41544544",
    fundingTxHash: null,
    chainId: 20197,
    rules,
    clientSignature: null,
    providerSignature: null,
    expectedCompletionAt,
    startedAt,
    completedAt: null,
    cancelledAt: null,
    isSimulated: true,
    createdAt,
    updatedAt: startedAt,
  };

  const milestones: Milestone[] = spec.milestones.map((m, index) => ({
    id: newId("mst"),
    agreementId: draft.id,
    position: index,
    title: m.title,
    description: m.description,
    amount: m.amount,
    dueAt: new Date(Date.parse(startedAt) + m.dueOffsetDays * DAY).toISOString(),
    deliverables: m.deliverables,
    acceptanceCriteria: criteria(m.criteria),
    requiredEvidence: m.evidence,
    status: "locked",
    revisionCount: 0,
    releasedAmount: 0,
    submittedAt: null,
    approvedAt: null,
    releasedAt: null,
    reviewDueAt: null,
    createdAt,
    updatedAt: createdAt,
  }));

  // Hash the real terms, exactly as the live signing path does.
  const terms = canonicalTerms(draft, milestones, { clientAddress, providerAddress });
  const termsHash = hashTerms(terms);
  const onChainId = deriveOnChainId(termsHash, clientAddress, providerAddress);
  const fundingTx = txHash(`fund-${draft.reference}`);

  const agreement: Agreement = {
    ...draft,
    agreementHash: termsHash,
    onChainId,
    fundingTxHash: fundingTx,
    clientSignature: {
      userId: spec.client.id,
      address: clientAddress,
      termsHash,
      signature: `simulated:${spec.client.handle}`,
      signedAt: signedAt,
      method: "simulated_signature",
    },
    providerSignature: {
      userId: spec.provider.id,
      address: providerAddress,
      termsHash,
      signature: `simulated:${spec.provider.handle}`,
      signedAt: new Date(Date.parse(signedAt) + 2 * HOUR).toISOString(),
      method: "simulated_signature",
    },
  };

  agreementsRepo.insert(agreement);
  for (const m of milestones) milestonesRepo.insert(m);
  registerHistoricalTx(fundingTx, between(4_700_000, 4_810_000));

  activity(agreement.id, null, spec.client.id, spec.client.displayName, "agreement_created",
    `Created ${agreement.reference}`, createdAt, {});
  activity(agreement.id, null, spec.client.id, spec.client.displayName, "agreement_signed",
    "Client signed the agreement", signedAt, { termsHash });
  activity(agreement.id, null, spec.provider.id, spec.provider.displayName, "agreement_signed",
    "Provider signed the agreement", new Date(Date.parse(signedAt) + 2 * HOUR).toISOString(), { termsHash });
  activity(agreement.id, null, null, "System", "agreement_locked",
    "Both parties signed. Terms are locked.", new Date(Date.parse(signedAt) + 2 * HOUR + 60_000).toISOString(),
    { termsHash, onChainId });
  activity(agreement.id, null, spec.client.id, spec.client.displayName, "escrow_funded",
    `Escrow funded with $${(total / 100).toLocaleString("en-US")}`, startedAt,
    { escrowAddress: agreement.escrowAddress, simulated: true }, fundingTx);

  return { agreement, milestones };
}

function activity(
  agreementId: string,
  milestoneId: string | null,
  actorId: string | null,
  actorLabel: string,
  type: ActivityType,
  summary: string,
  at: string,
  metadata: Record<string, unknown> = {},
  tx: string | null = null,
) {
  activityRepo.insert({
    id: newId("act"),
    agreementId,
    milestoneId,
    actorId,
    actorLabel,
    type,
    summary,
    metadata,
    txHash: tx,
    createdAt: at,
  });
}

/** Settle a milestone end to end: approve, pay, confirm, and write the trail. */
function settleMilestone(params: {
  agreement: Agreement;
  milestone: Milestone;
  client: User;
  provider: User;
  submittedAt: string;
  releasedAt: string;
  amount?: number;
  evidence?: Array<{ kind: EvidenceKind; title: string; source: string; description: string; metadata: Record<string, unknown> }>;
}): Milestone {
  const amount = params.amount ?? params.milestone.amount;
  const providerAddress = walletsRepo.primaryAddress(params.provider.id)!;
  const approvedAt = new Date(Date.parse(params.releasedAt) - 40 * 60_000).toISOString();

  const items = params.evidence ?? [
    {
      kind: "note" as EvidenceKind,
      title: "Submission notes",
      source: "",
      description: `${params.milestone.title} delivered as agreed.`,
      metadata: {},
    },
  ];

  const hashes: string[] = [];
  for (const item of items) {
    const hash = hashEvidence({
      kind: item.kind,
      source: item.source,
      title: item.title,
      metadata: item.metadata,
      submittedAt: params.submittedAt,
    });
    hashes.push(hash);
    evidenceRepo.insert({
      id: newId("evd"),
      milestoneId: params.milestone.id,
      agreementId: params.agreement.id,
      submittedBy: params.provider.id,
      round: 1,
      kind: item.kind,
      title: item.title,
      source: item.source,
      description: item.description,
      metadata: item.metadata as never,
      hash,
      submittedAt: params.submittedAt,
    });
  }

  const bundleHash = hashEvidenceBundle(hashes);
  const anchorTx = txHash(`anchor-${params.milestone.id}`);
  const releaseTx = txHash(`release-${params.milestone.id}`);
  registerHistoricalTx(anchorTx, between(4_700_000, 4_810_000));
  registerHistoricalTx(releaseTx, between(4_700_000, 4_812_000));

  paymentsRepo.insert({
    id: newId("pay"),
    agreementId: params.agreement.id,
    milestoneId: params.milestone.id,
    kind: amount < params.milestone.amount ? "partial_release" : "milestone_release",
    amount,
    asset: params.agreement.asset,
    recipientAddress: providerAddress,
    status: "confirmed",
    txHash: releaseTx,
    chainId: 20197,
    blockNumber: between(4_700_000, 4_812_000),
    idempotencyKey: `seed_${params.milestone.id}`,
    reason: null,
    failureReason: null,
    isSimulated: true,
    initiatedBy: params.client.id,
    createdAt: approvedAt,
    confirmedAt: params.releasedAt,
  });

  const settled = milestonesRepo.update({
    ...params.milestone,
    status: amount >= params.milestone.amount ? "released" : "partially_approved",
    releasedAmount: amount,
    submittedAt: params.submittedAt,
    approvedAt,
    releasedAt: amount >= params.milestone.amount ? params.releasedAt : null,
  });

  activity(params.agreement.id, params.milestone.id, params.provider.id, params.provider.displayName,
    "milestone_submitted", `Submitted ${params.milestone.title} for review`, params.submittedAt,
    { evidenceCount: items.length, bundleHash }, anchorTx);
  activity(params.agreement.id, params.milestone.id, null, "System",
    "evidence_uploaded", `${items.length} evidence items recorded and hashed`,
    new Date(Date.parse(params.submittedAt) + 90_000).toISOString(), { bundleHash }, anchorTx);
  activity(params.agreement.id, params.milestone.id, params.client.id, params.client.displayName,
    "milestone_approved", `Approved ${params.milestone.title}`, approvedAt, { amount });
  activity(params.agreement.id, params.milestone.id, null, "System",
    "payment_released", `Payment released: $${(amount / 100).toLocaleString("en-US")}`,
    params.releasedAt, { simulated: true, recipient: providerAddress }, releaseTx);

  return settled;
}

// ---------------------------------------------------------------------------
// Historical work
// ---------------------------------------------------------------------------

const PROJECT_TEMPLATES = [
  { title: "Marketing site rebuild", phases: ["Design", "Build", "Launch"], weights: [0.3, 0.5, 0.2] },
  { title: "SaaS dashboard", phases: ["Discovery", "Design", "Development"], weights: [0.2, 0.3, 0.5] },
  { title: "Mobile app redesign", phases: ["Audit", "Design", "Handoff"], weights: [0.25, 0.5, 0.25] },
  { title: "Checkout flow optimisation", phases: ["Analysis", "Implementation"], weights: [0.35, 0.65] },
  { title: "Design system foundation", phases: ["Tokens & primitives", "Components", "Documentation"], weights: [0.3, 0.45, 0.25] },
  { title: "Booking platform integration", phases: ["Integration", "Testing"], weights: [0.7, 0.3] },
  { title: "Landing page series", phases: ["Concepts", "Delivery"], weights: [0.4, 0.6] },
  { title: "Internal analytics tool", phases: ["Data layer", "Interface", "Rollout"], weights: [0.4, 0.4, 0.2] },
  { title: "Headless commerce migration", phases: ["Migration plan", "Implementation", "Cutover"], weights: [0.2, 0.55, 0.25] },
  { title: "Brand identity refresh", phases: ["Moodboard", "Identity", "Guidelines"], weights: [0.2, 0.5, 0.3] },
];

const CLIENT_COMPANIES = [
  { handle: "harbourlane", name: "Harbour Lane Studio", color: "#0E7C86", repeat: 5 },
  { handle: "meridian-labs", name: "Meridian Labs", color: "#6D4AFF", repeat: 4 },
  { handle: "atlas-goods", name: "Atlas Goods", color: "#B45309", repeat: 4 },
  { handle: "fernweh", name: "Fernweh Travel", color: "#C2410C", repeat: 3 },
  { handle: "kestrel-health", name: "Kestrel Health", color: "#0F9D6B", repeat: 3 },
  { handle: "brightsky", name: "Brightsky Media", color: "#1D5BFF", repeat: 1 },
  { handle: "orchard-co", name: "Orchard & Co", color: "#5B32E0", repeat: 1 },
  { handle: "vantage-partners", name: "Vantage Partners", color: "#55524B", repeat: 1 },
];

function seedHistory(ctx: SeedContext): void {
  let sequence = 1;
  let dayCursor = 690;

  for (const company of ctx.historicalClients) {
    const config = CLIENT_COMPANIES.find((c) => c.handle === company.handle)!;

    for (let i = 0; i < config.repeat; i++) {
      const template = PROJECT_TEMPLATES[(sequence + i) % PROJECT_TEMPLATES.length];
      const total = between(12, 30) * 10_000; // $1,200 - $3,000 in minor units
      const weights = template.weights;
      const weightSum = weights.reduce((a, b) => a + b, 0);

      const amounts = weights.map((w) => Math.floor((total * w) / weightSum));
      amounts[amounts.length - 1] += total - amounts.reduce((a, b) => a + b, 0);

      const durationDays = between(18, 44);
      const startedDaysAgo = dayCursor;
      dayCursor -= between(20, 34);
      if (dayCursor < 40) dayCursor = between(60, 200);

      const milestoneSpecs: MilestoneSpec[] = template.phases.map((phase, index) => ({
        title: phase,
        description: `${phase} phase of ${template.title.toLowerCase()}.`,
        amount: amounts[index],
        deliverables: [`${phase} deliverables as agreed`],
        criteria: [`${phase} completed and accepted by the client`],
        evidence: index === template.phases.length - 1 ? ["deployment_url", "document"] : ["file", "document"],
        dueOffsetDays: Math.round((durationDays * (index + 1)) / template.phases.length),
      }));

      const { agreement, milestones } = buildAgreement({
        title: `${template.title} — ${company.displayName}`,
        description: `${template.title} delivered for ${company.displayName}.`,
        client: company,
        provider: ctx.alex,
        milestones: milestoneSpecs,
        startedDaysAgo,
        status: "in_progress",
        sequence: ++sequence,
      });

      // Settle every milestone. Roughly one in twenty lands late, which keeps the
      // on-time rate honest rather than a suspicious 100%.
      let allOnTime = true;
      for (const milestone of milestones) {
        const dueAt = Date.parse(milestone.dueAt!);
        const late = rand() < 0.05;
        if (late) allOnTime = false;
        const releasedAt = new Date(dueAt + (late ? between(1, 4) * DAY : -between(1, 3) * DAY)).toISOString();
        const submittedAt = new Date(Date.parse(releasedAt) - between(1, 3) * DAY).toISOString();
        settleMilestone({
          agreement,
          milestone,
          client: company,
          provider: ctx.alex,
          submittedAt,
          releasedAt,
        });
      }

      const completedAt = new Date(
        Date.parse(agreement.startedAt!) + durationDays * DAY + (allOnTime ? 0 : 2 * DAY),
      ).toISOString();

      agreementsRepo.update({ ...agreement, status: "completed", completedAt });
      activity(agreement.id, null, null, "System", "agreement_completed",
        "All milestones settled. Agreement complete.", completedAt, { totalSettled: agreement.totalAmount });

      indexAgreement({ ...agreement, status: "completed", completedAt }, milestones);
    }
  }

  seedResolvedDispute(ctx, ++sequence);
}

/**
 * One historical dispute, resolved by a partial settlement. A provider profile with
 * zero disputes across two years of work would be less credible, not more.
 */
function seedResolvedDispute(ctx: SeedContext, sequence: number): void {
  const client = ctx.historicalClients[2];
  const startedDaysAgo = 148;

  const { agreement, milestones } = buildAgreement({
    title: `Campaign microsite — ${client.displayName}`,
    description: "Single-page campaign microsite with a countdown and signup capture.",
    client,
    provider: ctx.alex,
    milestones: [
      {
        title: "Design",
        description: "Microsite design at desktop and mobile widths.",
        amount: 90_000,
        deliverables: ["Desktop and mobile design", "Asset export"],
        criteria: ["Design delivered at both widths", "Source file shared"],
        evidence: ["figma", "screenshot"],
        dueOffsetDays: 10,
      },
      {
        title: "Build & launch",
        description: "Build the microsite and deploy to production.",
        amount: 140_000,
        deliverables: ["Deployed microsite", "Signup integration"],
        criteria: [
          "Microsite reachable in production",
          "Signup form submits to the agreed endpoint",
          "Countdown reflects the campaign end date",
        ],
        evidence: ["deployment_url", "github_repo"],
        dueOffsetDays: 26,
      },
    ],
    startedDaysAgo,
    status: "in_progress",
    sequence,
  });

  settleMilestone({
    agreement,
    milestone: milestones[0],
    client,
    provider: ctx.alex,
    submittedAt: daysAgo(startedDaysAgo - 8),
    releasedAt: daysAgo(startedDaysAgo - 6),
  });

  // Second milestone: disputed over an integration scope disagreement, then settled.
  const disputedAt = daysAgo(startedDaysAgo - 28);
  const resolvedAt = daysAgo(startedDaysAgo - 24);
  const providerAddress = walletsRepo.primaryAddress(ctx.alex.id)!;

  const dispute = disputesRepo.insert({
    id: newId("dsp"),
    agreementId: agreement.id,
    milestoneId: milestones[1].id,
    openedBy: client.id,
    reason: "Signup integration scope",
    detail:
      "The signup form posts to a spreadsheet rather than the CRM endpoint we discussed on the kickoff call. The CRM integration was not written into the milestone, so we would like to agree a fair split rather than treat it as delivered in full.",
    status: "resolved",
    resolution: "released_partial",
    resolutionNote:
      "Both parties agreed the CRM endpoint was discussed but never written into the acceptance criteria. Settled at 80% with the integration descoped.",
    resolvedProviderAmount: 112_000,
    resolvedByUserId: client.id,
    openedAt: disputedAt,
    resolvedAt,
  });

  disputesRepo.addMessage({
    id: newId("msg"),
    disputeId: dispute.id,
    authorId: ctx.alex.id,
    body: "Understood. The CRM endpoint was not in the written criteria, so I did not scope it. Happy to settle at 80% and quote the integration separately.",
    createdAt: new Date(Date.parse(disputedAt) + 6 * HOUR).toISOString(),
  });
  disputesRepo.addMessage({
    id: newId("msg"),
    disputeId: dispute.id,
    authorId: client.id,
    body: "That works. Agreed at 80%, and we will raise the integration as its own milestone next month.",
    createdAt: new Date(Date.parse(disputedAt) + 30 * HOUR).toISOString(),
  });

  const settlementTx = txHash(`settle-${dispute.id}`);
  registerHistoricalTx(settlementTx, between(4_700_000, 4_760_000));

  paymentsRepo.insert({
    id: newId("pay"),
    agreementId: agreement.id,
    milestoneId: milestones[1].id,
    kind: "dispute_settlement",
    amount: 112_000,
    asset: "USDC",
    recipientAddress: providerAddress,
    status: "confirmed",
    txHash: settlementTx,
    chainId: 20197,
    blockNumber: between(4_700_000, 4_760_000),
    idempotencyKey: `seed_dispute_${dispute.id}`,
    reason: "Negotiated settlement at 80%, integration descoped.",
    failureReason: null,
    isSimulated: true,
    initiatedBy: client.id,
    createdAt: resolvedAt,
    confirmedAt: resolvedAt,
  });

  milestonesRepo.update({
    ...milestones[1],
    status: "released",
    releasedAmount: 112_000,
    submittedAt: daysAgo(startedDaysAgo - 30),
    approvedAt: resolvedAt,
    releasedAt: resolvedAt,
  });

  activity(agreement.id, milestones[1].id, ctx.alex.id, ctx.alex.displayName, "milestone_submitted",
    "Submitted Build & launch for review", daysAgo(startedDaysAgo - 30), {});
  activity(agreement.id, milestones[1].id, client.id, client.displayName, "dispute_opened",
    "Dispute opened on Build & launch: Signup integration scope", disputedAt, { disputeId: dispute.id });
  activity(agreement.id, milestones[1].id, client.id, client.displayName, "dispute_resolved",
    "Dispute resolved: released partial · $1,120.00 to provider", resolvedAt,
    { disputeId: dispute.id, providerAmount: 112_000, clientRefund: 28_000 }, settlementTx);

  const completedAt = new Date(Date.parse(resolvedAt) + HOUR).toISOString();
  agreementsRepo.update({ ...agreement, status: "completed", completedAt });
  activity(agreement.id, null, null, "System", "agreement_completed",
    "All milestones settled. Agreement complete.", completedAt, {});
  indexAgreement({ ...agreement, status: "completed", completedAt }, milestones);
}

// ---------------------------------------------------------------------------
// The headline project (Verse Buildathon demo)
// ---------------------------------------------------------------------------

async function seedHeadlineProject(ctx: SeedContext): Promise<void> {
  const { agreement, milestones } = buildAgreement({
    title: "E-commerce Website Redesign",
    description:
      "Full redesign and rebuild of the Northstar Coffee storefront: five pages, responsive layouts, a new product grid, and a rebuilt checkout flow. Staging environment throughout, production launch at the end.",
    client: ctx.northstar,
    provider: ctx.alex,
    milestones: [
      {
        title: "Design",
        description: "Complete visual design for all five pages, desktop and mobile.",
        amount: 75_000,
        deliverables: [
          "Design files for all 5 pages",
          "Desktop and mobile layouts",
          "Component and type styles defined",
        ],
        criteria: [
          "All five agreed pages designed at desktop and mobile widths",
          "Source design file shared with view access",
          "Typography, colour and spacing defined as reusable styles",
        ],
        evidence: ["figma", "screenshot"],
        dueOffsetDays: 14,
      },
      {
        title: "Development",
        description: "Build the storefront to match the approved design.",
        amount: 150_000,
        deliverables: [
          "Responsive 5-page website",
          "Deployed staging URL",
          "GitHub repository",
          "Mobile layouts",
        ],
        criteria: [
          "All agreed pages accessible and functional",
          "Responsive at 390px, 768px and 1440px",
          "No blocking defects in primary navigation or checkout",
          "Staging URL reachable and current",
          "Source repository accessible to the client",
          "Verified in current Chrome, Safari, Firefox and Edge",
        ],
        evidence: ["github_repo", "deployment_url", "screenshot"],
        dueOffsetDays: 34,
      },
      {
        title: "Launch",
        description: "Deploy to production and hand over.",
        amount: 75_000,
        deliverables: ["Production deployment", "Handover documentation", "Credentials transferred"],
        criteria: [
          "Production environment live and reachable",
          "Handover documentation delivered",
          "All accounts and credentials transferred to the client",
        ],
        evidence: ["deployment_url", "document"],
        dueOffsetDays: 48,
      },
    ],
    startedDaysAgo: 38,
    status: "in_progress",
    rules: { revisionRounds: 2, approvalWindowHours: 72, disputeWindowHours: 120 },
    sequence: 42, // VF-1042
  });

  // --- Milestone 1: Design, settled.
  settleMilestone({
    agreement,
    milestone: milestones[0],
    client: ctx.northstar,
    provider: ctx.alex,
    submittedAt: daysAgo(26, 16, 20),
    releasedAt: daysAgo(24, 11, 8),
    evidence: [
      {
        kind: "figma",
        title: "Northstar storefront — final designs",
        source: "https://figma.com/file/nsc-storefront-redesign",
        description: "All five pages at desktop and mobile widths, with the shared component library.",
        metadata: { frames: 24, pages: 5, lastEdited: daysAgo(27) },
      },
      {
        kind: "screenshot",
        title: "Responsive previews",
        source: "design-previews.zip",
        description: "Home, shop, product, cart and checkout at 390px and 1440px.",
        metadata: { files: 10, widths: ["390px", "1440px"] },
      },
    ],
  });

  // --- Milestone 2: Development, submitted and waiting for the client.
  const submittedAt = daysAgo(2, 9, 45);
  const developmentEvidence: Array<{
    kind: EvidenceKind; title: string; source: string; description: string; metadata: Record<string, unknown>;
  }> = [
    {
      kind: "github_repo",
      title: "northstar-coffee/storefront",
      source: "https://github.com/northstar-coffee/storefront",
      description: "Next.js storefront. The client has read access on the main branch.",
      metadata: {
        branch: "main",
        commits: 37,
        commitsSinceMilestone: 37,
        lastCommit: daysAgo(2, 8, 12),
        contributors: 1,
        languages: ["TypeScript", "CSS"],
      },
    },
    {
      kind: "deployment_url",
      title: "staging.northstarcoffee.com",
      source: "https://staging.northstarcoffee.com",
      description: "Staging deployment of the current main branch.",
      metadata: { status: "online", checkedAt: daysAgo(2, 9, 40), responseMs: 214, pagesDetected: 5 },
    },
    {
      kind: "screenshot",
      title: "Responsive verification",
      source: "responsive-checks.zip",
      description: "Every page captured at 390px, 768px and 1440px.",
      metadata: { files: 15, widths: ["390px", "768px", "1440px"] },
    },
    {
      kind: "note",
      title: "Submission notes",
      source: "",
      description:
        "All five pages are live on staging and responsive at the three agreed breakpoints. The checkout flow is wired to the Stripe test key. I have not yet run the cross-browser pass on Safari and Edge — flagging that rather than claiming it.",
      metadata: {},
    },
  ];

  const evidenceRecords: Evidence[] = [];
  const hashes: string[] = [];

  for (const item of developmentEvidence) {
    const hash = hashEvidence({
      kind: item.kind, source: item.source, title: item.title,
      metadata: item.metadata, submittedAt,
    });
    hashes.push(hash);
    evidenceRecords.push(
      evidenceRepo.insert({
        id: newId("evd"),
        milestoneId: milestones[1].id,
        agreementId: agreement.id,
        submittedBy: ctx.alex.id,
        round: 1,
        kind: item.kind,
        title: item.title,
        source: item.source,
        description: item.description,
        metadata: item.metadata as never,
        hash,
        submittedAt,
      }),
    );
  }

  const bundleHash = hashEvidenceBundle(hashes);
  const anchorTx = txHash(`anchor-dev-${milestones[1].id}`);
  registerHistoricalTx(anchorTx, 4_811_902);

  const reviewDueAt = new Date(Date.parse(submittedAt) + 72 * HOUR).toISOString();
  const development = milestonesRepo.update({
    ...milestones[1],
    status: "under_review",
    submittedAt,
    reviewDueAt,
  });

  // Run the real analyzer over the real evidence. The demo shows the actual
  // engine output -- including the cross-browser criterion it cannot verify.
  const analysis = await analyzeEvidence(development, evidenceRecords, 1);
  analysisRepo.insert({ ...analysis, createdAt: new Date(Date.parse(submittedAt) + 3 * 60_000).toISOString() });

  activity(agreement.id, development.id, ctx.alex.id, ctx.alex.displayName, "milestone_submitted",
    "Submitted Development for review", submittedAt, { evidenceCount: evidenceRecords.length, bundleHash }, anchorTx);
  activity(agreement.id, development.id, null, "System", "evidence_uploaded",
    `${evidenceRecords.length} evidence items recorded and hashed`,
    new Date(Date.parse(submittedAt) + 60_000).toISOString(),
    { bundleHash, kinds: evidenceRecords.map((e) => e.kind) }, anchorTx);
  activity(agreement.id, development.id, null, "Verification assistant", "evidence_analyzed",
    `Evidence analyzed: ${analysis.recommendation.replace(/_/g, " ")} (${analysis.confidence}% confidence)`,
    new Date(Date.parse(submittedAt) + 3 * 60_000).toISOString(),
    { recommendation: analysis.recommendation, confidence: analysis.confidence, engine: analysis.engine, advisory: true });

  // --- Milestone 3 stays locked until Development settles.

  notificationsRepo.insert({
    id: newId("ntf"),
    userId: ctx.northstar.id,
    kind: "milestone_ready_for_review",
    title: "Development is ready for review",
    body: "$1,500.00 is available for approval.",
    href: `/app/agreements/${agreement.id}/review/${development.id}`,
    agreementId: agreement.id,
    readAt: null,
    createdAt: submittedAt,
  });

  notificationsRepo.insert({
    id: newId("ntf"),
    userId: ctx.alex.id,
    kind: "payment_released",
    title: "Payment released",
    body: "$750.00 was released for Design.",
    href: `/app/agreements/${agreement.id}`,
    agreementId: agreement.id,
    readAt: daysAgo(23),
    createdAt: daysAgo(24, 11, 8),
  });

  indexAgreement(agreement, milestonesRepo.forAgreement(agreement.id));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function seedDemoData(): Promise<{ alexId: string; northstarId: string; operatorId: string; headlineAgreementId: string }> {
  resetRandom();

  const alex = makeUser({
    handle: "alexmorgan",
    displayName: "Alex Morgan",
    headline: "Full-stack developer",
    bio: "I build storefronts and internal tools for small teams. Ten years in, mostly TypeScript and Postgres. I work in fixed milestones with written acceptance criteria, because it makes the money conversation boring.",
    color: "#0F9D6B",
    address: DEMO_ADDRESSES.alex,
    professions: ["developer", "freelancer"],
    publicProfile: true,
    createdDaysAgo: 760,
  });

  const northstar = makeUser({
    handle: "northstarcoffee",
    displayName: "Northstar Coffee",
    headline: "Specialty coffee roaster",
    bio: "Small-batch roaster with three cafes and a growing online store.",
    color: "#B45309",
    address: DEMO_ADDRESSES.northstar,
    professions: ["client"],
    createdDaysAgo: 62,
  });

  const operator = makeUser({
    handle: "vf-operations",
    displayName: "VerseFlow Operations",
    headline: "Dispute resolution and support",
    color: "#55524B",
    address: DEMO_ADDRESSES.operator,
    isAdmin: true,
    professions: [],
    createdDaysAgo: 800,
  });

  const historicalClients = CLIENT_COMPANIES.map((company, i) =>
    makeUser({
      handle: company.handle,
      displayName: company.name,
      headline: "",
      color: company.color,
      professions: ["client"],
      createdDaysAgo: 700 - i * 30,
    }),
  );

  const ctx: SeedContext = { alex, northstar, operator, historicalClients };

  seedHistory(ctx);
  await seedHeadlineProject(ctx);

  // A short, curated public showcase rather than the whole history.
  const completed = agreementsRepo
    .forUser(alex.id)
    .filter((a) => a.status === "completed")
    .slice(0, 3);

  completed.forEach((agreement, index) => {
    showcaseRepo.upsert({
      id: newId("shw"),
      userId: alex.id,
      agreementId: agreement.id,
      publicTitle: agreement.title.split(" — ")[0],
      summary:
        index === 0
          ? "Delivered on schedule across every milestone."
          : index === 1
            ? "Multi-phase build with staged approvals."
            : "Repeat engagement with the same client.",
      anonymizeValue: index !== 0,
      position: index,
      createdAt: nowIso(),
    });
  });

  indexPublicProfile(alex);

  const headline = agreementsRepo.byReference("VF-1042");

  // Rebuild simulated escrow state so balances reconcile immediately after seeding.
  hydrateSimulatedEscrowFromDb();

  return {
    alexId: alex.id,
    northstarId: northstar.id,
    operatorId: operator.id,
    headlineAgreementId: headline?.id ?? "",
  };
}

/**
 * Rebuild the simulated escrow ledger from the database.
 *
 * Called after seeding and on server start, so a restart does not leave a funded
 * agreement pointing at escrow state that no longer exists in memory.
 */
export function hydrateSimulatedEscrowFromDb(): void {
  const records = agreementsRepo
    .all()
    .filter((a) => a.onChainId && ["funded", "in_progress", "completed", "disputed", "paused"].includes(a.status))
    .map((a) => {
      const milestones = milestonesRepo.forAgreement(a.id);
      const clientAddress = walletsRepo.primaryAddress(a.clientId) ?? "";
      const providerAddress = a.providerId ? (walletsRepo.primaryAddress(a.providerId) ?? "") : "";
      return {
        onChainId: a.onChainId!,
        clientAddress,
        providerAddress,
        termsHash: a.agreementHash ?? "",
        milestoneAmounts: milestones.map((m) => m.amount),
        milestoneReleased: milestones.map((m) => m.releasedAmount),
        cancelled: a.status === "cancelled",
      };
    });

  hydrateSimulatedEscrow(records);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function clearAllData(): void {
  const db = getDb();

  /**
   * The immutability triggers must come down BEFORE any delete, not just before
   * the explicit `DELETE FROM payments`. Removing an agreement cascades into
   * payments and activity, which would otherwise trip the very guard that makes
   * those tables append-only in normal operation.
   *
   * Wiping the environment is a different operation from editing history: it
   * throws the whole dataset away rather than rewriting individual records.
   */
  const IMMUTABILITY_TRIGGERS = [
    { name: "payments_no_delete", sql: `CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are immutable once recorded'); END;` },
    { name: "payments_confirmed_immutable", sql: `CREATE TRIGGER payments_confirmed_immutable BEFORE UPDATE ON payments WHEN OLD.status = 'confirmed' AND (NEW.amount <> OLD.amount OR NEW.recipient_address <> OLD.recipient_address OR IFNULL(NEW.tx_hash, '') <> IFNULL(OLD.tx_hash, '')) BEGIN SELECT RAISE(ABORT, 'confirmed payments cannot be altered'); END;` },
    { name: "activity_no_update", sql: `CREATE TRIGGER activity_no_update BEFORE UPDATE ON activity_events BEGIN SELECT RAISE(ABORT, 'activity events are append-only'); END;` },
    { name: "audit_log_no_update", sql: `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;` },
    { name: "audit_log_no_delete", sql: `CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;` },
  ];

  for (const trigger of IMMUTABILITY_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }

  try {
    transaction(() => {
      // Children before parents, so cascades never surprise us.
      for (const table of [
        "search_index", "analytics_events", "idempotency_keys", "rate_limits",
        "evidence_analyses", "evidence", "revision_requests", "dispute_messages",
        "disputes", "notifications", "notification_preferences", "showcase_items",
        "payments", "activity_events", "audit_log",
        "milestones", "agreements", "sessions", "wallet_addresses", "users",
      ]) {
        db.exec(`DELETE FROM ${table}`);
      }
    }, db);
  } finally {
    // Reinstated even if the wipe fails, so the guarantees are never left off.
    for (const trigger of IMMUTABILITY_TRIGGERS) {
      db.exec(trigger.sql);
    }
  }

  resetSimulatedChain();
}

export function isSeeded(): boolean {
  return agreementsRepo.byReference("VF-1042") !== null;
}
