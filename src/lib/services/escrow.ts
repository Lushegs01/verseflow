/**
 * Escrow and settlement.
 *
 * Rules this module enforces, none of which are delegated to the client:
 *
 *  - Funding requires both signatures and a terms hash that still matches.
 *  - A release cannot exceed what remains locked for that milestone, and the
 *    remaining balance is computed from the confirmed payment ledger, not from a
 *    counter that could drift.
 *  - Every payment operation is idempotent. A retried request returns the original
 *    result instead of paying twice.
 *  - A payment is only ever marked confirmed after the settlement layer confirms
 *    the transaction. A wallet returning a hash is not proof of anything.
 */

import { transaction } from "@/lib/db/client";
import {
  agreementsRepo,
  milestonesRepo,
  paymentsRepo,
  idempotencyRepo,
  walletsRepo,
  simulatedTxRepo,
} from "@/lib/db/repositories";
import type { Agreement, Milestone, Payment, PaymentKind, User } from "@/lib/domain/types";
import { AppError, errors } from "@/lib/domain/errors";
import { newId, nowIso, addHours } from "@/lib/domain/ids";
import {
  assertAgreementTransition,
  assertMilestoneTransition,
  InvalidTransitionError,
  UnauthorizedTransitionError,
} from "@/lib/domain/state-machine";
import { formatMoney } from "@/lib/domain/money";
import { getSettlementAdapter } from "@/lib/chain";
import { ChainError, type PreparedTransaction } from "@/lib/chain/adapter";
import {
  SimulatedVerseAdapter,
  hydrateSimulatedEscrow,
  ensureTxKnown,
} from "@/lib/chain/simulated-adapter";
import { hydrate, computeTermsHash, type AgreementBundle } from "./agreements";
import { recordActivity, notify, audit, track, indexPayment } from "./activity";

// ---------------------------------------------------------------------------
// Simulated escrow rehydration
// ---------------------------------------------------------------------------

/**
 * Rebuild one agreement's simulated escrow state from the database.
 *
 * The simulated ledger lives in module memory. On a long-lived server it is
 * populated once and stays warm, but on serverless every cold instance starts
 * empty -- and an API route does not pass through the layout that used to do the
 * rehydration. A release landing on a fresh instance would fail with "Escrow
 * could not be found" even though the database knows exactly what is escrowed.
 *
 * So each chain operation ensures its own agreement is present first. Scoped to a
 * single agreement rather than the whole table, and a no-op once warm.
 *
 * Live mode reads state from the chain and needs none of this.
 */
export async function ensureSimulatedEscrow(bundle: AgreementBundle): Promise<void> {
  const adapter = getSettlementAdapter();
  if (!(adapter instanceof SimulatedVerseAdapter)) return;

  const { agreement, milestones } = bundle;
  if (!agreement.onChainId || !agreement.agreementHash) return;

  // Already warm on this instance.
  if (await adapter.readAgreement(agreement.onChainId)) return;

  const clientAddress =
    bundle.clientAddress ?? (await walletsRepo.primaryAddress(agreement.clientId)) ?? "";
  const providerAddress = bundle.providerAddress ?? "";
  if (!clientAddress || !providerAddress) return;

  hydrateSimulatedEscrow([
    {
      onChainId: agreement.onChainId,
      clientAddress,
      providerAddress,
      termsHash: agreement.agreementHash,
      milestoneAmounts: milestones.map((m) => m.amount),
      // Rebuilt from the ledger, so a rehydrated instance knows exactly what has
      // already been paid and cannot re-release it.
      milestoneReleased: await Promise.all(
        milestones.map((m) => paymentsRepo.confirmedTotalForMilestone(m.id)),
      ),
      cancelled: agreement.status === "cancelled",
    },
  ]);
}

/**
 * Teach this instance about a simulated transaction it did not issue.
 *
 * The deadline comes from the durable creation timestamp, so every instance
 * reaches the same verdict.
 */
