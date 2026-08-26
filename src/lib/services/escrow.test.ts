/**
 * End-to-end escrow tests against a real in-memory database and the simulated
 * settlement adapter. These exercise the actual services, not mocks, so a
 * regression in authorization or amount handling fails here.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Point the database at memory before any module reads the env.
process.env.VERSEFLOW_DB_PATH = ":memory:";
process.env.SIMULATED_CONFIRM_MS = "0";

import { getDb, closeDb } from "@/lib/db/client";
import {
  usersRepo,
  walletsRepo,
  agreementsRepo,
  milestonesRepo,
  paymentsRepo,
} from "@/lib/db/repositories";
import { newId, nowIso } from "@/lib/domain/ids";
import type { Agreement, Milestone, User } from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";
import { hydrate } from "@/lib/services/agreements";
import { prepareFunding, confirmFunding, releaseMilestone, confirmRelease, remainingFor } from "./escrow";
import { resetSimulatedChain } from "@/lib/chain/simulated-adapter";
import { AppError } from "@/lib/domain/errors";

const CLIENT_ADDRESS = "0x1111111111111111111111111111111111111111";
const PROVIDER_ADDRESS = "0x2222222222222222222222222222222222222222";

function makeUser(name: string, address: string, isAdmin = false): User {
  const user = usersRepo.create({
    id: newId("usr"),
    handle: name.toLowerCase(),
    displayName: name,
    headline: "",
    bio: "",
    avatarColor: "#1D5BFF",
    email: null,
    professions: [],
    verification: "wallet_verified",
    isAdmin,
    publicProfileEnabled: false,
    publicMetrics: [],
    timezone: "UTC",
    createdAt: nowIso(),
  });
  walletsRepo.add({
    userId: user.id,
    address,
    chainId: 20197,
    label: "Primary",
    isPrimary: true,
    verifiedAt: nowIso(),
  });
  return user;
}

function makeFundedAgreement(
  client: User,
  provider: User,
  amounts: number[],
): { agreement: Agreement; milestones: Milestone[] } {
  const now = nowIso();
  const total = amounts.reduce((a, b) => a + b, 0);

  const agreement = agreementsRepo.insert({
    id: newId("agr"),
    reference: `VF-${1000 + agreementsRepo.nextSequence()}`,
    title: "Test agreement",
    description: "",
    clientId: client.id,
    providerId: provider.id,
    providerInviteAddress: null,
    totalAmount: total,
    asset: "USDC",
    status: "awaiting_funding",
    agreementHash: null,
    onChainId: null,
    escrowAddress: null,
    fundingTxHash: null,
    chainId: 20197,
    rules: DEFAULT_AGREEMENT_RULES,
    clientSignature: {
      userId: client.id,
      address: CLIENT_ADDRESS,
      termsHash: "0x" + "0".repeat(64),
      signature: "simulated:client",
      signedAt: now,
      method: "simulated_signature",
    },
    providerSignature: {
      userId: provider.id,
      address: PROVIDER_ADDRESS,
      termsHash: "0x" + "0".repeat(64),
      signature: "simulated:provider",
      signedAt: now,
      method: "simulated_signature",
    },
    expectedCompletionAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    isSimulated: true,
    createdAt: now,
    updatedAt: now,
  });

  const milestones = amounts.map((amount, index) =>
    milestonesRepo.insert({
      id: newId("mst"),
      agreementId: agreement.id,
      position: index,
      title: `Milestone ${index + 1}`,
      description: "",
      amount,
      dueAt: null,
      deliverables: [],
      acceptanceCriteria: [],
      requiredEvidence: [],
      status: "locked",
      revisionCount: 0,
      releasedAmount: 0,
      submittedAt: null,
      approvedAt: null,
      releasedAt: null,
      reviewDueAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  return { agreement, milestones };
}

/** Drive an agreement all the way to funded so release tests have escrow to work with. */
async function fundIt(agreement: Agreement, client: User) {
  const bundle = hydrate(agreement);
  const intent = await prepareFunding({
    bundle,
    actor: client,
    idempotencyKey: newId("pay") + "fund",
    fromAddress: CLIENT_ADDRESS,
  });
  const txHash = intent.transaction.simulatedReceipt!.txHash;
  const result = await confirmFunding({
    bundle: hydrate(agreementsRepo.byId(agreement.id)!),
    actor: client,
    txHash,
  });
  expect(result.status).toBe("confirmed");
  return result.agreement;
}

/** Move a milestone into a reviewable state without going through evidence upload. */
function putUnderReview(milestone: Milestone): Milestone {
  return milestonesRepo.update({ ...milestone, status: "under_review", submittedAt: nowIso() });
}

let client: User;
let provider: User;

