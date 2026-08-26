/**
 * Reputation and public profile privacy.
 *
 * Two properties this suite exists to protect:
 *   1. Reputation counts only money that actually moved. Approved-but-unconfirmed
 *      payments must never inflate a figure.
 *   2. Nothing is public unless the user opted into it, metric by metric.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.VERSEFLOW_DB_PATH = ":memory:";
process.env.SIMULATED_CONFIRM_MS = "0";

import { getDb, closeDb } from "@/lib/db/client";
import {
  usersRepo, walletsRepo, agreementsRepo, milestonesRepo, paymentsRepo, showcaseRepo,
} from "@/lib/db/repositories";
import { newId, nowIso } from "@/lib/domain/ids";
import { DEFAULT_AGREEMENT_RULES, type User, type PublicMetricKey } from "@/lib/domain/types";
import { computeReputation, buildPublicProfile, showcaseCandidates } from "./reputation";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

async function makeUser(name: string, opts: { publicProfile?: boolean; metrics?: PublicMetricKey[] } = {}): Promise<User> {
  const u = await usersRepo.create({
    id: newId("usr"), handle: name.toLowerCase().replace(/\s+/g, ""), displayName: name,
    headline: "Developer", bio: "", avatarColor: "#0F9D6B", email: null, professions: [],
    verification: "wallet_verified", isAdmin: false,
    publicProfileEnabled: opts.publicProfile ?? false,
    publicMetrics: opts.metrics ?? [], timezone: "UTC", createdAt: iso(-800),
  });
  await walletsRepo.add({
    userId: u.id, address: `0x${u.id.slice(4, 10).padEnd(40, "0")}`.slice(0, 42),
    chainId: 20197, label: "Primary", isPrimary: true, verifiedAt: iso(-800),
  });
  return u;
}

/**
 * Build a completed agreement with settled milestones.
 * `confirmed: false` records the payment as pending, which must NOT count.
 */
async function settledAgreement(opts: {
  client: User;
  provider: User;
  amounts: number[];
  startedDaysAgo: number;
  durationDays: number;
  onTime?: boolean;
  confirmed?: boolean;
  complete?: boolean;
}) {
  const {
    client, provider, amounts, startedDaysAgo, durationDays,
    onTime = true, confirmed = true, complete = true,
  } = opts;

  const now = nowIso();
  const total = amounts.reduce((a, b) => a + b, 0);
  const startedAt = iso(-startedDaysAgo);
  const completedAt = iso(-startedDaysAgo + durationDays);

  const agreement = await agreementsRepo.insert({
    id: newId("agr"), reference: `VF-${1000 + (await agreementsRepo.nextSequence())}`,
    title: "Project", description: "", clientId: client.id, providerId: provider.id,
    providerInviteAddress: null, totalAmount: total, asset: "USDC",
    status: complete ? "completed" : "in_progress",
    agreementHash: null, onChainId: null, escrowAddress: null, fundingTxHash: null,
    chainId: 20197, rules: DEFAULT_AGREEMENT_RULES, clientSignature: null, providerSignature: null,
    expectedCompletionAt: completedAt, startedAt,
    completedAt: complete ? completedAt : null, cancelledAt: null,
    isSimulated: true, createdAt: startedAt, updatedAt: now,
  });

  for (const [index, amount] of amounts.entries()) {
    const dueAt = iso(-startedDaysAgo + durationDays);
    const releasedAt = iso(-startedDaysAgo + durationDays + (onTime ? -1 : 3));

    const milestone = await milestonesRepo.insert({
      id: newId("mst"), agreementId: agreement.id, position: index,
      title: `Milestone ${index + 1}`, description: "", amount, dueAt,
      deliverables: [], acceptanceCriteria: [], requiredEvidence: [],
      status: confirmed ? "released" : "approved",
      revisionCount: 0, releasedAmount: confirmed ? amount : 0,
      submittedAt: iso(-startedDaysAgo + 1), approvedAt: releasedAt,
      releasedAt: confirmed ? releasedAt : null, reviewDueAt: null,
      createdAt: startedAt, updatedAt: now,
    });

    await paymentsRepo.insert({
      id: newId("pay"), agreementId: agreement.id, milestoneId: milestone.id,
      kind: "milestone_release", amount, asset: "USDC",
      recipientAddress: (await walletsRepo.primaryAddress(provider.id))!,
      status: confirmed ? "confirmed" : "pending",
      txHash: `0x${"a".repeat(64)}`.slice(0, 66), chainId: 20197, blockNumber: 1,
      idempotencyKey: newId("pay") + index, reason: null, failureReason: null,
      isSimulated: true, initiatedBy: client.id,
      createdAt: releasedAt, confirmedAt: confirmed ? releasedAt : null,
    });
  }

  return agreement;
}