async function ensureSimulatedTx(
  adapter: ReturnType<typeof getSettlementAdapter>,
  txHash: string | null,
): Promise<void> {
  if (!txHash || !(adapter instanceof SimulatedVerseAdapter)) return;

  // Only a transaction we actually issued may be rehydrated. A hash with no
  // durable record is one we never issued, and must stay unknown so
  // verifyTransaction reports it as failed rather than confirming it.
  const issuedAt = await simulatedTxRepo.createdAt(txHash);
  if (!issuedAt) return;

  const latency = Number(process.env.SIMULATED_CONFIRM_MS ?? 2200);
  ensureTxKnown(txHash, Date.parse(issuedAt), latency);
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

export interface FundingIntent {
  agreementId: string;
  reference: string;
  amount: number;
  asset: string;
  escrowAddress: string | null;
  onChainId: string;
  termsHash: string;
  chainId: number;
  mode: "simulated" | "live";
  transaction: PreparedTransaction;
}

/**
 * Prepare escrow funding. Returns an unsigned transaction in live mode; in
 * simulated mode the adapter has already produced a receipt to poll.
 */
export async function prepareFunding(params: {
  bundle: AgreementBundle;
  actor: User;
  idempotencyKey: string;
  fromAddress: string;
}): Promise<FundingIntent> {
  const { agreement, milestones } = params.bundle;

  if (agreement.clientId !== params.actor.id) {
    throw errors.forbidden("Only the client can fund this agreement.");
  }
  if (agreement.status !== "awaiting_funding") {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      agreement.status === "funded" || agreement.status === "in_progress"
        ? "This agreement is already funded."
        : "This agreement is not ready for funding yet.",
      { hint: "Both parties must sign before escrow can be funded." },
    );
  }
  if (!agreement.clientSignature || !agreement.providerSignature) {
    throw new AppError("NOT_FUNDED", "Both signatures are required before funding.");
  }

  // Recompute the hash rather than trusting the stored one. If they differ, the
  // stored terms were altered after signing and funding must not proceed.
  const { termsHash, onChainId } = computeTermsHash(params.bundle);
  if (agreement.agreementHash && agreement.agreementHash.toLowerCase() !== termsHash.toLowerCase()) {
    throw new AppError(
      "SIGNATURE_INVALID",
      "The stored terms no longer match what was signed.",
      { hint: "Contact support. No funds have moved." },
    );
  }

  const allocated = milestones.reduce((a, m) => a + m.amount, 0);
  if (allocated !== agreement.totalAmount) {
    throw errors.amountMismatch(allocated, agreement.totalAmount);
  }

  const providerAddress = params.bundle.providerAddress;
  if (!providerAddress) {
    throw new AppError("VALIDATION_FAILED", "The provider has no wallet address on file.");
  }

  const claim = await idempotencyRepo.claim(params.idempotencyKey, "escrow.fund", params.actor.id);
  if (claim.status === "duplicate") {
    return claim.response as FundingIntent;
  }
  if (claim.status === "in_flight") {
    throw new AppError("DUPLICATE_REQUEST", "This funding request is already being processed.");
  }

  const adapter = getSettlementAdapter();

  try {
    const prepared = await adapter.prepareFunding({
      agreementId: agreement.id,
      onChainId,
      clientAddress: params.fromAddress,
      providerAddress,
      milestoneAmounts: milestones.map((m) => m.amount),
      asset: agreement.asset,
      termsHash,
    });

    if (prepared.simulatedReceipt) {
      await simulatedTxRepo.record(prepared.simulatedReceipt.txHash, "funding", agreement.id);
    }

    const intent: FundingIntent = {
      agreementId: agreement.id,
      reference: agreement.reference,
      amount: agreement.totalAmount,
      asset: agreement.asset,
      escrowAddress: adapter.escrowAddress(),
      onChainId,
      termsHash,
      chainId: adapter.chainId,
      mode: adapter.mode,
      transaction: prepared,
    };

    await agreementsRepo.update({
      ...agreement,
      onChainId,
      agreementHash: termsHash,
      escrowAddress: adapter.escrowAddress(),
      chainId: adapter.chainId,
      isSimulated: adapter.mode === "simulated",
    });

    await idempotencyRepo.complete(params.idempotencyKey, intent);
    return intent;
  } catch (error) {
    await idempotencyRepo.release(params.idempotencyKey);
    throw toAppError(error);
  }
}

