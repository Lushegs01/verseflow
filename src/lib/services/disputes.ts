/**
 * Disputes.
 *
 * The honest position for an MVP: this is operator-mediated arbitration, not
 * decentralized arbitration. The contract has a single `arbiter` address set at
 * deployment, every resolution writes an immutable audit event, and the UI says so
 * plainly. Claiming a decentralized arbitration layer that does not exist would be
 * the kind of thing that makes a payments product untrustworthy.
 */

import { transaction } from "@/lib/db/client";
import {
  agreementsRepo,
  milestonesRepo,
  disputesRepo,
  paymentsRepo,
  idempotencyRepo,
} from "@/lib/db/repositories";
import type { Dispute, Milestone, User } from "@/lib/domain/types";
import { AppError, errors } from "@/lib/domain/errors";
import { newId, nowIso } from "@/lib/domain/ids";
import { assertAgreementTransition, assertMilestoneTransition } from "@/lib/domain/state-machine";
import { disputeOpenSchema, disputeResolveSchema } from "@/lib/domain/validation";
import { formatMoney } from "@/lib/domain/money";
import { getSettlementAdapter } from "@/lib/chain";
import { SimulatedVerseAdapter } from "@/lib/chain/simulated-adapter";
import type { AgreementBundle } from "./agreements";
import { recordActivity, notify, audit, track } from "./activity";

export function openDispute(params: {
  bundle: AgreementBundle;
  milestone: Milestone;
  actor: User;
  input: unknown;
  ip?: string | null;
}): Dispute {
  const { agreement } = params.bundle;
  const milestone = params.milestone;

  const isParty = agreement.clientId === params.actor.id || agreement.providerId === params.actor.id;
  if (!isParty) throw errors.forbidden("Only a party to this agreement can open a dispute.");

  const parsed = disputeOpenSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "A dispute needs a clear reason and detail.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }

  const existing = disputesRepo.forMilestone(milestone.id);
  if (existing && existing.status !== "resolved" && existing.status !== "withdrawn") {
    throw new AppError("CONFLICT", "A dispute is already open on this milestone.");
  }

  const role = agreement.clientId === params.actor.id ? "client" : "provider";
  const input = parsed.data;

  return transaction(() => {
    assertMilestoneTransition(milestone.status, "disputed", role, "open dispute");
    milestonesRepo.update({ ...milestone, status: "disputed" });

    if (agreement.status !== "disputed") {
      assertAgreementTransition(agreement.status, "disputed", role, "open dispute");
      agreementsRepo.update({ ...agreement, status: "disputed" });
    }

    // Freeze the escrow so nothing can be released while this is open.
    const adapter = getSettlementAdapter();
    if (adapter instanceof SimulatedVerseAdapter && agreement.onChainId) {
      adapter.flagDispute(agreement.onChainId);
    }

    const dispute = disputesRepo.insert({
      id: newId("dsp"),
      agreementId: agreement.id,
      milestoneId: milestone.id,
      openedBy: params.actor.id,
      reason: input.reason,
      detail: input.detail,
      status: "open",
      resolution: null,
      resolutionNote: null,
      resolvedProviderAmount: null,
      resolvedByUserId: null,
      openedAt: nowIso(),
      resolvedAt: null,
    });

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "dispute_opened",
      summary: `Dispute opened on ${milestone.title}: ${input.reason}`,
      metadata: { disputeId: dispute.id, openedByRole: role },
    });

    const counterpartyId = role === "client" ? agreement.providerId : agreement.clientId;
    if (counterpartyId) {
      notify({
        userId: counterpartyId,
        kind: "dispute_opened",
        title: `A dispute was opened on ${milestone.title}`,
        body: `${formatMoney(milestone.amount, agreement.asset)} is paused while this is reviewed.`,
        href: `/app/agreements/${agreement.id}/dispute/${dispute.id}`,
        agreementId: agreement.id,
      });
    }

    audit({
      actorId: params.actor.id,
      action: "dispute.open",
      entityType: "milestone",
      entityId: milestone.id,
      after: { disputeId: dispute.id, reason: input.reason },
      ip: params.ip,
    });

    track({
      name: "dispute_opened",
      userId: params.actor.id,
      agreementId: agreement.id,
      properties: { milestoneId: milestone.id, role },
    });

    return dispute;
  });
}

