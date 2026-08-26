/**
 * Product analytics.
 *
 * These are the numbers that answer "is this working?" -- activation, funding
 * conversion, completion, settled volume, dispute rate, time to settlement.
 * Vanity counts are deliberately not the headline.
 */

import {
  agreementsRepo,
  milestonesRepo,
  paymentsRepo,
  disputesRepo,
  analyticsRepo,
  usersRepo,
} from "@/lib/db/repositories";
import { daysBetween } from "@/lib/domain/ids";

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Conversion from the previous stage, 0-100. */
  conversion: number | null;
  caption: string;
}

export interface ProductMetrics {
  // Headline
  agreementsCreated: number;
  fundingVolume: number;
  paymentVolume: number;
  milestonesCompleted: number;
  uniqueUsers: number;
  repeatUsers: number;

  // Rates
  activationRate: number;
  fundingConversion: number;
  completionRate: number;
  milestoneApprovalRate: number;
  disputeRate: number;

  // Timing
  avgTimeToMilestoneDays: number;
  avgTimeToSettlementDays: number;
  avgAgreementValue: number;

  funnel: FunnelStage[];
  eventCounts: Record<string, number>;
  volumeByWeek: Array<{ week: string; funded: number; released: number }>;
  asset: string;
}

export function computeProductMetrics(): ProductMetrics {
  const agreements = agreementsRepo.all();
  const users = usersRepo.all();
  const payments = paymentsRepo.all();
  const disputes = disputesRepo.all();

  const signed = agreements.filter((a) =>
    ["awaiting_funding", "funded", "in_progress", "completed", "disputed", "paused"].includes(a.status),
  );
  const funded = agreements.filter((a) =>
    ["funded", "in_progress", "completed", "disputed", "paused"].includes(a.status),
  );
  const completed = agreements.filter((a) => a.status === "completed");

  const confirmedPayments = payments.filter((p) => p.status === "confirmed");
  const paymentVolume = confirmedPayments.reduce((a, p) => a + p.amount, 0);
  const fundingVolume = funded.reduce((a, p) => a + p.totalAmount, 0);

  // Activation: a user who created at least one agreement.
  const creators = new Set(agreements.map((a) => a.clientId));
  for (const a of agreements) if (a.providerId) creators.add(a.providerId);
  const activationRate = users.length > 0 ? Math.round((creators.size / users.length) * 100) : 0;

  // Repeat usage: users party to more than one agreement.
  const perUser = new Map<string, number>();
  for (const a of agreements) {
    perUser.set(a.clientId, (perUser.get(a.clientId) ?? 0) + 1);
    if (a.providerId) perUser.set(a.providerId, (perUser.get(a.providerId) ?? 0) + 1);
  }
  const repeatUsers = Array.from(perUser.values()).filter((c) => c > 1).length;

  const allMilestones = milestonesRepo.all();
  const releasedMilestones = allMilestones.filter((m) => m.status === "released");
  const reviewedMilestones = allMilestones.filter((m) =>
    ["released", "approved", "partially_approved", "revision_requested", "disputed"].includes(m.status),
  );
  const approvedMilestones = allMilestones.filter((m) =>
    ["released", "approved", "partially_approved"].includes(m.status),
  );

  // Time from submission to release, in days.
  const milestoneDurations = releasedMilestones
    .filter((m) => m.submittedAt && m.releasedAt)
    .map((m) => daysBetween(m.submittedAt as string, m.releasedAt as string));

  const settlementDurations = completed
    .filter((a) => a.startedAt && a.completedAt)
    .map((a) => daysBetween(a.startedAt as string, a.completedAt as string));

  const disputedAgreements = new Set(
    disputes.filter((d) => d.status !== "withdrawn").map((d) => d.agreementId),
  );

  const funnel: FunnelStage[] = [
    {
      key: "created",
      label: "Agreements created",
      count: agreements.length,
      conversion: null,
      caption: "Drafts started",
    },
    {
      key: "signed",
      label: "Signed by both parties",
      count: signed.length,
      conversion: rate(signed.length, agreements.length),
      caption: "Terms locked and hashed",
    },
    {
      key: "funded",
      label: "Escrow funded",
      count: funded.length,
      conversion: rate(funded.length, signed.length),
      caption: "Money secured",
    },
    {
      key: "submitted",
      label: "Work submitted",
      count: reviewedMilestones.length > 0 ? new Set(reviewedMilestones.map((m) => m.agreementId)).size : 0,
      conversion: rate(
        new Set(reviewedMilestones.map((m) => m.agreementId)).size,
        funded.length,
      ),
      caption: "At least one milestone submitted",
    },
    {
      key: "settled",
      label: "Payment released",
      count: new Set(confirmedPayments.map((p) => p.agreementId)).size,
      conversion: rate(new Set(confirmedPayments.map((p) => p.agreementId)).size, funded.length),
      caption: "Funds reached a provider",
    },
    {
      key: "completed",
      label: "Completed in full",
      count: completed.length,
      conversion: rate(completed.length, funded.length),
      caption: "Every milestone settled",
    },
  ];

  return {
    agreementsCreated: agreements.length,
    fundingVolume,
    paymentVolume,
    milestonesCompleted: releasedMilestones.length,
    uniqueUsers: users.length,
    repeatUsers,
    activationRate,
    fundingConversion: rate(funded.length, signed.length) ?? 0,
    completionRate: rate(completed.length, funded.length) ?? 0,
    milestoneApprovalRate: rate(approvedMilestones.length, reviewedMilestones.length) ?? 0,
    disputeRate: rate(disputedAgreements.size, funded.length) ?? 0,
    avgTimeToMilestoneDays: average(milestoneDurations),
    avgTimeToSettlementDays: average(settlementDurations),
    avgAgreementValue:
      agreements.length > 0
        ? Math.round(agreements.reduce((a, x) => a + x.totalAmount, 0) / agreements.length)
        : 0,
    funnel,
    eventCounts: analyticsRepo.countByName(),
    volumeByWeek: buildWeeklyVolume(funded, confirmedPayments),
    asset: agreements[0]?.asset ?? "USDC",
  };
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function buildWeeklyVolume(
  funded: Array<{ startedAt: string | null; totalAmount: number }>,
  payments: Array<{ confirmedAt: string | null; amount: number }>,
): Array<{ week: string; funded: number; released: number }> {
  const buckets = new Map<string, { funded: number; released: number }>();

  const bucketFor = (iso: string) => {
    const date = new Date(iso);
    const day = date.getUTCDay();
    // Normalize to the Monday of that week.
    const monday = new Date(date.getTime() - ((day + 6) % 7) * 86_400_000);
    return monday.toISOString().slice(0, 10);
  };

  const ensure = (key: string) => {
    if (!buckets.has(key)) buckets.set(key, { funded: 0, released: 0 });
    return buckets.get(key)!;
  };

  for (const a of funded) {
    if (!a.startedAt) continue;
    ensure(bucketFor(a.startedAt)).funded += a.totalAmount;
  }
  for (const p of payments) {
    if (!p.confirmedAt) continue;
    ensure(bucketFor(p.confirmedAt)).released += p.amount;
  }

  return Array.from(buckets.entries())
    .map(([week, v]) => ({ week, ...v }))
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12);
}