let provider: User;
let clientA: User;
let clientB: User;

beforeEach(async () => {
  await closeDb();
  const db = await getDb();
  for (const t of [
    "payments", "evidence_analyses", "evidence", "revision_requests", "dispute_messages",
    "disputes", "activity_events", "notifications", "showcase_items", "milestones",
    "agreements", "wallet_addresses", "sessions", "search_index", "analytics_events",
  ]) await db.query(`DELETE FROM ${t}`);
  await db.query("DELETE FROM users");
  provider = await makeUser("Alex Morgan");
  clientA = await makeUser("Client A");
  clientB = await makeUser("Client B");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("computeReputation", () => {
  it("is empty for a user with no history", async () => {
    const r = await computeReputation(provider.id);
    expect(r.contractsCompleted).toBe(0);
    expect(r.valueSettled).toBe(0);
    expect(r.onTimeRate).toBe(0);
    expect(r.firstSettlementAt).toBeNull();
  });

  it("counts completed contracts and settled value", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [75_000, 150_000], startedDaysAgo: 90, durationDays: 30 });
    await settledAgreement({ client: clientB, provider, amounts: [100_000], startedDaysAgo: 50, durationDays: 20 });

    const r = await computeReputation(provider.id);
    expect(r.contractsCompleted).toBe(2);
    expect(r.valueSettled).toBe(325_000);
    expect(r.milestonesCompleted).toBe(3);
  });

  it("counts ONLY confirmed payments, never approved-but-unconfirmed", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [100_000], startedDaysAgo: 60, durationDays: 20 });
    // Approved but never confirmed on chain: the money has not moved.
    await settledAgreement({
      client: clientB, provider, amounts: [500_000],
      startedDaysAgo: 30, durationDays: 10, confirmed: false, complete: false,
    });

    const r = await computeReputation(provider.id);
    expect(r.valueSettled).toBe(100_000);
    expect(r.contractsCompleted).toBe(1);
  });

  it("computes the on-time rate from released vs due dates", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 90, durationDays: 20, onTime: true });
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 70, durationDays: 20, onTime: true });
    await settledAgreement({ client: clientB, provider, amounts: [50_000], startedDaysAgo: 50, durationDays: 20, onTime: true });
    await settledAgreement({ client: clientB, provider, amounts: [50_000], startedDaysAgo: 30, durationDays: 20, onTime: false });

    expect((await computeReputation(provider.id)).onTimeRate).toBe(75);
  });

  it("computes the repeat-client rate from returning clients", async () => {
    // clientA hires three times, clientB once -> 3 of 4 agreements are repeat.
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 120, durationDays: 20 });
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 90, durationDays: 20 });
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 60, durationDays: 20 });
    await settledAgreement({ client: clientB, provider, amounts: [50_000], startedDaysAgo: 30, durationDays: 20 });

    expect((await computeReputation(provider.id)).repeatClientRate).toBe(75);
  });

  it("does not credit the provider for work they commissioned as a client", async () => {
    // The provider hires someone else. That is not their delivery record.
    await settledAgreement({ client: provider, provider: clientA, amounts: [400_000], startedDaysAgo: 40, durationDays: 15 });

    const r = await computeReputation(provider.id);
    expect(r.contractsCompleted).toBe(0);
    expect(r.valueSettled).toBe(0);
  });

  it("averages completion time across completed agreements", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [50_000], startedDaysAgo: 100, durationDays: 20 });
    await settledAgreement({ client: clientB, provider, amounts: [50_000], startedDaysAgo: 60, durationDays: 40 });

    expect((await computeReputation(provider.id)).avgCompletionDays).toBe(30);
  });
});