beforeEach(() => {
  closeDb();
  resetSimulatedChain();
  const db = getDb();
  // Fresh schema per test: wipe every table rather than leaking state between cases.
  for (const table of [
    "payments", "evidence_analyses", "evidence", "revision_requests", "dispute_messages",
    "disputes", "activity_events", "notifications", "milestones", "agreements",
    "wallet_addresses", "sessions", "idempotency_keys", "search_index", "analytics_events",
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec("DELETE FROM users");
  client = makeUser("Client", CLIENT_ADDRESS);
  provider = makeUser("Provider", PROVIDER_ADDRESS);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("funding", () => {
  it("funds escrow and activates the first milestone", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [75_000, 150_000, 75_000]);
    const funded = await fundIt(agreement, client);

    expect(funded.status).toBe("in_progress");
    expect(funded.fundingTxHash).toBeTruthy();
    expect(funded.onChainId).toBeTruthy();

    const milestones = milestonesRepo.forAgreement(funded.id);
    expect(milestones[0].status).toBe("in_progress");
    expect(milestones[1].status).toBe("locked");
    expect(milestones[2].status).toBe("locked");
  });

  it("refuses funding by anyone other than the client", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    await expect(
      prepareFunding({
        bundle: hydrate(agreement),
        actor: provider,
        idempotencyKey: "k".repeat(12),
        fromAddress: PROVIDER_ADDRESS,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses funding before both parties have signed", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const unsigned = agreementsRepo.update({ ...agreement, providerSignature: null });

    await expect(
      prepareFunding({
        bundle: hydrate(unsigned),
        actor: client,
        idempotencyKey: "k".repeat(12),
        fromAddress: CLIENT_ADDRESS,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("is idempotent: the same key returns the original intent", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const key = "idem" + "k".repeat(10);

    const first = await prepareFunding({
      bundle: hydrate(agreement),
      actor: client,
      idempotencyKey: key,
      fromAddress: CLIENT_ADDRESS,
    });
    const second = await prepareFunding({
      bundle: hydrate(agreementsRepo.byId(agreement.id)!),
      actor: client,
      idempotencyKey: key,
      fromAddress: CLIENT_ADDRESS,
    });

    expect(second.transaction.simulatedReceipt!.txHash).toBe(
      first.transaction.simulatedReceipt!.txHash,
    );
  });

  it("rejects funding when milestone amounts do not equal the total", async () => {
    const { agreement, milestones } = makeFundedAgreement(client, provider, [100_000]);
    // Corrupt the allocation the way a tampered client would.
    milestonesRepo.update({ ...milestones[0], amount: 90_000 });

    await expect(
      prepareFunding({
        bundle: hydrate(agreementsRepo.byId(agreement.id)!),
        actor: client,
        idempotencyKey: "k".repeat(12),
        fromAddress: CLIENT_ADDRESS,
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });
});

describe("release authorization", () => {
  it("refuses a release initiated by the provider", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    await expect(
      releaseMilestone({
        bundle: hydrate(funded),
        milestone,
        actor: provider,
        amount: 100_000,
        kind: "milestone_release",
        reason: null,
        idempotencyKey: "k".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a release by an unrelated third party", async () => {
    const stranger = makeUser("Stranger", "0x3333333333333333333333333333333333333333");
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    await expect(
      releaseMilestone({
        bundle: hydrate(funded),
        milestone,
        actor: stranger,
        amount: 100_000,
        kind: "milestone_release",
        reason: null,
        idempotencyKey: "k".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("release amounts", () => {
  it("releases a full milestone and confirms the payment", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [75_000, 150_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const result = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 75_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "rel" + "k".repeat(10),
    });

    expect(result.payment.status).toBe("pending");
    expect(result.milestone.status).toBe("approved");

    const confirmed = await confirmRelease({ payment: result.payment, actor: client });
    expect(confirmed.status).toBe("confirmed");

    const settled = milestonesRepo.byId(milestone.id)!;
    expect(settled.status).toBe("released");
    expect(settled.releasedAmount).toBe(75_000);

    // The next milestone should now be active.
    expect(milestonesRepo.forAgreement(funded.id)[1].status).toBe("in_progress");
  });

  it("cannot release more than the milestone is worth", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    await expect(
      releaseMilestone({
        bundle: hydrate(funded),
        milestone,
        actor: client,
        amount: 100_001,
        kind: "milestone_release",
        reason: null,
        idempotencyKey: "k".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });
  });

  it("rejects a zero or negative release", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    for (const amount of [0, -500]) {
      await expect(
        releaseMilestone({
          bundle: hydrate(funded),
          milestone,
          actor: client,
          amount,
          kind: "milestone_release",
          reason: null,
          idempotencyKey: `k${amount}`.padEnd(12, "x"),
        }),
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it("cannot release the same milestone twice", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const first = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "first" + "k".repeat(8),
    });
    await confirmRelease({ payment: first.payment, actor: client });

    const settled = milestonesRepo.byId(milestone.id)!;
    await expect(
      releaseMilestone({
        bundle: hydrate(agreementsRepo.byId(funded.id)!),
        milestone: settled,
        actor: client,
        amount: 100_000,
        kind: "milestone_release",
        reason: null,
        idempotencyKey: "second" + "k".repeat(8),
      }),
    ).rejects.toMatchObject({ code: "ALREADY_RELEASED" });
  });

  it("a retried release with the same key does not pay twice", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);
    const key = "retry" + "k".repeat(8);

    const first = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: key,
    });
    const second = await releaseMilestone({
      bundle: hydrate(agreementsRepo.byId(funded.id)!),
      milestone: milestonesRepo.byId(milestone.id)!,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: key,
    });

    expect(second.payment.id).toBe(first.payment.id);
    expect(paymentsRepo.forMilestone(milestone.id)).toHaveLength(1);
  });
});

describe("partial release", () => {
  it("releases part and leaves the remainder locked", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [150_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const result = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 90_000,
      kind: "partial_release",
      reason: "Mobile navigation still overlaps the logo at 390px.",
      idempotencyKey: "partial" + "k".repeat(8),
    });

    expect(result.milestone.status).toBe("partially_approved");
    await confirmRelease({ payment: result.payment, actor: client });

    const settled = milestonesRepo.byId(milestone.id)!;
    expect(settled.releasedAmount).toBe(90_000);
    expect(settled.status).toBe("partially_approved");
    expect(remainingFor(settled)).toBe(60_000);
  });

  it("a partial release cannot exceed the remaining balance", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [150_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const first = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 90_000,
      kind: "partial_release",
      reason: "Partial delivery accepted.",
      idempotencyKey: "p1" + "k".repeat(10),
    });
    await confirmRelease({ payment: first.payment, actor: client });

    await expect(
      releaseMilestone({
        bundle: hydrate(agreementsRepo.byId(funded.id)!),
        milestone: milestonesRepo.byId(milestone.id)!,
        actor: client,
        amount: 60_001,
        kind: "partial_release",
        reason: "Trying to over-release.",
        idempotencyKey: "p2" + "k".repeat(10),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ESCROW" });
  });

  it("requires a reason for a partial release", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [150_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    await expect(
      releaseMilestone({
        bundle: hydrate(funded),
        milestone,
        actor: client,
        amount: 90_000,
        kind: "partial_release",
        reason: null,
        idempotencyKey: "k".repeat(12),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("two partial releases settle the milestone exactly", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [150_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const first = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 90_000,
      kind: "partial_release",
      reason: "First half accepted.",
      idempotencyKey: "s1" + "k".repeat(10),
    });
    await confirmRelease({ payment: first.payment, actor: client });

    const second = await releaseMilestone({
      bundle: hydrate(agreementsRepo.byId(funded.id)!),
      milestone: milestonesRepo.byId(milestone.id)!,
      actor: client,
      amount: 60_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "s2" + "k".repeat(10),
    });
    await confirmRelease({ payment: second.payment, actor: client });

    const settled = milestonesRepo.byId(milestone.id)!;
    expect(settled.releasedAmount).toBe(150_000);
    expect(settled.status).toBe("released");
    expect(remainingFor(settled)).toBe(0);

    // The agreement had a single milestone, so it should now be complete.
    expect(agreementsRepo.byId(funded.id)!.status).toBe("completed");
  });
});

describe("payment ledger integrity", () => {
  it("a failed payment does not credit the milestone", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const result = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "fail" + "k".repeat(8),
    });

    // Simulate a transaction the settlement layer never recognized.
    const orphaned = paymentsRepo.update({ ...result.payment, txHash: "0x" + "9".repeat(64) });
    const outcome = await confirmRelease({ payment: orphaned, actor: client });

    expect(outcome.status).toBe("failed");
    const settled = milestonesRepo.byId(milestone.id)!;
    expect(settled.releasedAmount).toBe(0);
    expect(settled.status).not.toBe("released");
  });

  it("confirmed payments cannot be altered", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const result = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "imm" + "k".repeat(10),
    });
    await confirmRelease({ payment: result.payment, actor: client });

    // The database trigger, not application code, is what refuses this.
    const db = getDb();
    expect(() =>
      db.prepare("UPDATE payments SET amount = ? WHERE id = ?").run(1, result.payment.id),
    ).toThrow(/immutable|cannot be altered/i);
  });

  it("payments cannot be deleted", async () => {
    const { agreement } = makeFundedAgreement(client, provider, [100_000]);
    const funded = await fundIt(agreement, client);
    const milestone = putUnderReview(milestonesRepo.forAgreement(funded.id)[0]);

    const result = await releaseMilestone({
      bundle: hydrate(funded),
      milestone,
      actor: client,
      amount: 100_000,
      kind: "milestone_release",
      reason: null,
      idempotencyKey: "del" + "k".repeat(10),
    });

    const db = getDb();
    expect(() => db.prepare("DELETE FROM payments WHERE id = ?").run(result.payment.id)).toThrow(
      /immutable/i,
    );
  });
});