// ---------------------------------------------------------------------------
// Dashboard summary (per user)
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  fundsInEscrow: number;
  awaitingYourAction: number;
  inProgress: number;
  completedThisMonth: number;
  settledTotal: number;
  asset: string;
}

export function computeDashboardSummary(userId: string): DashboardSummary {
  const agreements = agreementsRepo.forUser(userId);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let fundsInEscrow = 0;
  let settledTotal = 0;
  let awaitingYourAction = 0;
  let inProgress = 0;
  let completedThisMonth = 0;

  for (const agreement of agreements) {
    const isClient = agreement.clientId === userId;
    const milestones = milestonesRepo.forAgreement(agreement.id);
    const released = milestones.reduce((a, m) => a + m.releasedAmount, 0);

    if (["funded", "in_progress", "disputed", "paused"].includes(agreement.status)) {
      fundsInEscrow += Math.max(0, agreement.totalAmount - released);
      inProgress += 1;
    }

    // Settled value means different things per side: what you paid out, or what
    // you were paid.
    settledTotal += released;

    if (agreement.status === "completed" && agreement.completedAt) {
      if (Date.parse(agreement.completedAt) >= monthStart.getTime()) completedThisMonth += 1;
    }

    // "Awaiting your action" is the dashboard's whole reason to exist.
    if (agreement.status === "awaiting_signature") {
      const mine = isClient ? agreement.clientSignature : agreement.providerSignature;
      if (!mine) awaitingYourAction += 1;
    }
    if (agreement.status === "awaiting_funding" && isClient) awaitingYourAction += 1;

    for (const milestone of milestones) {
      if (isClient && (milestone.status === "submitted" || milestone.status === "under_review")) {
        awaitingYourAction += 1;
      }
      if (!isClient && (milestone.status === "in_progress" || milestone.status === "revision_requested")) {
        awaitingYourAction += 1;
      }
      if (milestone.status === "disputed") awaitingYourAction += 1;
    }
  }

  return {
    fundsInEscrow,
    awaitingYourAction,
    inProgress,
    completedThisMonth,
    settledTotal,
    asset: agreements[0]?.asset ?? "USDC",
  };
}

