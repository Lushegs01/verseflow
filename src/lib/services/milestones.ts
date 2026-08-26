/**
 * Milestone workflow: submission, evidence, analysis, revisions.
 *
 * The provider submits with evidence; the system analyzes it and opens the client's
 * review window. The analysis is attached to the milestone as advice -- it does not
 * gate, trigger, or authorize anything.
 */

import { transaction } from "@/lib/db/client";
import {
  agreementsRepo,
  milestonesRepo,
  evidenceRepo,
  analysisRepo,
  revisionsRepo,
} from "@/lib/db/repositories";
import type { Evidence, EvidenceAnalysis, Milestone, User } from "@/lib/domain/types";
import { AppError, errors } from "@/lib/domain/errors";
import { newId, nowIso, addHours } from "@/lib/domain/ids";
import { assertMilestoneTransition } from "@/lib/domain/state-machine";
import { hashEvidence, hashEvidenceBundle } from "@/lib/domain/hashing";
import { milestoneSubmissionSchema, revisionRequestSchema } from "@/lib/domain/validation";
import { analyzeEvidence } from "@/lib/ai/evidence-analyzer";
import { getSettlementAdapter } from "@/lib/chain";
import { formatMoney } from "@/lib/domain/money";
import type { AgreementBundle } from "./agreements";
import { recordActivity, notify, audit, track } from "./activity";

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmissionResult {
  milestone: Milestone;
  evidence: Evidence[];
  analysis: EvidenceAnalysis;
  bundleHash: string;
  anchorTxHash: string | null;
}

