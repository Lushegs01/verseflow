/**
 * Serverless cold-start behaviour.
 *
 * The simulated settlement ledger lives in module memory. On a long-lived server
 * it stays warm; on serverless, every cold instance starts empty. These tests
 * simulate that by wiping the in-memory ledger mid-flow while leaving the
 * database untouched — exactly what a request landing on a fresh instance sees.
 *
 * Two failures this guards against, both found by testing the deployed app:
 *   1. A release failing with "Escrow could not be found" on a cold instance.
 *   2. A confirmation poll marking a perfectly good payment FAILED because that
 *      instance had never heard of the transaction.
 *
 * And the property that must survive the fix: a transaction we never issued is
 * still rejected. Rehydration must not become a way to confirm an invented hash.
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

/** Everything a cold serverless instance loses: the whole in-memory ledger. */
function simulateColdStart() {
  resetSimulatedChain();
}

async function makeUser(name: string, address: string): Promise<User> {
  const user = await usersRepo.create({
    id: newId("usr"), handle: name.toLowerCase(), displayName: name, headline: "", bio: "",
    avatarColor: "#1D5BFF", email: null, professions: [], verification: "wallet_verified",
    isAdmin: false, publicProfileEnabled: false, publicMetrics: [], timezone: "UTC",
    createdAt: nowIso(),
  });
  await walletsRepo.add({
    userId: user.id, address, chainId: 20197, label: "Primary",
    isPrimary: true, verifiedAt: nowIso(),
  });
  return user;
}

async function makeAgreement(client: User, provider: User, amounts: number[]) {
  const now = nowIso();
  const sig = (u: User, addr: string) => ({
    userId: u.id, address: addr, termsHash: "0x" + "0".repeat(64),
    signature: `simulated:${u.handle}`, signedAt: now, method: "simulated_signature" as const,
  });

  const agreement = await agreementsRepo.insert({
    id: newId("agr"), reference: `VF-${1000 + (await agreementsRepo.nextSequence())}`,
    title: "Cold start test", description: "", clientId: client.id, providerId: provider.id,
    providerInviteAddress: null, totalAmount: amounts.reduce((a, b) => a + b, 0),
    asset: "USDC", status: "awaiting_funding", agreementHash: null, onChainId: null,
    escrowAddress: null, fundingTxHash: null, chainId: 20197, rules: DEFAULT_AGREEMENT_RULES,
    clientSignature: sig(client, CLIENT), providerSignature: sig(provider, PROVIDER),
    expectedCompletionAt: null, startedAt: null, completedAt: null, cancelledAt: null,
    isSimulated: true, createdAt: now, updatedAt: now,
  });

  const milestones: Milestone[] = [];
  for (const [index, amount] of amounts.entries()) {
    milestones.push(await milestonesRepo.insert({
      id: newId("mst"), agreementId: agreement.id, position: index,
      title: `Milestone ${index + 1}`, description: "", amount, dueAt: null,
      deliverables: [], acceptanceCriteria: [], requiredEvidence: [],
      status: "locked", revisionCount: 0, releasedAmount: 0, submittedAt: null,
      approvedAt: null, releasedAt: null, reviewDueAt: null, createdAt: now, updatedAt: now,
    }));
  }

  return { agreement, milestones };
}

async function fund(agreement: Agreement, client: User) {
  const intent = await prepareFunding({
    bundle: await hydrate(agreement), actor: client,
    idempotencyKey: newId("pay") + "fund", fromAddress: CLIENT,
  });
  await confirmFunding({
    bundle: await hydrate((await agreementsRepo.byId(agreement.id))!),
    actor: client, txHash: intent.transaction.simulatedReceipt!.txHash,
  });
  return (await agreementsRepo.byId(agreement.id))!;
}

async function underReview(m: Milestone): Promise<Milestone> {
  return milestonesRepo.update({ ...m, status: "under_review", submittedAt: nowIso() });
}

let client: User;
let provider: User;

beforeEach(async () => {
  await closeDb();
  resetSimulatedChain();
  const db = await getDb();
  for (const t of [
    "simulated_transactions", "payments", "evidence_analyses", "evidence",
    "revision_requests", "dispute_messages", "disputes", "activity_events",
    "notifications", "milestones", "agreements", "wallet_addresses", "sessions",
    "idempotency_keys", "search_index", "analytics_events",
  ]) await db.query(`DELETE FROM ${t}`);
  await db.query("DELETE FROM users");
  client = await makeUser("Client", CLIENT);
  provider = await makeUser("Provider", PROVIDER);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cold start", () => {
  it("releases payment on an instance that never saw the escrow funded", async () => {
    const { agreement } = await makeAgreement(client, provider, [150_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    // The funding happened on a different instance than this release.
    simulateColdStart();

    const result = await releaseMilestone({
      bundle: await hydrate(funded), milestone, actor: client, amount: 150_000,
      kind: "milestone_release", reason: null, idempotencyKey: "cold_release_key_1",
    });

    expect(result.payment.status).toBe("pending");
    expect(result.payment.amount).toBe(150_000);
  });

  it("confirms a payment on an instance that never issued the transaction", async () => {
    const { agreement } = await makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    const result = await releaseMilestone({
      bundle: await hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "milestone_release", reason: null, idempotencyKey: "cold_confirm_key_1",
    });

    // The confirmation poll lands somewhere else entirely.
    simulateColdStart();

    const outcome = await confirmRelease({ payment: result.payment, actor: client });

    expect(outcome.status).toBe("confirmed");
    expect((await milestonesRepo.byId(milestone.id))!.status).toBe("released");
    expect(await paymentsRepo.confirmedTotalForMilestone(milestone.id)).toBe(100_000);
  });

  it("a rehydrated instance still knows what was already paid", async () => {
    const { agreement } = await makeAgreement(client, provider, [150_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    const first = await releaseMilestone({
      bundle: await hydrate(funded), milestone, actor: client, amount: 90_000,
      kind: "partial_release", reason: "First tranche accepted.", idempotencyKey: "cold_partial_1",
    });
    await confirmRelease({ payment: first.payment, actor: client });

    simulateColdStart();

    // Escrow is rebuilt from the ledger, so the paid-out portion is not
    // available again -- a cold start must not reopen spent funds.
    await expect(
      releaseMilestone({
        bundle: await hydrate((await agreementsRepo.byId(funded.id))!),
        milestone: (await milestonesRepo.byId(milestone.id))!,
        actor: client, amount: 90_000, kind: "partial_release",
        reason: "Trying to re-release the same tranche.", idempotencyKey: "cold_partial_2",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });

    expect(await paymentsRepo.confirmedTotalForMilestone(milestone.id)).toBe(90_000);
  });

  it("still refuses a transaction that was never issued", async () => {
    const { agreement } = await makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    const result = await releaseMilestone({
      bundle: await hydrate(funded), milestone, actor: client, amount: 100_000,
      kind: "milestone_release", reason: null, idempotencyKey: "cold_invented_key",
    });

    // Rehydration must not become a way to confirm an arbitrary hash: this one
    // has no durable record because the settlement layer never issued it.
    const invented = paymentsRepo.update({ ...result.payment, txHash: "0x" + "9".repeat(64) });
    const outcome = await confirmRelease({ payment: await invented, actor: client });

    expect(outcome.status).toBe("failed");
    expect((await milestonesRepo.byId(milestone.id))!.releasedAmount).toBe(0);
  });
});