// ---------------------------------------------------------------------------
// Action queue
// ---------------------------------------------------------------------------

export type ActionKind =
  | "review_milestone"
  | "sign_agreement"
  | "fund_escrow"
  | "submit_milestone"
  | "address_revision"
  | "resolve_dispute";

export interface ActionItem {
  kind: ActionKind;
  agreementId: string;
  milestoneId: string | null;
  title: string;
  subtitle: string;
  amount: number | null;
  asset: string;
  href: string;
  urgency: "overdue" | "soon" | "normal";
  dueAt: string | null;
}

export function buildActionQueue(userId: string): ActionItem[] {
  const items: ActionItem[] = [];
  const now = Date.now();

  for (const agreement of agreementsRepo.forUser(userId)) {
    const isClient = agreement.clientId === userId;
    const milestones = milestonesRepo.forAgreement(agreement.id);

    if (agreement.status === "awaiting_signature") {
      const mine = isClient ? agreement.clientSignature : agreement.providerSignature;
      if (!mine) {
        items.push({
          kind: "sign_agreement",
          agreementId: agreement.id,
          milestoneId: null,
          title: "Agreement awaiting your signature",
          subtitle: agreement.title,
          amount: agreement.totalAmount,
          asset: agreement.asset,
          href: `/app/agreements/${agreement.id}`,
          urgency: "normal",
          dueAt: null,
        });
      }
    }

    if (agreement.status === "awaiting_funding" && isClient) {
      items.push({
        kind: "fund_escrow",
        agreementId: agreement.id,
        milestoneId: null,
        title: "Fund escrow to start work",
        subtitle: agreement.title,
        amount: agreement.totalAmount,
        asset: agreement.asset,
        href: `/app/agreements/${agreement.id}/fund`,
        urgency: "normal",
        dueAt: null,
      });
    }

    for (const milestone of milestones) {
      const overdue = Boolean(milestone.dueAt) && Date.parse(milestone.dueAt as string) < now;
      const reviewOverdue =
        Boolean(milestone.reviewDueAt) && Date.parse(milestone.reviewDueAt as string) < now;

      if (isClient && (milestone.status === "submitted" || milestone.status === "under_review")) {
        items.push({
          kind: "review_milestone",
          agreementId: agreement.id,
          milestoneId: milestone.id,
          title: "Milestone awaiting review",
          subtitle: `${milestone.title} · ${agreement.title}`,
          amount: milestone.amount - milestone.releasedAmount,
          asset: agreement.asset,
          href: `/app/agreements/${agreement.id}/review/${milestone.id}`,
          urgency: reviewOverdue ? "overdue" : "soon",
          dueAt: milestone.reviewDueAt,
        });
      }

      if (!isClient && milestone.status === "revision_requested") {
        items.push({
          kind: "address_revision",
          agreementId: agreement.id,
          milestoneId: milestone.id,
          title: "Revision requested",
          subtitle: `${milestone.title} · ${agreement.title}`,
          amount: milestone.amount,
          asset: agreement.asset,
          href: `/app/agreements/${agreement.id}/submit/${milestone.id}`,
          urgency: "soon",
          dueAt: milestone.dueAt,
        });
      }

      if (!isClient && milestone.status === "in_progress") {
        items.push({
          kind: "submit_milestone",
          agreementId: agreement.id,
          milestoneId: milestone.id,
          title: overdue ? "Milestone past its deadline" : "Milestone in progress",
          subtitle: `${milestone.title} · ${agreement.title}`,
          amount: milestone.amount,
          asset: agreement.asset,
          href: `/app/agreements/${agreement.id}/submit/${milestone.id}`,
          urgency: overdue ? "overdue" : "normal",
          dueAt: milestone.dueAt,
        });
      }

      if (milestone.status === "disputed") {
        const dispute = disputesRepo.forMilestone(milestone.id);
        items.push({
          kind: "resolve_dispute",
          agreementId: agreement.id,
          milestoneId: milestone.id,
          title: "Dispute needs attention",
          subtitle: `${milestone.title} · ${agreement.title}`,
          amount: milestone.amount - milestone.releasedAmount,
          asset: agreement.asset,
          href: dispute
            ? `/app/agreements/${agreement.id}/dispute/${dispute.id}`
            : `/app/agreements/${agreement.id}`,
          urgency: "overdue",
          dueAt: null,
        });
      }
    }
  }

  const rank = { overdue: 0, soon: 1, normal: 2 };
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}
