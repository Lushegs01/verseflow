/**
 * Agreement service: create, edit, sign, lock.
 *
 * The lock step is where a mutable draft becomes an immutable contract. After it,
 * terms cannot be edited -- only the state machine moves things forward. Every
 * write here re-validates the financial invariants server-side, regardless of what
 * the client already checked.
 */

import { transaction } from "@/lib/db/client";
import {
  agreementsRepo,
  milestonesRepo,
  usersRepo,
  walletsRepo,
} from "@/lib/db/repositories";
import type {
  Agreement,
  AgreementRules,
  Milestone,
  PartyRole,
  PartySignature,
  User,
} from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";
import { agreementDraftSchema, type AgreementDraftInput } from "@/lib/domain/validation";
import { AppError, errors } from "@/lib/domain/errors";
import { newId, newReference, nowIso } from "@/lib/domain/ids";
import { assertAgreementTransition } from "@/lib/domain/state-machine";
import { canonicalTerms, hashTerms, deriveOnChainId } from "@/lib/domain/hashing";
import { formatMoney } from "@/lib/domain/money";
import { getChainConfig } from "@/lib/chain/config";
import { recordActivity, notify, audit, track, indexAgreement } from "./activity";

export interface AgreementBundle {
  agreement: Agreement;
  milestones: Milestone[];
  client: User | null;
  provider: User | null;
  clientAddress: string | null;
  providerAddress: string | null;
}

export function loadBundle(agreementId: string): AgreementBundle | null {
  const agreement = agreementsRepo.byId(agreementId);
  if (!agreement) return null;
  return hydrate(agreement);
}