export function addMessage(params: {
  dispute: Dispute;
  actor: User;
  body: string;
  agreement: AgreementBundle;
}) {
  const { agreement } = params.agreement;
  const isParty = agreement.clientId === params.actor.id || agreement.providerId === params.actor.id;
  if (!isParty && !params.actor.isAdmin) {
    throw errors.forbidden("Only the parties and the reviewer can post here.");
  }
  const body = params.body.trim();
  if (body.length < 2) {
    throw new AppError("VALIDATION_FAILED", "Write a message before sending.");
  }

  const message = disputesRepo.addMessage({
    id: newId("msg"),
    disputeId: params.dispute.id,
    authorId: params.actor.id,
    body: body.slice(0, 4000),
    createdAt: nowIso(),
  });

  if (params.dispute.status === "open") {
    disputesRepo.update({ ...params.dispute, status: "negotiating" });
  }

  recordActivity({
    agreementId: agreement.id,
    milestoneId: params.dispute.milestoneId,
    actorId: params.actor.id,
    actorLabel: params.actor.displayName,
    type: "dispute_message",
    summary: "Posted a message in the dispute",
    metadata: { disputeId: params.dispute.id },
  });

  return message;
}

/**
 * Resolve a dispute.
 *
 * Both parties agreeing on a split can resolve it themselves; escalated disputes
 * are resolved by an operator. Either way the settlement runs through the same
 * ledger and audit path as any other payment -- there is no back door that moves
 * money without a record.
 */
