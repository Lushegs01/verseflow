/**
 * Dispute lifecycle, against a real database and the simulated settlement layer.
 *
 * The property that matters most: while a dispute is open, nobody can release the
 * disputed funds -- not the client, not the provider, not an operator acting
 * outside the resolution path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.VERSEFLOW_DB_PATH = ":memory:";
process.env.SIMULATED_CONFIRM_MS = "0";

import { getDb, closeDb } from "@/lib/db/client";
import {
  usersRepo, walletsRepo, agreementsRepo, milestonesRepo, paymentsRepo, disputesRepo,
} from "@/lib/db/repositories";
import { newId, nowIso } from "@/lib/domain/ids";
import { DEFAULT_AGREEMENT_RULES, type Agreement, type Milestone, type User } from "@/lib/domain/types";
import { hydrate } from "@/lib/services/agreements";
import { prepareFunding, confirmFunding, releaseMilestone } from "./escrow";
import { openDispute, resolveDispute, addMessage } from "./disputes";
import { resetSimulatedChain } from "@/lib/chain/simulated-adapter";

const CLIENT = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";

async function makeUser(name: string, address: string, isAdmin = false): Promise<User> {
  const u = await usersRepo.create({
    id: newId("usr"), handle: name.toLowerCase(), displayName: name, headline: "", bio: "",
    avatarColor: "#1D5BFF", email: null, professions: [], verification: "wallet_verified",
    isAdmin, publicProfileEnabled: false, publicMetrics: [], timezone: "UTC", createdAt: nowIso(),
  });
  await walletsRepo.add({
    userId: u.id, address, chainId: 20197, label: "Primary", isPrimary: true, verifiedAt: nowIso(),
  });
  return u;
}

async function makeAgreement(client: User, provider: User, amounts: number[]) {
  const now = nowIso();
  const sig = (u: User, addr: string) => ({
    userId: u.id, address: addr, termsHash: "0x" + "0".repeat(64),
    signature: `simulated:${u.handle}`, signedAt: now, method: "simulated_signature" as const,
  });

  const agreement = await agreementsRepo.insert({
    id: newId("agr"), reference: `VF-${1000 + (await agreementsRepo.nextSequence())}`,
    title: "Dispute test", description: "", clientId: client.id, providerId: provider.id,
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
  return await milestonesRepo.update({ ...m, status: "under_review", submittedAt: nowIso() });
}

const detail = "The signup form posts to a spreadsheet rather than the CRM endpoint we discussed.";

let client: User;
let provider: User;
let operator: User;
let stranger: User;

beforeEach(async () => {
  await closeDb();
  resetSimulatedChain();
  const db = await getDb();
  for (const t of [
    "payments", "evidence_analyses", "evidence", "revision_requests", "dispute_messages",
    "disputes", "activity_events", "notifications", "milestones", "agreements",
    "wallet_addresses", "sessions", "idempotency_keys", "search_index", "analytics_events",
  ]) await db.query(`DELETE FROM ${t}`);
  await db.query("DELETE FROM users");
  client = await makeUser("Client", CLIENT);
  provider = await makeUser("Provider", PROVIDER);
  operator = await makeUser("Ops", "0x3333333333333333333333333333333333333333", true);
  stranger = await makeUser("Stranger", "0x4444444444444444444444444444444444444444");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function disputedSetup(amounts = [150_000]) {
  const { agreement } = await makeAgreement(client, provider, amounts);
  const funded = await fund(agreement, client);
  const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

  const dispute = await openDispute({
    bundle: await hydrate(funded), milestone, actor: client,
    input: { reason: "Scope disagreement", detail },
  });

  return { agreement: (await agreementsRepo.byId(funded.id))!, milestone, dispute };
}

describe("opening a dispute", () => {
  it("freezes the milestone and the agreement", async () => {
    const { agreement, milestone, dispute } = await disputedSetup();

    expect(dispute.status).toBe("open");
    expect((await milestonesRepo.byId(milestone.id))!.status).toBe("disputed");
    expect(agreement.status).toBe("disputed");
  });

  it("either party can open one", async () => {
    const { agreement } = await makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    const byProvider = await openDispute({
      bundle: await hydrate(funded), milestone, actor: provider,
      input: { reason: "Payment delayed", detail },
    });
    expect(byProvider.openedBy).toBe(provider.id);
  });

  it("a stranger cannot open one", async () => {
    const { agreement } = await makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    await expect(
      openDispute({
        bundle: await hydrate(funded), milestone, actor: stranger,
        input: { reason: "Scope", detail },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires enough detail to be reviewed fairly", async () => {
    const { agreement } = await makeAgreement(client, provider, [100_000]);
    const funded = await fund(agreement, client);
    const milestone = await underReview((await milestonesRepo.forAgreement(funded.id))[0]);

    await expect(
      openDispute({
        bundle: await hydrate(funded), milestone, actor: client,
        input: { reason: "Bad", detail: "nope" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("cannot open a second dispute on the same milestone", async () => {
    const { agreement, milestone } = await disputedSetup();

    await expect(
      openDispute({
        bundle: await hydrate(agreement), milestone: (await milestonesRepo.byId(milestone.id))!,
        actor: provider, input: { reason: "Again", detail },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("funds are frozen while disputed", () => {
  it("the client cannot release", async () => {
    const { agreement, milestone } = await disputedSetup();

    await expect(
      releaseMilestone({
        bundle: await hydrate(agreement), milestone: (await milestonesRepo.byId(milestone.id))!,
        actor: client, amount: 150_000, kind: "milestone_release",
        reason: null, idempotencyKey: "release_while_disputed",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    expect(await paymentsRepo.confirmedTotalForMilestone(milestone.id)).toBe(0);
  });

  it("an operator cannot release outside the resolution path", async () => {
    const { agreement, milestone } = await disputedSetup();

    await expect(
      releaseMilestone({
        bundle: await hydrate(agreement), milestone: (await milestonesRepo.byId(milestone.id))!,
        actor: operator, amount: 150_000, kind: "milestone_release",
        reason: null, idempotencyKey: "operator_backdoor_attempt",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("resolution", () => {
  it("splits the milestone and records the reasoning", async () => {
    const { agreement, milestone, dispute } = await disputedSetup();

    const result = await resolveDispute({
      dispute, bundle: await hydrate(agreement), actor: client,
      input: {
        resolution: "negotiated", providerAmount: 112_000,
        note: "Agreed the CRM endpoint was never in the written criteria. Settled at 80%.",
        idempotencyKey: "settle_negotiated_key",
      },
    });

    expect(result.dispute.status).toBe("resolved");
    expect(result.dispute.resolvedProviderAmount).toBe(112_000);
    expect(result.dispute.resolutionNote).toMatch(/never in the written criteria/);

    const payment = (await paymentsRepo.forMilestone(milestone.id))[0];
    expect(payment.kind).toBe("dispute_settlement");
    expect(payment.amount).toBe(112_000);
    expect(payment.reason).toBeTruthy();
  });

  it("a settlement cannot exceed the milestone balance", async () => {
    const { agreement, dispute } = await disputedSetup();

    await expect(
      resolveDispute({
        dispute, bundle: await hydrate(agreement), actor: operator,
        input: {
          resolution: "released_partial", providerAmount: 900_000,
          note: "Trying to over-award far beyond the milestone.",
          idempotencyKey: "over_award_attempt_key",
        },
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });
  });

  it("the provider cannot award themselves the funds", async () => {
    const { agreement, dispute } = await disputedSetup();

    await expect(
      resolveDispute({
        dispute, bundle: await hydrate(agreement), actor: provider,
        input: {
          resolution: "released_full", providerAmount: 150_000,
          note: "Awarding the full amount to myself.",
          idempotencyKey: "provider_self_award_key",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolving unfreezes the agreement", async () => {
    const { agreement, dispute } = await disputedSetup();

    await resolveDispute({
      dispute, bundle: await hydrate(agreement), actor: client,
      input: {
        resolution: "released_full", providerAmount: 150_000,
        note: "Reviewed the evidence again and it does meet the criteria.",
        idempotencyKey: "resolve_full_key_here",
      },
    });

    expect((await agreementsRepo.byId(agreement.id))!.status).toBe("in_progress");
  });

  it("cannot be resolved twice", async () => {
    const { agreement, dispute } = await disputedSetup();

    await resolveDispute({
      dispute, bundle: await hydrate(agreement), actor: client,
      input: {
        resolution: "negotiated", providerAmount: 75_000,
        note: "Split down the middle by mutual agreement.",
        idempotencyKey: "first_resolution_key",
      },
    });

    await expect(
      resolveDispute({
        dispute: (await disputesRepo.byId(dispute.id))!,
        bundle: await hydrate((await agreementsRepo.byId(agreement.id))!), actor: client,
        input: {
          resolution: "released_full", providerAmount: 150_000,
          note: "Changed my mind and want to award the rest.",
          idempotencyKey: "second_resolution_key",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a replayed resolution key returns the original outcome", async () => {
    const { agreement, dispute } = await disputedSetup();
    const key = "replayed_settlement_key";

    const first = await resolveDispute({
      dispute, bundle: await hydrate(agreement), actor: client,
      input: {
        resolution: "negotiated", providerAmount: 90_000,
        note: "Agreed split after reviewing the acceptance criteria together.",
        idempotencyKey: key,
      },
    });

    const replay = await resolveDispute({
      dispute, bundle: await hydrate((await agreementsRepo.byId(agreement.id))!), actor: client,
      input: {
        resolution: "negotiated", providerAmount: 90_000,
        note: "Agreed split after reviewing the acceptance criteria together.",
        idempotencyKey: key,
      },
    });

    expect(replay.dispute.id).toBe(first.dispute.id);
    expect(await paymentsRepo.forMilestone(first.milestone.id)).toHaveLength(1);
  });
});

describe("messages", () => {
  it("both parties can post, a stranger cannot", async () => {
    const { agreement, dispute } = await disputedSetup();
    const bundle = await hydrate(agreement);

    expect(
      (await addMessage({ dispute, actor: provider, body: "The CRM work was never scoped.", agreement: bundle })).authorId,
    ).toBe(provider.id);

    await expect(
      addMessage({ dispute, actor: stranger, body: "Butting in.", agreement: bundle }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("posting moves an open dispute into negotiating", async () => {
    const { agreement, dispute } = await disputedSetup();

    await addMessage({
      dispute, actor: provider, agreement: await hydrate(agreement),
      body: "Happy to settle at 80% and quote the integration separately.",
    });

    expect((await disputesRepo.byId(dispute.id))!.status).toBe("negotiating");
  });
});