export function hydrate(agreement: Agreement): AgreementBundle {
  const milestones = milestonesRepo.forAgreement(agreement.id);
  const client = usersRepo.byId(agreement.clientId);
  const provider = agreement.providerId ? usersRepo.byId(agreement.providerId) : null;
  return {
    agreement,
    milestones,
    client,
    provider,
    clientAddress: client ? walletsRepo.primaryAddress(client.id) : null,
    providerAddress: provider
      ? walletsRepo.primaryAddress(provider.id)
      : agreement.providerInviteAddress,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createAgreement(params: {
  input: unknown;
  creator: User;
  creatorRole: PartyRole;
  ip?: string | null;
}): AgreementBundle {
  const parsed = agreementDraftSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "The agreement could not be saved.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const draft = parsed.data;

  // Resolve the counterparty. An agreement can be created before the other party
  // has joined -- they are invited by address and linked on their first sign-in.
  const counterparty = resolveCounterparty(draft, params.creator);

  const now = nowIso();
  const chainCfg = getChainConfig();

  return transaction(() => {
    const agreement: Agreement = {
      id: newId("agr"),
      reference: newReference(agreementsRepo.nextSequence()),
      title: draft.title,
      description: draft.description,
      clientId: params.creatorRole === "client" ? params.creator.id : counterparty.userId ?? params.creator.id,
      providerId: params.creatorRole === "provider" ? params.creator.id : counterparty.userId,
      providerInviteAddress: params.creatorRole === "provider" ? null : counterparty.address,
      totalAmount: draft.totalAmount,
      asset: draft.asset,
      status: "draft",
      agreementHash: null,
      onChainId: null,
      escrowAddress: null,
      fundingTxHash: null,
      chainId: chainCfg.chainId,
      rules: draft.rules as AgreementRules,
      clientSignature: null,
      providerSignature: null,
      expectedCompletionAt: draft.expectedCompletionAt,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      isSimulated: chainCfg.mode === "simulated",
      createdAt: now,
      updatedAt: now,
    };

    // When the provider creates the agreement, the client is the invited party.
    if (params.creatorRole === "provider" && counterparty.userId) {
      agreement.clientId = counterparty.userId;
      agreement.providerInviteAddress = null;
    } else if (params.creatorRole === "provider" && !counterparty.userId) {
      // A provider-initiated agreement needs a client; without a resolvable one we
      // cannot proceed, because escrow funding is a client action.
      throw new AppError("VALIDATION_FAILED", "Add the client's wallet address or handle.", {
        details: { field: "providerInviteAddress" },
      });
    }

    agreementsRepo.insert(agreement);

    const milestones = draft.milestones.map((m, index) =>
      milestonesRepo.insert(buildMilestone(m, agreement.id, index, now)),
    );

    recordActivity({
      agreementId: agreement.id,
      actorId: params.creator.id,
      actorLabel: params.creator.displayName,
      type: "agreement_created",
      summary: `Created ${agreement.reference} for ${formatMoney(agreement.totalAmount, agreement.asset)}`,
      metadata: { milestoneCount: milestones.length },
    });

    audit({
      actorId: params.creator.id,
      action: "agreement.create",
      entityType: "agreement",
      entityId: agreement.id,
      after: { reference: agreement.reference, totalAmount: agreement.totalAmount },
      ip: params.ip,
    });

    track({
      name: "agreement_created",
      userId: params.creator.id,
      agreementId: agreement.id,
      properties: {
        totalAmount: agreement.totalAmount,
        asset: agreement.asset,
        milestoneCount: milestones.length,
        role: params.creatorRole,
      },
    });

    indexAgreement(agreement, milestones);
    return hydrate(agreement);
  });
}

function resolveCounterparty(
  draft: AgreementDraftInput,
  creator: User,
): { userId: string | null; address: string | null } {
  if (draft.providerHandle) {
    const user = usersRepo.byHandle(draft.providerHandle);
    if (user) {
      if (user.id === creator.id) {
        throw new AppError("VALIDATION_FAILED", "You cannot be both parties on an agreement.");
      }
      return { userId: user.id, address: walletsRepo.primaryAddress(user.id) };
    }
  }
  if (draft.providerInviteAddress) {
    const existing = usersRepo.byAddress(draft.providerInviteAddress);
    if (existing && existing.id === creator.id) {
      throw new AppError("VALIDATION_FAILED", "You cannot be both parties on an agreement.");
    }
    return { userId: existing?.id ?? null, address: draft.providerInviteAddress };
  }
  return { userId: null, address: null };
}

function buildMilestone(
  input: AgreementDraftInput["milestones"][number],
  agreementId: string,
  index: number,
  now: string,
): Milestone {
  return {
    id: input.id ?? newId("mst"),
    agreementId,
    position: index,
    title: input.title,
    description: input.description,
    amount: input.amount,
    dueAt: input.dueAt,
    deliverables: input.deliverables,
    acceptanceCriteria: input.acceptanceCriteria,
    requiredEvidence: input.requiredEvidence,
    status: "locked",
    revisionCount: 0,
    releasedAmount: 0,
    submittedAt: null,
    approvedAt: null,
    releasedAt: null,
    reviewDueAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Update a draft. Only permitted while the agreement is a draft -- once signatures
 * are being collected, the terms people are signing must stop moving.
 */
export function updateAgreement(params: {
  agreement: Agreement;
  input: unknown;
  actor: User;
  ip?: string | null;
}): AgreementBundle {
  if (params.agreement.status !== "draft") {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "This agreement can no longer be edited.",
      { hint: "Terms are locked once signatures are being collected." },
    );
  }

  const parsed = agreementDraftSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "The changes could not be saved.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const draft = parsed.data;
  const now = nowIso();

  return transaction(() => {
    const updated = agreementsRepo.update({
      ...params.agreement,
      title: draft.title,
      description: draft.description,
      totalAmount: draft.totalAmount,
      asset: draft.asset,
      rules: draft.rules as AgreementRules,
      expectedCompletionAt: draft.expectedCompletionAt,
    });

    // Milestones are replaced wholesale. A draft has no payment history, so there
    // is nothing to preserve, and this keeps ordering and ids consistent.
    milestonesRepo.deleteForAgreement(updated.id);
    const milestones = draft.milestones.map((m, index) =>
      milestonesRepo.insert(buildMilestone(m, updated.id, index, now)),
    );

    recordActivity({
      agreementId: updated.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "agreement_updated",
      summary: "Updated the agreement terms",
      metadata: { totalAmount: updated.totalAmount, milestoneCount: milestones.length },
    });

    audit({
      actorId: params.actor.id,
      action: "agreement.update",
      entityType: "agreement",
      entityId: updated.id,
      before: { totalAmount: params.agreement.totalAmount },
      after: { totalAmount: updated.totalAmount },
      ip: params.ip,
    });

    indexAgreement(updated, milestones);
    return hydrate(updated);
  });
}

// ---------------------------------------------------------------------------
// Signature collection
// ---------------------------------------------------------------------------

export function sendForSignature(params: { agreement: Agreement; actor: User }): Agreement {
  assertAgreementTransition(
    params.agreement.status,
    "awaiting_signature",
    roleOrSystem(params.agreement, params.actor),
    "send for signature",
  );

  const bundle = hydrate(params.agreement);
  if (!bundle.providerAddress) {
    throw new AppError("VALIDATION_FAILED", "Add the provider's wallet address before requesting signatures.");
  }
  if (bundle.milestones.length === 0) {
    throw new AppError("VALIDATION_FAILED", "Add at least one milestone before requesting signatures.");
  }

  // Re-verify the arithmetic at the boundary. This is the last chance to catch a
  // mismatch before people start signing.
  const allocated = bundle.milestones.reduce((a, m) => a + m.amount, 0);
  if (allocated !== params.agreement.totalAmount) {
    throw errors.amountMismatch(allocated, params.agreement.totalAmount);
  }

  const updated = agreementsRepo.update({ ...params.agreement, status: "awaiting_signature" });

  recordActivity({
    agreementId: updated.id,
    actorId: params.actor.id,
    actorLabel: params.actor.displayName,
    type: "agreement_updated",
    summary: "Sent the agreement for signature",
  });

  const counterpartyId =
    params.actor.id === updated.clientId ? updated.providerId : updated.clientId;
  if (counterpartyId) {
    notify({
      userId: counterpartyId,
      kind: "agreement_awaiting_signature",
      title: "An agreement is waiting for your signature",
      body: `${updated.title} · ${formatMoney(updated.totalAmount, updated.asset)}`,
      href: `/app/agreements/${updated.id}`,
      agreementId: updated.id,
    });
  }

  return updated;
}

/**
 * Compute the terms hash for an agreement. Both parties sign this exact value, and
 * it is what the escrow contract stores.
 */
export function computeTermsHash(bundle: AgreementBundle): {
  termsHash: `0x${string}`;
  onChainId: `0x${string}`;
} {
  if (!bundle.clientAddress || !bundle.providerAddress) {
    throw new AppError("VALIDATION_FAILED", "Both parties need a wallet address before signing.");
  }
  const terms = canonicalTerms(bundle.agreement, bundle.milestones, {
    clientAddress: bundle.clientAddress,
    providerAddress: bundle.providerAddress,
  });
  const termsHash = hashTerms(terms);
  const onChainId = deriveOnChainId(termsHash, bundle.clientAddress, bundle.providerAddress);
  return { termsHash, onChainId };
}

export function signAgreement(params: {
  agreement: Agreement;
  actor: User;
  role: PartyRole;
  address: string;
  signature: string;
  termsHash: string;
  ip?: string | null;
}): { agreement: Agreement; bothSigned: boolean } {
  if (params.agreement.status !== "awaiting_signature") {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "This agreement is not currently collecting signatures.",
    );
  }

  const bundle = hydrate(params.agreement);
  const { termsHash, onChainId } = computeTermsHash(bundle);

  // The signature must cover the terms as they exist right now. If the hash the
  // client signed differs, the terms changed underneath them and the signature is
  // rejected rather than silently accepted against different terms.
  if (params.termsHash.toLowerCase() !== termsHash.toLowerCase()) {
    throw new AppError(
      "SIGNATURE_INVALID",
      "The terms changed since this signature was prepared.",
      { hint: "Reload the agreement and sign again." },
    );
  }

  const existing =
    params.role === "client" ? params.agreement.clientSignature : params.agreement.providerSignature;
  if (existing) {
    throw new AppError("ALREADY_SIGNED", "You have already signed this agreement.");
  }

  const signature: PartySignature = {
    userId: params.actor.id,
    address: params.address,
    termsHash,
    signature: params.signature,
    signedAt: nowIso(),
    method: params.signature.startsWith("simulated:") ? "simulated_signature" : "wallet_signature",
  };

  return transaction(() => {
    let next: Agreement = {
      ...params.agreement,
      clientSignature: params.role === "client" ? signature : params.agreement.clientSignature,
      providerSignature: params.role === "provider" ? signature : params.agreement.providerSignature,
    };

    const bothSigned = Boolean(next.clientSignature && next.providerSignature);

    if (bothSigned) {
      // Lock: the terms hash and on-chain id are written now and never change.
      assertAgreementTransition(next.status, "awaiting_funding", "system", "lock agreement");
      next = {
        ...next,
        status: "awaiting_funding",
        agreementHash: termsHash,
        onChainId,
      };
    }

    const saved = agreementsRepo.update(next);

    recordActivity({
      agreementId: saved.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "agreement_signed",
      summary: `${params.role === "client" ? "Client" : "Provider"} signed the agreement`,
      metadata: { termsHash, method: signature.method },
    });

    if (bothSigned) {
      recordActivity({
        agreementId: saved.id,
        actorId: null,
        actorLabel: "System",
        type: "agreement_locked",
        summary: "Both parties signed. Terms are locked.",
        metadata: { termsHash, onChainId },
      });

      notify({
        userId: saved.clientId,
        kind: "agreement_awaiting_signature",
        title: "Agreement locked, ready to fund",
        body: `${saved.title} · ${formatMoney(saved.totalAmount, saved.asset)} is ready for escrow funding.`,
        href: `/app/agreements/${saved.id}/fund`,
        agreementId: saved.id,
      });
    } else {
      const counterpartyId = params.role === "client" ? saved.providerId : saved.clientId;
      if (counterpartyId) {
        notify({
          userId: counterpartyId,
          kind: "agreement_awaiting_signature",
          title: "Your signature is needed",
          body: `The other party signed ${saved.reference}.`,
          href: `/app/agreements/${saved.id}`,
          agreementId: saved.id,
        });
      }
    }

    audit({
      actorId: params.actor.id,
      action: "agreement.sign",
      entityType: "agreement",
      entityId: saved.id,
      after: { role: params.role, termsHash, bothSigned },
      ip: params.ip,
    });

    track({
      name: "agreement_signed",
      userId: params.actor.id,
      agreementId: saved.id,
      properties: { role: params.role, bothSigned },
    });

    return { agreement: saved, bothSigned };
  });
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export function cancelAgreement(params: {
  agreement: Agreement;
  actor: User;
  reason: string;
  ip?: string | null;
}): Agreement {
  const role = roleOrSystem(params.agreement, params.actor);
  assertAgreementTransition(params.agreement.status, "cancelled", role, "cancel");

  return transaction(() => {
    const saved = agreementsRepo.update({
      ...params.agreement,
      status: "cancelled",
      cancelledAt: nowIso(),
    });

    for (const milestone of milestonesRepo.forAgreement(saved.id)) {
      if (milestone.status === "locked" || milestone.status === "in_progress") {
        milestonesRepo.update({ ...milestone, status: "cancelled" });
      }
    }

    recordActivity({
      agreementId: saved.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "agreement_cancelled",
      summary: "Agreement cancelled",
      metadata: { reason: params.reason },
    });

    audit({
      actorId: params.actor.id,
      action: "agreement.cancel",
      entityType: "agreement",
      entityId: saved.id,
      before: { status: params.agreement.status },
      after: { status: "cancelled", reason: params.reason },
      ip: params.ip,
    });

    return saved;
  });
}

function roleOrSystem(agreement: Agreement, user: User): PartyRole | "admin" {
  if (user.isAdmin && agreement.clientId !== user.id && agreement.providerId !== user.id) {
    return "admin";
  }
  return agreement.clientId === user.id ? "client" : "provider";
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function listForUser(userId: string): AgreementBundle[] {
  return agreementsRepo.forUser(userId).map(hydrate);
}

export interface AgreementProgress {
  totalMilestones: number;
  completedMilestones: number;
  releasedAmount: number;
  lockedAmount: number;
  percentComplete: number;
  currentMilestone: Milestone | null;
  nextDeadline: string | null;
}

export function computeProgress(bundle: AgreementBundle): AgreementProgress {
  const { milestones, agreement } = bundle;
  const completed = milestones.filter((m) => m.status === "released").length;
  const released = milestones.reduce((a, m) => a + m.releasedAmount, 0);

  const current =
    milestones.find((m) => m.status === "submitted" || m.status === "under_review") ??
    milestones.find((m) => m.status === "revision_requested") ??
    milestones.find((m) => m.status === "in_progress") ??
    milestones.find((m) => m.status === "approved" || m.status === "partially_approved") ??
    null;

  const upcoming = milestones
    .filter((m) => m.dueAt && m.status !== "released" && m.status !== "cancelled")
    .map((m) => m.dueAt as string)
    .sort();

  return {
    totalMilestones: milestones.length,
    completedMilestones: completed,
    releasedAmount: released,
    lockedAmount: Math.max(0, agreement.totalAmount - released),
    percentComplete:
      agreement.totalAmount > 0 ? Math.round((released / agreement.totalAmount) * 100) : 0,
    currentMilestone: current,
    nextDeadline: upcoming[0] ?? null,
  };
}

export { DEFAULT_AGREEMENT_RULES };