export async function resolveDispute(params: {
  dispute: Dispute;
  bundle: AgreementBundle;
  actor: User;
  input: unknown;
  ip?: string | null;
}): Promise<{ dispute: Dispute; milestone: Milestone }> {
  const { agreement } = params.bundle;

  const parsed = disputeResolveSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "The resolution could not be recorded.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const input = parsed.data;

  if (params.dispute.status === "resolved") {
    throw new AppError("CONFLICT", "This dispute has already been resolved.");
  }

  const isAdmin = params.actor.isAdmin;
  const isClient = agreement.clientId === params.actor.id;
  const isParty = isClient || agreement.providerId === params.actor.id;

  if (!isAdmin && !isParty) {
    throw errors.forbidden("Only a party or an operator can resolve this dispute.");
  }

  // --- Withdrawal is only available to whoever raised the dispute.
  // Otherwise the counterparty could unfreeze a dispute that was not theirs.
  if (input.resolution === "withdrawn") {
    if (!isAdmin && params.dispute.openedBy !== params.actor.id) {
      throw errors.forbidden("Only the party who opened this dispute can withdraw it.");
    }
  } else if (!isAdmin && !isClient) {
    // A provider cannot award themselves the funds.
    throw errors.forbidden("Only the client or an operator can authorize a settlement amount.");
  }

  const milestone = milestonesRepo.byId(params.dispute.milestoneId);
  if (!milestone) throw errors.notFound("Milestone");

  const alreadyReleased = paymentsRepo.confirmedTotalForMilestone(milestone.id);
  const remaining = Math.max(0, milestone.amount - alreadyReleased);

  let providerAmount = 0;
  if (input.resolution === "released_full") providerAmount = remaining;
  else if (input.resolution === "released_partial" || input.resolution === "negotiated") {
    providerAmount = input.providerAmount ?? 0;
  }

  // An over-award is rejected, not silently clamped. Quietly reducing the amount
  // would let a resolver believe they awarded something they did not.
  if (providerAmount > remaining) {
    throw errors.insufficientEscrow(providerAmount, remaining);
  }

  // --- A client settling in the provider's favour is safe: they are releasing
  // money they could have released anyway. A client settling at ZERO is a refund
  // to themselves, which must not be unilateral -- the provider may have
  // delivered. That outcome requires an operator.
  if (!isAdmin && input.resolution !== "withdrawn" && providerAmount <= 0 && remaining > 0) {
    throw errors.forbidden(
      "A full refund cannot be agreed unilaterally. Escalate to operations review, or agree an amount with the provider.",
    );
  }

  const claim = idempotencyRepo.claim(input.idempotencyKey, "dispute.resolve", params.actor.id);
  if (claim.status === "duplicate") {
    return claim.response as { dispute: Dispute; milestone: Milestone };
  }
  if (claim.status === "in_flight") {
    throw new AppError("DUPLICATE_REQUEST", "This resolution is already being processed.");
  }

  try {
    const adapter = getSettlementAdapter();
    let txHash: string | null = null;

    if (input.resolution !== "withdrawn" && agreement.onChainId) {
      const prepared = await adapter.prepareDisputeSettlement({
        onChainId: agreement.onChainId,
        milestoneIndex: milestone.position,
        providerAmount,
        asset: agreement.asset,
        providerAddress: params.bundle.providerAddress ?? "",
        clientAddress: params.bundle.clientAddress ?? "",
      });
      txHash = prepared.simulatedReceipt?.txHash ?? null;
    }

    const result = transaction(() => {
      const resolvedDispute = disputesRepo.update({
        ...params.dispute,
        status: input.resolution === "withdrawn" ? "withdrawn" : "resolved",
        resolution: input.resolution,
        resolutionNote: input.note,
        resolvedProviderAmount: providerAmount,
        resolvedByUserId: params.actor.id,
        resolvedAt: nowIso(),
      });

      if (providerAmount > 0 && params.bundle.providerAddress) {
        paymentsRepo.insert({
          id: newId("pay"),
          agreementId: agreement.id,
          milestoneId: milestone.id,
          kind: "dispute_settlement",
          amount: providerAmount,
          asset: agreement.asset,
          recipientAddress: params.bundle.providerAddress,
          status: txHash ? "submitted" : "pending",
          txHash,
          chainId: adapter.chainId,
          blockNumber: null,
          idempotencyKey: input.idempotencyKey,
          reason: input.note,
          failureReason: null,
          isSimulated: adapter.mode === "simulated",
          initiatedBy: params.actor.id,
          createdAt: nowIso(),
          confirmedAt: null,
        });
      }

      // Return the milestone to a sensible state. A withdrawn dispute resumes
      // review; a settled one closes the milestone out.
      const nextStatus =
        input.resolution === "withdrawn"
          ? ("under_review" as const)
          : providerAmount >= remaining && remaining > 0
            ? ("approved" as const)
            : providerAmount > 0
              ? ("partially_approved" as const)
              : ("cancelled" as const);

      // Pass the resolver's real role rather than masquerading as "system", so
      // the state machine actually gates who may reach each outcome. A client can
      // settle in the provider's favour; only an operator can cancel a milestone.
      assertMilestoneTransition(
        milestone.status,
        nextStatus,
        isAdmin ? "admin" : isClient ? "client" : "provider",
        "resolve dispute",
      );
      const savedMilestone = milestonesRepo.update({ ...milestone, status: nextStatus });

      const openElsewhere = disputesRepo
        .forAgreement(agreement.id)
        .some((d) => d.id !== resolvedDispute.id && (d.status === "open" || d.status === "negotiating"));

      if (!openElsewhere && agreement.status === "disputed") {
        // Unfreezing the agreement is a consequence of the milestone resolving,
        // not a separate decision, so it is a system transition either way.
        assertAgreementTransition(
          agreement.status,
          "in_progress",
          isAdmin ? "admin" : "system",
          "resolve dispute",
        );
        agreementsRepo.update({ ...agreement, status: "in_progress" });
      }

      recordActivity({
        agreementId: agreement.id,
        milestoneId: milestone.id,
        actorId: params.actor.id,
        actorLabel: isAdmin ? `${params.actor.displayName} (operations)` : params.actor.displayName,
        type: "dispute_resolved",
        summary: `Dispute resolved: ${input.resolution.replace(/_/g, " ")}${
          providerAmount > 0 ? ` · ${formatMoney(providerAmount, agreement.asset)} to provider` : ""
        }`,
        metadata: {
          disputeId: resolvedDispute.id,
          providerAmount,
          clientRefund: remaining - providerAmount,
          note: input.note,
          resolvedByOperator: isAdmin,
        },
        txHash,
      });

      for (const party of [agreement.clientId, agreement.providerId].filter(Boolean) as string[]) {
        notify({
          userId: party,
          kind: "dispute_resolved",
          title: "Dispute resolved",
          body:
            providerAmount > 0
              ? `${formatMoney(providerAmount, agreement.asset)} released to the provider.`
              : "The milestone was closed without a release.",
          href: `/app/agreements/${agreement.id}`,
          agreementId: agreement.id,
        });
      }

      // Administrative resolutions are always auditable, and the audit log is
      // append-only at the database level.
      audit({
        actorId: params.actor.id,
        action: isAdmin ? "admin.dispute.resolve" : "dispute.resolve",
        entityType: "dispute",
        entityId: resolvedDispute.id,
        before: { status: params.dispute.status, milestoneStatus: milestone.status },
        after: {
          status: resolvedDispute.status,
          resolution: input.resolution,
          providerAmount,
          note: input.note,
        },
        ip: params.ip,
      });

      track({
        name: "dispute_resolved",
        userId: params.actor.id,
        agreementId: agreement.id,
        properties: { resolution: input.resolution, providerAmount, byOperator: isAdmin },
      });

      return { dispute: resolvedDispute, milestone: savedMilestone };
    });

    idempotencyRepo.complete(input.idempotencyKey, result);
    return result;
  } catch (error) {
    idempotencyRepo.release(input.idempotencyKey);
    throw error;
  }
}

export function loadDisputeDetail(disputeId: string) {
  const dispute = disputesRepo.byId(disputeId);
  if (!dispute) return null;
  return { dispute, messages: disputesRepo.messages(disputeId) };
}
