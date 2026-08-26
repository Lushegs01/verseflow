/**
 * Reputation, derived entirely from settled contract history.
 *
 * Nothing here is self-reported. Every number traces back to an agreement that was
 * signed, funded, and paid, which is what makes it worth trusting.
 *
 * Privacy: the full record is visible to its owner. What appears publicly is
 * strictly the subset the user opted into, and contract details are never exposed
 * by default.
 */

import {
  agreementsRepo,
  milestonesRepo,
  paymentsRepo,
  disputesRepo,
  usersRepo,
  showcaseRepo,
} from "@/lib/db/repositories";
import type { Agreement, PublicMetricKey, Reputation, User } from "@/lib/domain/types";
import { daysBetween } from "@/lib/domain/ids";

export function computeReputation(userId: string): Reputation {
  const agreements = agreementsRepo.forUser(userId);
  const asProvider = agreements.filter((a) => a.providerId === userId);
  const completed = asProvider.filter((a) => a.status === "completed");

  // Settled value counts confirmed payments only. Approved-but-unconfirmed money
  // has not actually moved and must not inflate a reputation number.
  let valueSettled = 0;
  let milestonesCompleted = 0;
  let milestonesTotal = 0;
  let onTimeCount = 0;
  let deadlineCount = 0;
  const completionDurations: number[] = [];

  for (const agreement of asProvider) {
    const payments = paymentsRepo
      .forAgreement(agreement.id)
      .filter((p) => p.status === "confirmed" && p.kind !== "refund");
    valueSettled += payments.reduce((a, p) => a + p.amount, 0);

    const milestones = milestonesRepo.forAgreement(agreement.id);
    milestonesTotal += milestones.length;

    for (const milestone of milestones) {
      if (milestone.status === "released") {
        milestonesCompleted += 1;
        if (milestone.dueAt && milestone.releasedAt) {
          deadlineCount += 1;
          if (Date.parse(milestone.releasedAt) <= Date.parse(milestone.dueAt)) onTimeCount += 1;
        }
      }
    }

    if (agreement.status === "completed" && agreement.startedAt && agreement.completedAt) {
      completionDurations.push(daysBetween(agreement.startedAt, agreement.completedAt));
    }
  }

  const disputes = asProvider.flatMap((a) => disputesRepo.forAgreement(a.id));
  const realDisputes = disputes.filter((d) => d.status !== "withdrawn");

  // Repeat-client rate: share of this provider's agreements that came from a client
  // who had already hired them. A strong signal, and one that cannot be faked
  // without a second party funding real escrow.
  const clientCounts = new Map<string, number>();
  for (const a of asProvider) clientCounts.set(a.clientId, (clientCounts.get(a.clientId) ?? 0) + 1);
  const repeatAgreements = Array.from(clientCounts.values())
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);

  const settledAt = asProvider
    .filter((a) => a.completedAt)
    .map((a) => a.completedAt as string)
    .sort();

  return {
    userId,
    contractsCompleted: completed.length,
    valueSettled,
    onTimeRate: deadlineCount > 0 ? Math.round((onTimeCount / deadlineCount) * 100) : 0,
    milestoneSuccessRate:
      milestonesTotal > 0 ? Math.round((milestonesCompleted / milestonesTotal) * 100) : 0,
    disputeCount: realDisputes.length,
    disputeRate: asProvider.length > 0 ? Math.round((realDisputes.length / asProvider.length) * 100) : 0,
    repeatClientRate:
      asProvider.length > 0 ? Math.round((repeatAgreements / asProvider.length) * 100) : 0,
    avgCompletionDays:
      completionDurations.length > 0
        ? Math.round(completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length)
        : 0,
    milestonesCompleted,
    firstSettlementAt: settledAt[0] ?? null,
    lastSettlementAt: settledAt.at(-1) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------

export interface PublicProfile {
  user: Pick<User, "handle" | "displayName" | "headline" | "bio" | "avatarColor" | "professions" | "verification">;
  metrics: Array<{ key: PublicMetricKey; label: string; value: string; caption: string }>;
  showcase: Array<{
    id: string;
    title: string;
    summary: string;
    valueLabel: string | null;
    milestoneCount: number;
    completedOnTime: boolean;
    completedAt: string | null;
  }>;
  memberSince: string;
}

const METRIC_LABELS: Record<PublicMetricKey, { label: string; caption: string }> = {
  contracts_completed: { label: "Contracts completed", caption: "Funded agreements settled in full" },
  value_settled: { label: "Value settled", caption: "Total released through escrow" },
  on_time_rate: { label: "On time", caption: "Milestones released by their deadline" },
  milestone_success_rate: { label: "Milestone success", caption: "Milestones approved and paid" },
  dispute_count: { label: "Disputes", caption: "Disputes opened across all agreements" },
  repeat_client_rate: { label: "Repeat clients", caption: "Agreements from returning clients" },
  avg_completion_days: { label: "Avg completion", caption: "Days from funding to final settlement" },
};

/**
 * Build a public profile. Returns null when the user has not opted in -- the
 * absence of a profile is itself private, so callers render a plain 404.
 */
export function buildPublicProfile(handle: string): PublicProfile | null {
  const user = usersRepo.byHandle(handle);
  if (!user || !user.publicProfileEnabled) return null;

  const reputation = computeReputation(user.id);
  const allowed = new Set(user.publicMetrics);

  const metrics = (Object.keys(METRIC_LABELS) as PublicMetricKey[])
    .filter((key) => allowed.has(key))
    .map((key) => ({
      key,
      label: METRIC_LABELS[key].label,
      caption: METRIC_LABELS[key].caption,
      value: formatMetric(key, reputation),
    }));

  const showcase = showcaseRepo.forUser(user.id).flatMap((item) => {
    const agreement = agreementsRepo.byId(item.agreementId);
    // Only completed agreements the user still owns a side of can be showcased.
    if (!agreement || agreement.status !== "completed") return [];
    if (agreement.providerId !== user.id && agreement.clientId !== user.id) return [];

    const milestones = milestonesRepo.forAgreement(agreement.id);
    const onTime = milestones.every(
      (m) => !m.dueAt || !m.releasedAt || Date.parse(m.releasedAt) <= Date.parse(m.dueAt),
    );

    return [
      {
        id: item.id,
        title: item.publicTitle,
        summary: item.summary,
        // Anonymized entries show a band rather than the exact contract value.
        valueLabel: item.anonymizeValue
          ? valueBand(agreement.totalAmount)
          : formatMetricValue(agreement.totalAmount, agreement.asset),
        milestoneCount: milestones.length,
        completedOnTime: onTime,
        completedAt: agreement.completedAt,
      },
    ];
  });

  return {
    user: {
      handle: user.handle,
      displayName: user.displayName,
      headline: user.headline,
      bio: user.bio,
      avatarColor: user.avatarColor,
      professions: user.professions,
      verification: user.verification,
    },
    metrics,
    showcase,
    memberSince: user.createdAt,
  };
}

function formatMetric(key: PublicMetricKey, r: Reputation): string {
  switch (key) {
    case "contracts_completed":
      return String(r.contractsCompleted);
    case "value_settled":
      return formatMetricValue(r.valueSettled, "USDC", true);
    case "on_time_rate":
      return `${r.onTimeRate}%`;
    case "milestone_success_rate":
      return `${r.milestoneSuccessRate}%`;
    case "dispute_count":
      return String(r.disputeCount);
    case "repeat_client_rate":
      return `${r.repeatClientRate}%`;
    case "avg_completion_days":
      return r.avgCompletionDays > 0 ? `${r.avgCompletionDays}d` : "--";
  }
}

function formatMetricValue(minor: number, asset: string, compact = false): string {
  const value = minor / 100;
  const symbol = asset === "EURC" ? "€" : "$";
  if (compact && value >= 1000) {
    return `${symbol}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  }
  return `${symbol}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

/** Coarse bands so a showcased project reveals scale without revealing the contract. */
function valueBand(minor: number): string {
  const value = minor / 100;
  if (value < 1_000) return "Under $1K";
  if (value < 5_000) return "$1K - $5K";
  if (value < 10_000) return "$5K - $10K";
  if (value < 25_000) return "$10K - $25K";
  if (value < 50_000) return "$25K - $50K";
  return "$50K+";
}

/** Agreements a user may add to their public profile. */
export function showcaseCandidates(userId: string): Agreement[] {
  return agreementsRepo
    .forUser(userId)
    .filter((a) => a.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
}

export const PUBLIC_METRIC_OPTIONS = (Object.keys(METRIC_LABELS) as PublicMetricKey[]).map((key) => ({
  key,
  ...METRIC_LABELS[key],
}));