export async function submitMilestone(params: {
  bundle: AgreementBundle;
  milestone: Milestone;
  actor: User;
  input: unknown;
  ip?: string | null;
}): Promise<SubmissionResult> {
  const { agreement } = params.bundle;
  const milestone = params.milestone;

  // --- Authorization: only the provider submits.
  if (agreement.providerId !== params.actor.id) {
    throw errors.forbidden("Only the provider can submit this milestone.");
  }

  // --- The agreement must actually hold funds.
  if (agreement.status !== "in_progress" && agreement.status !== "funded") {
    throw agreement.status === "awaiting_funding" || agreement.status === "awaiting_signature"
      ? errors.notFunded()
      : new AppError("INVALID_STATE_TRANSITION", "This agreement is not accepting submissions right now.");
  }

  // --- State validity is checked before the content of the submission, so a
  // milestone that is already under review says so rather than complaining about
  // missing evidence.
  const isRevision = milestone.status === "revision_requested";
  if (milestone.status !== "in_progress" && !isRevision) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      milestone.status === "submitted" || milestone.status === "under_review"
        ? "This milestone has already been submitted and is waiting on the client."
        : milestone.status === "released"
          ? "This milestone has already been paid out."
          : `Cannot submit a milestone that is currently "${milestone.status.replace(/_/g, " ")}".`,
    );
  }

  const parsed = milestoneSubmissionSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "The submission could not be saved.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const submission = parsed.data;

  // --- Revision limit.
  if (isRevision && milestone.revisionCount >= agreement.rules.revisionRounds) {
    throw errors.revisionLimit(milestone.revisionCount, agreement.rules.revisionRounds);
  }

  const round = milestone.revisionCount + 1;

  // --- Evidence requirement, enforced server-side.
  const note = submission.note.trim();
  const hasEvidence = submission.evidence.length > 0 || note.length > 0;
  if (agreement.rules.evidenceRequired && !hasEvidence) {
    throw errors.evidenceRequired();
  }

  const missingRequired = milestone.requiredEvidence.filter(
    (kind) => !submission.evidence.some((e) => e.kind === kind),
  );
  if (agreement.rules.evidenceRequired && missingRequired.length > 0 && submission.evidence.length === 0) {
    throw errors.evidenceRequired();
  }

  const submittedAt = nowIso();

  // Persist evidence first so the analysis runs against stored records.
  const evidence = transaction(() => {
    assertMilestoneTransition(
      milestone.status,
      "submitted",
      "provider",
      isRevision ? "submit revision" : "submit",
    );

    const records: Evidence[] = [];

    if (note.length > 0) {
      records.push(
        evidenceRepo.insert({
          id: newId("evd"),
          milestoneId: milestone.id,
          agreementId: agreement.id,
          submittedBy: params.actor.id,
          round,
          kind: "note",
          title: isRevision ? `Revision ${round - 1} notes` : "Submission notes",
          source: "",
          description: note,
          metadata: {},
          hash: hashEvidence({
            kind: "note",
            source: "",
            title: "Submission notes",
            metadata: { note },
            submittedAt,
          }),
          submittedAt,
        }),
      );
    }

    for (const item of submission.evidence) {
      records.push(
        evidenceRepo.insert({
          id: newId("evd"),
          milestoneId: milestone.id,
          agreementId: agreement.id,
          submittedBy: params.actor.id,
          round,
          kind: item.kind,
          title: item.title,
          source: item.source,
          description: item.description,
          metadata: item.metadata,
          hash: hashEvidence({
            kind: item.kind,
            source: item.source,
            title: item.title,
            metadata: item.metadata,
            submittedAt,
          }),
          submittedAt,
        }),
      );
    }

    milestonesRepo.update({ ...milestone, status: "submitted", submittedAt });
    revisionsRepo.resolveOpen(milestone.id);
    return records;
  });

  // --- Anchor the evidence bundle. A failure here must not lose the submission,
  // so it is best-effort and reported rather than thrown.
  const bundleHash = hashEvidenceBundle(evidence.map((e) => e.hash));
  let anchorTxHash: string | null = null;
  if (agreement.onChainId) {
    try {
      const adapter = getSettlementAdapter();
      const prepared = await adapter.prepareEvidenceAnchor({
        onChainId: agreement.onChainId,
        milestoneIndex: milestone.position,
        round,
        bundleHash,
        submitterAddress: params.bundle.providerAddress ?? "",
      });
      anchorTxHash = prepared.simulatedReceipt?.txHash ?? null;
    } catch (error) {
      console.error("[verseflow:milestones] evidence anchor failed", error);
    }
  }

  // --- Analysis runs over ALL evidence for the milestone, not just this round.
  //
  // A revision usually adds evidence rather than replacing it: a provider fixing a
  // header should not lose credit for the repository they linked in round one.
  // Analyzing only the latest round would make every revision look worse than the
  // original submission, which is exactly backwards.
  const cumulativeEvidence = evidenceRepo.forMilestone(milestone.id);
  const analysis = await analyzeEvidence(
    { ...milestone, status: "submitted" },
    cumulativeEvidence,
    round,
  );

  const result = transaction(() => {
    analysisRepo.insert(analysis);

    const reviewing = milestonesRepo.byId(milestone.id);
    if (!reviewing) throw errors.notFound("Milestone");

    assertMilestoneTransition(reviewing.status, "under_review", "system", "open review");
    const saved = milestonesRepo.update({
      ...reviewing,
      status: "under_review",
      reviewDueAt: addHours(nowIso(), agreement.rules.approvalWindowHours),
      revisionCount: isRevision ? reviewing.revisionCount : reviewing.revisionCount,
    });

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: isRevision ? "revision_submitted" : "milestone_submitted",
      summary: isRevision
        ? `Submitted revised work for ${milestone.title}`
        : `Submitted ${milestone.title} for review`,
      metadata: { evidenceCount: evidence.length, round, bundleHash },
      txHash: anchorTxHash,
    });

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: null,
      actorLabel: "System",
      type: "evidence_uploaded",
      summary: `${evidence.length} evidence ${evidence.length === 1 ? "item" : "items"} recorded and hashed`,
      metadata: { bundleHash, kinds: evidence.map((e) => e.kind) },
      txHash: anchorTxHash,
    });

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: null,
      actorLabel: "Verification assistant",
      type: "evidence_analyzed",
      summary: `Evidence analyzed: ${analysis.recommendation.replace(/_/g, " ")} (${analysis.confidence}% confidence)`,
      metadata: {
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        engine: analysis.engine,
        advisory: true,
      },
    });

    notify({
      userId: agreement.clientId,
      kind: "milestone_ready_for_review",
      title: `${milestone.title} is ready for review`,
      body: `${formatMoney(milestone.amount, agreement.asset)} is available for approval.`,
      href: `/app/agreements/${agreement.id}/review/${milestone.id}`,
      agreementId: agreement.id,
    });

    audit({
      actorId: params.actor.id,
      action: isRevision ? "milestone.submit_revision" : "milestone.submit",
      entityType: "milestone",
      entityId: milestone.id,
      before: { status: milestone.status },
      after: { status: "under_review", round, bundleHash },
      ip: params.ip,
    });

    track({
      name: "milestone_submitted",
      userId: params.actor.id,
      agreementId: agreement.id,
      properties: { round, evidenceCount: evidence.length, isRevision },
    });

    track({
      name: "evidence_uploaded",
      userId: params.actor.id,
      agreementId: agreement.id,
      properties: { count: evidence.length, kinds: evidence.map((e) => e.kind) },
    });

    return saved;
  });

  return { milestone: result, evidence, analysis, bundleHash, anchorTxHash };
}