describe("public profile privacy", () => {
  it("returns null when the profile is not enabled", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [100_000], startedDaysAgo: 40, durationDays: 20 });
    // Absence is itself private: callers render a 404, not "this user is private".
    expect(await buildPublicProfile(provider.handle)).toBeNull();
  });

  it("returns null for an unknown handle", async () => {
    expect(await buildPublicProfile("nobody-here")).toBeNull();
  });

  it("exposes only the metrics the user opted into", async () => {
    const opted = await makeUser("Opted In", {
      publicProfile: true,
      metrics: ["contracts_completed", "on_time_rate"],
    });
    await settledAgreement({ client: clientA, provider: opted, amounts: [100_000], startedDaysAgo: 40, durationDays: 20 });

    const profile = (await buildPublicProfile(opted.handle))!;
    const keys = profile.metrics.map((m) => m.key);

    expect(keys).toEqual(["contracts_completed", "on_time_rate"]);
    // Settled value was NOT opted into, so it must not appear anywhere.
    expect(keys).not.toContain("value_settled");
    expect(JSON.stringify(profile)).not.toContain("$1,000");
  });

  it("publishes nothing when the profile is on but no metrics are selected", async () => {
    const opted = await makeUser("Bare Profile", { publicProfile: true, metrics: [] });
    await settledAgreement({ client: clientA, provider: opted, amounts: [100_000], startedDaysAgo: 40, durationDays: 20 });

    const profile = (await buildPublicProfile(opted.handle))!;
    expect(profile.metrics).toHaveLength(0);
    expect(profile.user.displayName).toBe("Bare Profile");
  });
});

describe("showcase", () => {
  it("offers only completed agreements", async () => {
    await settledAgreement({ client: clientA, provider, amounts: [100_000], startedDaysAgo: 40, durationDays: 20 });
    await settledAgreement({
      client: clientB, provider, amounts: [200_000],
      startedDaysAgo: 10, durationDays: 5, complete: false, confirmed: false,
    });

    const candidates = await showcaseCandidates(provider.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("completed");
  });

  it("hides the exact value when the user anonymized it", async () => {
    const opted = await makeUser("Showcase User", { publicProfile: true, metrics: ["contracts_completed"] });
    const agreement = await settledAgreement({
      client: clientA, provider: opted, amounts: [320_000], startedDaysAgo: 40, durationDays: 20,
    });

    await showcaseRepo.upsert({
      id: newId("shw"), userId: opted.id, agreementId: agreement.id,
      publicTitle: "E-commerce redesign", summary: "Delivered on schedule.",
      anonymizeValue: true, position: 0, createdAt: nowIso(),
    });

    const item = (await buildPublicProfile(opted.handle))!.showcase[0];
    expect(item.title).toBe("E-commerce redesign");
    expect(item.valueLabel).toBe("$1K - $5K");
    expect(item.valueLabel).not.toContain("3,200");
  });

  it("shows the exact value when the user chose to", async () => {
    const opted = await makeUser("Open Book", { publicProfile: true, metrics: [] });
    const agreement = await settledAgreement({
      client: clientA, provider: opted, amounts: [320_000], startedDaysAgo: 40, durationDays: 20,
    });

    await showcaseRepo.upsert({
      id: newId("shw"), userId: opted.id, agreementId: agreement.id,
      publicTitle: "Storefront build", summary: "", anonymizeValue: false,
      position: 0, createdAt: nowIso(),
    });

    expect((await buildPublicProfile(opted.handle))!.showcase[0].valueLabel).toBe("$3,200");
  });

  it("never publishes a showcased agreement the user is not party to", async () => {
    const opted = await makeUser("Sneaky", { publicProfile: true, metrics: [] });
    // An agreement between two other people.
    const foreign = await settledAgreement({
      client: clientA, provider: clientB, amounts: [900_000], startedDaysAgo: 40, durationDays: 20,
    });

    await showcaseRepo.upsert({
      id: newId("shw"), userId: opted.id, agreementId: foreign.id,
      publicTitle: "Not mine", summary: "", anonymizeValue: false,
      position: 0, createdAt: nowIso(),
    });

    // The service re-checks party membership when rendering, so the stale row
    // is filtered out rather than published.
    expect((await buildPublicProfile(opted.handle))!.showcase).toHaveLength(0);
  });
});