/**
 * Confirm funding against the settlement layer and move the agreement forward.
 * Safe to call repeatedly -- it is the polling endpoint the funding UI drives.
 */
export async function confirmFunding(params: {
  bundle: AgreementBundle;
  actor: User;
  txHash: string;
  ip?: string | null;
}): Promise<{ status: "pending" | "confirmed" | "failed"; agreement: Agreement; reason?: string }> {
  const { agreement } = params.bundle;

  if (agreement.status === "funded" || agreement.status === "in_progress") {
    return { status: "confirmed", agreement };
  }
  if (agreement.status !== "awaiting_funding") {
    throw new AppError("INVALID_STATE_TRANSITION", "This agreement is not awaiting funding.");
  }

  const adapter = getSettlementAdapter();
  await ensureSimulatedTx(adapter, params.txHash);
  const receipt = await adapter.verifyTransaction(params.txHash).catch(toAppErrorThrow);

  if (receipt.status === "pending") {
    return { status: "pending", agreement };
  }

  if (receipt.status === "failed") {
    recordActivity({
      agreementId: agreement.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "payment_failed",
      summary: "Escrow funding did not complete",
      metadata: { reason: receipt.reason ?? "unknown" },
      txHash: params.txHash,
    });
    return { status: "failed", agreement, reason: receipt.reason };
  }

  // Confirmed. Cross-check what the escrow actually holds before believing it.
  if (agreement.onChainId) {
    const onChain = await adapter.readAgreement(agreement.onChainId).catch(() => null);
    if (onChain && onChain.totalAmount !== agreement.totalAmount) {
      throw new AppError(
        "AMOUNT_MISMATCH",
        "The escrow balance does not match the agreement value.",
        { details: { escrow: onChain.totalAmount, expected: agreement.totalAmount } },
      );
    }
  }

  return await transaction(async () => {
    assertAgreementTransition(agreement.status, "funded", "system", "confirm funding");

    let saved = await agreementsRepo.update({
      ...agreement,
      status: "funded",
      fundingTxHash: params.txHash,
      startedAt: nowIso(),
    });

    // Activate the first milestone and move straight into progress -- an agreement
    // that is funded but has no active work is a dead end for the provider.
    const milestones = await milestonesRepo.forAgreement(saved.id);
    const first = milestones.find((m) => m.status === "locked");
    if (first) {
      assertMilestoneTransition(first.status, "in_progress", "system", "activate");
      await milestonesRepo.update({ ...first, status: "in_progress" });
    }

    assertAgreementTransition(saved.status, "in_progress", "system", "start work");
    saved = await agreementsRepo.update({ ...saved, status: "in_progress" });

    recordActivity({
      agreementId: saved.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "escrow_funded",
      summary: `Escrow funded with ${formatMoney(saved.totalAmount, saved.asset)}`,
      metadata: {
        escrowAddress: saved.escrowAddress,
        simulated: receipt.simulated,
        blockNumber: receipt.blockNumber,
      },
      txHash: params.txHash,
    });

    if (first) {
      recordActivity({
        agreementId: saved.id,
        milestoneId: first.id,
        actorId: null,
        actorLabel: "System",
        type: "milestone_started",
        summary: `${first.title} is now active`,
      });
    }

    if (saved.providerId) {
      notify({
        userId: saved.providerId,
        kind: "escrow_funded",
        title: "Escrow funded, you can start work",
        body: `${formatMoney(saved.totalAmount, saved.asset)} is secured for ${saved.title}.`,
        href: `/app/agreements/${saved.id}`,
        agreementId: saved.id,
      });
    }

    audit({
      actorId: params.actor.id,
      action: "escrow.fund",
      entityType: "agreement",
      entityId: saved.id,
      after: { txHash: params.txHash, amount: saved.totalAmount, simulated: receipt.simulated },
      ip: params.ip,
    });

    track({
      name: "escrow_funded",
      userId: params.actor.id,
      agreementId: saved.id,
      properties: { amount: saved.totalAmount, asset: saved.asset, simulated: receipt.simulated },
    });

    return { status: "confirmed" as const, agreement: saved };
  });
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export interface ReleaseResult {
  payment: Payment;
  milestone: Milestone;
  agreement: Agreement;
  transaction: PreparedTransaction;
}

/**
 * Remaining releasable amount for a milestone, derived from confirmed payments.
 * The ledger is authoritative; `milestone.releasedAmount` is a cached projection.
 */
export async function remainingFor(milestone: Milestone): Promise<number> {
  const confirmed = await paymentsRepo.confirmedTotalForMilestone(milestone.id);
  const pending = (await paymentsRepo.forMilestone(milestone.id))
    .filter((p) => p.status === "pending" || p.status === "submitted")
    .reduce((a, p) => a + p.amount, 0);
  return Math.max(0, milestone.amount - confirmed - pending);
}

export async function releaseMilestone(params: {
  bundle: AgreementBundle;
  milestone: Milestone;
  actor: User;
  amount: number;
  kind: PaymentKind;
  reason: string | null;
  idempotencyKey: string;
  ip?: string | null;
}): Promise<ReleaseResult> {
  const { agreement } = params.bundle;
  const milestone = params.milestone;

  // --- Authorization: only the client releases. Not the provider, not the AI.
  if (agreement.clientId !== params.actor.id && !params.actor.isAdmin) {
    throw errors.forbidden("Only the client can release payment on this agreement.");
  }
  if (agreement.providerId === params.actor.id) {
    throw errors.forbidden("A provider cannot release payment to themselves.");
  }

  // --- Idempotency is claimed FIRST, before any state or amount validation.
  //
  // A completed key always returns its original result. That is what makes a
  // retry after a dropped response safe: the second attempt must not be
  // re-validated against a balance the first attempt already spent, and must not
  // report "already paid out" for a payment the caller never saw succeed.
  const claim = await idempotencyRepo.claim(params.idempotencyKey, "escrow.release", params.actor.id);
  if (claim.status === "duplicate") return claim.response as ReleaseResult;
  if (claim.status === "in_flight") {
    throw new AppError("DUPLICATE_REQUEST", "This release is already being processed.");
  }

  const adapter = getSettlementAdapter();
  const clientAddress =
    params.bundle.clientAddress ?? await walletsRepo.primaryAddress(agreement.clientId) ?? "";

  // A cold serverless instance holds no simulated escrow state, so rebuild this
  // agreement's before asking the adapter to release against it.
  await ensureSimulatedEscrow(params.bundle);

  try {
    // --- State. Milestone-level checks run before agreement-level ones because
    // they produce the more specific error: a settled milestone on a completed
    // agreement should say "already paid out", not "this agreement is closed".
    if (milestone.status === "released") throw errors.alreadyReleased();
    if (milestone.status === "disputed") {
      throw new AppError(
        "INVALID_STATE_TRANSITION",
        "This milestone is paused while the dispute is reviewed.",
      );
    }
    if (agreement.status !== "in_progress" && agreement.status !== "funded") {
      throw new AppError(
        "INVALID_STATE_TRANSITION",
        agreement.status === "disputed"
          ? "This milestone is paused while the dispute is reviewed."
          : "This agreement is not in a state where payments can be released.",
      );
    }

    // --- Amount, computed from the confirmed ledger plus anything already in flight.
    const remaining = await remainingFor(milestone);
    if (params.amount <= 0) {
      throw new AppError("VALIDATION_FAILED", "Enter an amount greater than zero.");
    }
    if (params.amount > remaining) {
      throw errors.insufficientEscrow(params.amount, remaining);
    }
    if (params.kind === "partial_release" && !agreement.rules.partialReleaseAllowed) {
      throw new AppError("FORBIDDEN", "Partial releases are not permitted by this agreement.");
    }
    if (params.kind === "partial_release" && !params.reason) {
      throw new AppError("VALIDATION_FAILED", "A partial release requires a reason.");
    }

    const providerAddress = params.bundle.providerAddress;
    if (!providerAddress) {
      throw new AppError("VALIDATION_FAILED", "The provider has no wallet address on file.");
    }

    const prepared = await adapter.prepareRelease({
      onChainId: agreement.onChainId ?? "",
      milestoneIndex: milestone.position,
      amount: params.amount,
      asset: agreement.asset,
      recipientAddress: providerAddress,
      clientAddress,
    });

    if (prepared.simulatedReceipt) {
      await simulatedTxRepo.record(prepared.simulatedReceipt.txHash, "release", agreement.id);
    }

    const isFull = params.amount >= remaining;

    const result = await transaction(async () => {
      // Record the payment as pending. It becomes confirmed only when the
      // settlement layer says so.
      const payment = await paymentsRepo.insert({
        id: newId("pay"),
        agreementId: agreement.id,
        milestoneId: milestone.id,
        kind: params.kind,
        amount: params.amount,
        asset: agreement.asset,
        recipientAddress: providerAddress,
        status: "pending",
        txHash: prepared.simulatedReceipt?.txHash ?? null,
        chainId: adapter.chainId,
        blockNumber: null,
        idempotencyKey: params.idempotencyKey,
        reason: params.reason,
        failureReason: null,
        isSimulated: adapter.mode === "simulated",
        initiatedBy: params.actor.id,
        createdAt: nowIso(),
        confirmedAt: null,
      });

      const nextStatus = isFull ? "approved" : "partially_approved";
      assertMilestoneTransition(
        milestone.status,
        nextStatus,
        "client",
        isFull ? "approve" : "approve_partial",
      );

      const savedMilestone = await milestonesRepo.update({
        ...milestone,
        status: nextStatus,
        approvedAt: nowIso(),
      });

      recordActivity({
        agreementId: agreement.id,
        milestoneId: milestone.id,
        actorId: params.actor.id,
        actorLabel: params.actor.displayName,
        type: isFull ? "milestone_approved" : "milestone_partially_approved",
        summary: isFull
          ? `Approved ${milestone.title} and released ${formatMoney(params.amount, agreement.asset)}`
          : `Approved a partial release of ${formatMoney(params.amount, agreement.asset)} for ${milestone.title}`,
        metadata: { amount: params.amount, reason: params.reason, remaining: remaining - params.amount },
        txHash: payment.txHash,
      });

      audit({
        actorId: params.actor.id,
        action: isFull ? "payment.release" : "payment.release_partial",
        entityType: "milestone",
        entityId: milestone.id,
        before: { status: milestone.status, released: milestone.releasedAmount },
        after: { status: nextStatus, amount: params.amount, reason: params.reason },
        ip: params.ip,
      });

      return { payment, milestone: savedMilestone, agreement, transaction: prepared };
    });

    await idempotencyRepo.complete(params.idempotencyKey, result);
    return result;
  } catch (error) {
    await idempotencyRepo.release(params.idempotencyKey);
    throw toAppError(error);
  }
}

/**
 * Verify a release transaction and settle it. This is the only path that marks a
 * payment confirmed and credits the milestone.
 */
export async function confirmRelease(params: {
  payment: Payment;
  actor: User;
  ip?: string | null;
}): Promise<{ status: "pending" | "confirmed" | "failed"; payment: Payment; reason?: string }> {
  if (params.payment.status === "confirmed") {
    return { status: "confirmed", payment: params.payment };
  }
  if (!params.payment.txHash) {
    return { status: "pending", payment: params.payment };
  }

  const adapter = getSettlementAdapter();
  await ensureSimulatedTx(adapter, params.payment.txHash);
  const receipt = await adapter.verifyTransaction(params.payment.txHash).catch(toAppErrorThrow);

  if (receipt.status === "pending") {
    return { status: "pending", payment: params.payment };
  }

  if (receipt.status === "failed") {
    const failed = await paymentsRepo.update({
      ...params.payment,
      status: "failed",
      failureReason: receipt.reason ?? "The transaction did not complete.",
    });

    const milestone = await milestonesRepo.byId(params.payment.milestoneId ?? "");
    if (milestone) {
      recordActivity({
        agreementId: params.payment.agreementId,
        milestoneId: milestone.id,
        actorId: null,
        actorLabel: "System",
        type: "payment_failed",
        summary: "Payment did not complete. Funds remain in escrow.",
        metadata: { reason: failed.failureReason },
        txHash: params.payment.txHash,
      });
    }

    return { status: "failed", payment: failed, reason: failed.failureReason ?? undefined };
  }

  // Confirmed on chain. Now, and only now, credit the milestone.
  return await transaction(async () => {
    const confirmed = await paymentsRepo.update({
      ...params.payment,
      status: "confirmed",
      blockNumber: receipt.blockNumber,
      confirmedAt: nowIso(),
    });

    const milestone = await milestonesRepo.byId(confirmed.milestoneId ?? "");
    const agreement = await agreementsRepo.byId(confirmed.agreementId);
    if (!milestone || !agreement) return { status: "confirmed" as const, payment: confirmed };

    const totalConfirmed = await paymentsRepo.confirmedTotalForMilestone(milestone.id);
    const fullyPaid = totalConfirmed >= milestone.amount;

    let savedMilestone = await milestonesRepo.update({
      ...milestone,
      releasedAmount: totalConfirmed,
      ...(fullyPaid ? { status: "released" as const, releasedAt: nowIso() } : {}),
    });

    if (fullyPaid) {
      assertMilestoneTransition(milestone.status, "released", "system", "release");

      // Activate the next milestone so the provider always has a live next step.
      const all = await milestonesRepo.forAgreement(agreement.id);
      const next = all.find((m) => m.status === "locked");
      if (next) {
        assertMilestoneTransition(next.status, "in_progress", "system", "activate");
        await milestonesRepo.update({ ...next, status: "in_progress" });
        recordActivity({
          agreementId: agreement.id,
          milestoneId: next.id,
          actorId: null,
          actorLabel: "System",
          type: "milestone_started",
          summary: `${next.title} is now active`,
        });
      }
    }

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: null,
      actorLabel: "System",
      type: "payment_released",
      summary: `Payment released: ${formatMoney(confirmed.amount, confirmed.asset)}`,
      metadata: {
        blockNumber: receipt.blockNumber,
        simulated: receipt.simulated,
        recipient: confirmed.recipientAddress,
      },
      txHash: confirmed.txHash,
    });

    if (agreement.providerId) {
      notify({
        userId: agreement.providerId,
        kind: "payment_released",
        title: "Payment released",
        body: `${formatMoney(confirmed.amount, confirmed.asset)} was released for ${milestone.title}.`,
        href: `/app/agreements/${agreement.id}`,
        agreementId: agreement.id,
      });
    }

    track({
      name: confirmed.kind === "partial_release" ? "partial_payment_executed" : "payment_released",
      userId: confirmed.initiatedBy,
      agreementId: agreement.id,
      properties: { amount: confirmed.amount, asset: confirmed.asset, simulated: confirmed.isSimulated },
    });

    indexPayment(confirmed, [agreement.clientId, agreement.providerId ?? ""].filter(Boolean), agreement.title);

    // If every milestone has settled, the agreement is complete.
    const refreshed = await milestonesRepo.forAgreement(agreement.id);
    const allSettled = refreshed.every((m) => m.status === "released" || m.status === "cancelled");
    if (allSettled && agreement.status === "in_progress") {
      assertAgreementTransition(agreement.status, "completed", "system", "complete");
      const completed = await agreementsRepo.update({
        ...agreement,
        status: "completed",
        completedAt: nowIso(),
      });
      recordActivity({
        agreementId: completed.id,
        actorId: null,
        actorLabel: "System",
        type: "agreement_completed",
        summary: "All milestones settled. Agreement complete.",
        metadata: { totalSettled: completed.totalAmount },
      });
      for (const party of [completed.clientId, completed.providerId].filter(Boolean) as string[]) {
        notify({
          userId: party,
          kind: "agreement_completed",
          title: "Agreement complete",
          body: `${completed.title} settled in full.`,
          href: `/app/agreements/${completed.id}`,
          agreementId: completed.id,
        });
      }
    }

    void savedMilestone;
    return { status: "confirmed" as const, payment: confirmed };
  });
}