// ---------------------------------------------------------------------------
// Revision request
// ---------------------------------------------------------------------------

export function requestRevision(params: {
  bundle: AgreementBundle;
  milestone: Milestone;
  actor: User;
  input: unknown;
  ip?: string | null;
}): { milestone: Milestone; revisionsUsed: number; revisionsAllowed: number } {
  const { agreement } = params.bundle;
  const milestone = params.milestone;

  if (agreement.clientId !== params.actor.id) {
    throw errors.forbidden("Only the client can request a revision.");
  }

  const parsed = revisionRequestSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "A revision request needs a specific, actionable explanation.", {
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }

  // The revision mechanism protects the client, but unlimited revisions are how it
  // gets abused. The cap is agreed up front and enforced here.
  if (milestone.revisionCount >= agreement.rules.revisionRounds) {
    throw errors.revisionLimit(milestone.revisionCount, agreement.rules.revisionRounds);
  }

  const input = parsed.data;

  return transaction(() => {
    assertMilestoneTransition(milestone.status, "revision_requested", "client", "request revision");

    const nextCount = milestone.revisionCount + 1;
    const saved = milestonesRepo.update({
      ...milestone,
      status: "revision_requested",
      revisionCount: nextCount,
      reviewDueAt: null,
    });

    revisionsRepo.insert({
      id: newId("rev"),
      agreementId: agreement.id,
      milestoneId: milestone.id,
      requestedBy: params.actor.id,
      round: nextCount,
      issue: input.issue,
      requestedAction: input.requestedAction,
      unmetCriterionIds: input.unmetCriterionIds,
      resolvedAt: null,
      createdAt: nowIso(),
    });

    recordActivity({
      agreementId: agreement.id,
      milestoneId: milestone.id,
      actorId: params.actor.id,
      actorLabel: params.actor.displayName,
      type: "revision_requested",
      summary: `Requested a revision on ${milestone.title}`,
      metadata: {
        issue: input.issue,
        requestedAction: input.requestedAction,
        revisionsUsed: nextCount,
        revisionsAllowed: agreement.rules.revisionRounds,
      },
    });

    if (agreement.providerId) {
      notify({
        userId: agreement.providerId,
        kind: "revision_requested",
        title: `Revision requested on ${milestone.title}`,
        body: input.issue.slice(0, 160),
        href: `/app/agreements/${agreement.id}`,
        agreementId: agreement.id,
      });
    }

    audit({
      actorId: params.actor.id,
      action: "milestone.request_revision",
      entityType: "milestone",
      entityId: milestone.id,
      before: { status: milestone.status, revisionCount: milestone.revisionCount },
      after: { status: "revision_requested", revisionCount: nextCount },
      ip: params.ip,
    });

    track({
      name: "revision_requested",
      userId: params.actor.id,
      agreementId: agreement.id,
      properties: { round: nextCount, milestoneId: milestone.id },
    });

    return {
      milestone: saved,
      revisionsUsed: nextCount,
      revisionsAllowed: agreement.rules.revisionRounds,
    };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface MilestoneDetail {
  milestone: Milestone;
  evidence: Evidence[];
  analysis: EvidenceAnalysis | null;
  revisions: ReturnType<typeof revisionsRepo.forMilestone>;
  remaining: number;
  isOverdue: boolean;
  reviewOverdue: boolean;
}

export function loadMilestoneDetail(milestone: Milestone): MilestoneDetail {
  const evidence = evidenceRepo.forMilestone(milestone.id);
  const analysis = analysisRepo.latestForMilestone(milestone.id);
  const revisions = revisionsRepo.forMilestone(milestone.id);
  const now = Date.now();

  return {
    milestone,
    evidence,
    analysis,
    revisions,
    remaining: Math.max(0, milestone.amount - milestone.releasedAmount),
    isOverdue:
      Boolean(milestone.dueAt) &&
      Date.parse(milestone.dueAt as string) < now &&
      milestone.status !== "released" &&
      milestone.status !== "cancelled",
    reviewOverdue: Boolean(milestone.reviewDueAt) && Date.parse(milestone.reviewDueAt as string) < now,
  };
}

/** Re-run analysis on an existing submission, e.g. after a model key is configured. */
export async function reanalyze(milestone: Milestone): Promise<EvidenceAnalysis> {
  const round = Math.max(1, milestone.revisionCount + 1);
  // Cumulative, matching `submitMilestone`: evidence from earlier rounds is still
  // valid and still counts toward the acceptance criteria.
  const analysis = await analyzeEvidence(milestone, evidenceRepo.forMilestone(milestone.id), round);
  analysisRepo.insert(analysis);
  return analysis;
}

export { agreementsRepo };
