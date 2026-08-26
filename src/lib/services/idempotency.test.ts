/**
 * Idempotency semantics for payment operations.
 *
 * The scenario these guard against: a client authorizes a release, the response
 * is lost in transit, and the client retries with the same key. The retry must
 * return the original result -- not pay again, and not report an error for a
 * payment the caller never saw succeed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.VERSEFLOW_DB_PATH = ":memory:";
process.env.SIMULATED_CONFIRM_MS = "0";

import { getDb, closeDb } from "@/lib/db/client";
import {
  usersRepo, walletsRepo, agreementsRepo, milestonesRepo, paymentsRepo,
} from "@/lib/db/repositories";
import { newId, nowIso } from "@/lib/domain/ids";
import { DEFAULT_AGREEMENT_RULES, type Agreement, type Milestone, type User } from "@/lib/domain/types";
import { hydrate } from "@/lib/services/agreements";
import { prepareFunding, confirmFunding, releaseMilestone, confirmRelease } from "./escrow";
import { resetSimulatedChain } from "@/lib/chain/simulated-adapter";

const CLIENT = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";

function makeUser(name: string, address: string): User {
  const user = usersRepo.create({
    id: newId("usr"), handle: name.toLowerCase(), displayName: name, headline: "", bio: "",
    avatarColor: "#1D5BFF", email: null, professions: [], verification: "wallet_verified",
    isAdmin: false, publicProfileEnabled: false, publicMetrics: [], timezone: "UTC",
    createdAt: nowIso(),
  });
  walletsRepo.add({
    userId: user.id, address, chainId: 20197, label: "Primary",
    isPrimary: true, verifiedAt: nowIso(),
  });
  return user;
}

function makeAgreement(client: User, provider: User, amounts: number[]) {
  const now = nowIso();
  const total = amounts.reduce((a, b) => a + b, 0);
  const sig = (u: User, addr: string) => ({
    userId: u.id, address: addr, termsHash: "0x" + "0".repeat(64),
    signature: `simulated:${u.handle}`, signedAt: now, method: "simulated_signature" as const,
  });

  const agreement = agreementsRepo.insert({
    id: newId("agr"), reference: `VF-${1000 + agreementsRepo.nextSequence()}`,
    title: "Idempotency test", description: "", clientId: client.id, providerId: provider.id,
    providerInviteAddress: null, totalAmount: total, asset: "USDC", status: "awaiting_funding",
    agreementHash: null, onChainId: null, escrowAddress: null, fundingTxHash: null, chainId: 20197,
    rules: DEFAULT_AGREEMENT_RULES,
    clientSignature: sig(client, CLIENT), providerSignature: sig(provider, PROVIDER),
    expectedCompletionAt: null, startedAt: null, completedAt: null, cancelledAt: null,
    isSimulated: true, createdAt: now, updatedAt: now,
  });

  const milestones = amounts.map((amount, index) =>
    milestonesRepo.insert({
      id: newId("mst"), agreementId: agreement.id, position: index,
      title: `Milestone ${index + 1}`, description: "", amount, dueAt: null,
      deliverables: [], acceptanceCriteria: [], requiredEvidence: [],
      status: "locked", revisionCount: 0, releasedAmount: 0,
      submittedAt: null, approvedAt: null, releasedAt: null, reviewDueAt: null,
      createdAt: now, updatedAt: now,
    }),
  );

  return { agreement, milestones };
}

async function fund(agreement: Agreement, client: User) {
  const intent = await prepareFunding({
    bundle: hydrate(agreement), actor: client,
    idempotencyKey: newId("pay") + "fund", fromAddress: CLIENT,
  });
  await confirmFunding({
    bundle: hydrate(agreementsRepo.byId(agreement.id)!),
    actor: client,
    txHash: intent.transaction.simulatedReceipt!.txHash,
  });
  return agreementsRepo.byId(agreement.id)!;
}

function underReview(m: Milestone): Milestone {
  return milestonesRepo.update({ ...m, status: "under_review", submittedAt: nowIso() });
}

let client: User;
let provider: User;

beforeEach(() => {
  closeDb();
  resetSimulatedChain();
  const db = getDb();
  for (const t of [
    "payments", "evidence_analyses", "evidence", "revision_requests", "dispute_messages",
    "disputes", "activity_events", "notifications", "milestones", "agreements",
    "wallet_addresses", "sessions", "idempotency_keys", "search_index", "analytics_events",
  ]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM users");
  client = makeUser("Client", CLIENT);
  provider = makeUser("Provider", PROVIDER);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("release idempotency", () => {
  it("a replay before confirmation returns the original payment", async () => {
    const { agreement } = makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = underReview(milestonesRepo.forAgreement(funded.id)[0]);
    const key = "dropped_response_retry_key";

    const first = await releaseMilestone({
      bundle: hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "milestone_release", reason: null, idempotencyKey: key,
    });

    // The response never reached the caller; they retry with the same key.
    const retry = await releaseMilestone({
      bundle: hydrate(agreementsRepo.byId(funded.id)!),
      milestone: milestonesRepo.byId(milestone.id)!,
      actor: client, amount: 100_000, kind: "milestone_release",
      reason: null, idempotencyKey: key,
    });

    expect(retry.payment.id).toBe(first.payment.id);
    expect(paymentsRepo.forMilestone(milestone.id)).toHaveLength(1);
  });

  it("a replay AFTER settlement still returns the original payment, not an error", async () => {
    const { agreement } = makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = underReview(milestonesRepo.forAgreement(funded.id)[0]);
    const key = "post_settlement_retry_key";

    const first = await releaseMilestone({
      bundle: hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "milestone_release", reason: null, idempotencyKey: key,
    });
    await confirmRelease({ payment: first.payment, actor: client });

    // The milestone is now fully released. A retry of the SAME key must not
    // surface ALREADY_RELEASED for a payment this caller originated.
    const retry = await releaseMilestone({
      bundle: hydrate(agreementsRepo.byId(funded.id)!),
      milestone: milestonesRepo.byId(milestone.id)!,
      actor: client, amount: 100_000, kind: "milestone_release",
      reason: null, idempotencyKey: key,
    });

    expect(retry.payment.id).toBe(first.payment.id);
    expect(paymentsRepo.forMilestone(milestone.id)).toHaveLength(1);
    expect(paymentsRepo.confirmedTotalForMilestone(milestone.id)).toBe(100_000);
  });

  it("a NEW key on a settled milestone is still rejected", async () => {
    const { agreement } = makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = underReview(milestonesRepo.forAgreement(funded.id)[0]);

    const first = await releaseMilestone({
      bundle: hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "milestone_release", reason: null, idempotencyKey: "original_key_here",
    });
    await confirmRelease({ payment: first.payment, actor: client });

    await expect(
      releaseMilestone({
        bundle: hydrate(agreementsRepo.byId(funded.id)!),
        milestone: milestonesRepo.byId(milestone.id)!,
        actor: client, amount: 100_000, kind: "milestone_release",
        reason: null, idempotencyKey: "a_completely_different_key",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_RELEASED" });

    expect(paymentsRepo.forMilestone(milestone.id)).toHaveLength(1);
  });

  it("a failed validation releases the key so a corrected retry can proceed", async () => {
    const { agreement } = makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = underReview(milestonesRepo.forAgreement(funded.id)[0]);
    const key = "reusable_after_failure_key";

    // First attempt asks for more than the milestone holds.
    await expect(
      releaseMilestone({
        bundle: hydrate(funded), milestone, actor: client, amount: 500_000,
        kind: "milestone_release", reason: null, idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });

    // The same key is usable again, because nothing was recorded against it.
    const corrected = await releaseMilestone({
      bundle: hydrate(agreementsRepo.byId(funded.id)!),
      milestone: milestonesRepo.byId(milestone.id)!,
      actor: client, amount: 100_000, kind: "milestone_release",
      reason: null, idempotencyKey: key,
    });

    expect(corrected.payment.amount).toBe(100_000);
    expect(paymentsRepo.forMilestone(milestone.id)).toHaveLength(1);
  });

  it("concurrent releases with different keys cannot exceed the milestone", async () => {
    const { agreement } = makeAgreement(client, provider, [150_000]);
    const funded = await fund(agreement, client);
    const milestone = underReview(milestonesRepo.forAgreement(funded.id)[0]);

    const first = await releaseMilestone({
      bundle: hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "partial_release", reason: "First tranche accepted.", idempotencyKey: "key_one_here",
    });

    // Second request issued before the first confirms. `remainingFor` counts
    // in-flight payments, so the overlap is caught rather than over-spending.
    await expect(
      releaseMilestone({
        bundle: hydrate(agreementsRepo.byId(funded.id)!),
        milestone: milestonesRepo.byId(milestone.id)!,
        actor: client, amount: 100_000, kind: "partial_release",
        reason: "Second tranche.", idempotencyKey: "key_two_here",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });

    await confirmRelease({ payment: first.payment, actor: client });
    expect(paymentsRepo.confirmedTotalForMilestone(milestone.id)).toBe(100_000);
  });
});