// ---------------------------------------------------------------------------
// Review window
// ---------------------------------------------------------------------------

export async function openReviewWindow(milestone: Milestone, agreement: Agreement): Promise<Milestone> {
  assertMilestoneTransition(milestone.status, "under_review", "system", "open review");
  return await milestonesRepo.update({
    ...milestone,
    status: "under_review",
    reviewDueAt: addHours(nowIso(), agreement.rules.approvalWindowHours),
  });
}

// ---------------------------------------------------------------------------
// Escrow reconciliation
// ---------------------------------------------------------------------------

/**
 * Compare the database against the settlement layer. Surfaced in the operations
 * console so a divergence is visible rather than discovered by a user.
 */
export async function reconcile(agreementId: string): Promise<{
  ok: boolean;
  issues: string[];
  onChainTotal: number | null;
  ledgerTotal: number;
}> {
  const agreement = await agreementsRepo.byId(agreementId);
  if (!agreement) throw errors.notFound("Agreement");

  const ledgerTotal = (await paymentsRepo.forAgreement(agreementId))
    .filter((p) => p.status === "confirmed")
    .reduce((a, p) => a + p.amount, 0);

  if (!agreement.onChainId) {
    return { ok: true, issues: ["Agreement has not been funded yet."], onChainTotal: null, ledgerTotal };
  }

  await ensureSimulatedEscrow(await hydrate(agreement));
  const adapter = getSettlementAdapter();
  const onChain = await adapter.readAgreement(agreement.onChainId).catch(() => null);

  if (!onChain) {
    return {
      ok: false,
      issues: ["Escrow state could not be read from the settlement layer."],
      onChainTotal: null,
      ledgerTotal,
    };
  }

  const issues: string[] = [];
  if (onChain.totalReleased !== ledgerTotal) {
    issues.push(
      `Released on chain (${onChain.totalReleased}) does not match the payment ledger (${ledgerTotal}).`,
    );
  }
  if (onChain.totalAmount !== agreement.totalAmount) {
    issues.push(`Escrow holds ${onChain.totalAmount} but the agreement value is ${agreement.totalAmount}.`);
  }
  if (agreement.agreementHash && onChain.termsHash.toLowerCase() !== agreement.agreementHash.toLowerCase()) {
    issues.push("On-chain terms hash does not match the stored agreement hash.");
  }

  return { ok: issues.length === 0, issues, onChainTotal: onChain.totalReleased, ledgerTotal };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // State-machine violations are legitimate, explainable outcomes -- surface them
  // with their own code rather than burying them as an internal failure.
  if (error instanceof InvalidTransitionError) {
    return new AppError("INVALID_STATE_TRANSITION", error.message, {
      details: { from: error.from, to: error.to, action: error.action },
    });
  }
  if (error instanceof UnauthorizedTransitionError) {
    return new AppError("UNAUTHORIZED_TRANSITION", error.message, {
      details: { action: error.action, actor: error.actor },
    });
  }
  if (error instanceof ChainError) {
    if (error.kind === "unavailable") return errors.chainUnavailable(error.detail);
    if (error.kind === "reverted") return errors.transactionFailed(error.message);
    if (error.kind === "not_found") return errors.notFound("Escrow");
    return new AppError("CHAIN_UNAVAILABLE", error.message);
  }
  console.error("[verseflow:escrow]", error);
  return errors.internal();
}

function toAppErrorThrow(error: unknown): never {
  throw toAppError(error);
}

export { hydrate };
