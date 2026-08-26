import { describe, it, expect } from "vitest";
import {
  AGREEMENT_TRANSITIONS,
  MILESTONE_TRANSITIONS,
  assertAgreementTransition,
  assertMilestoneTransition,
  canTransitionMilestone,
  canTransitionAgreement,
  InvalidTransitionError,
  UnauthorizedTransitionError,
  isAgreementTerminal,
  isMilestoneTerminal,
  nextMilestoneStates,
  TERMINAL_AGREEMENT_STATES,
  TERMINAL_MILESTONE_STATES,
} from "./state-machine";
import type { AgreementStatus, MilestoneStatus } from "./types";

const ALL_AGREEMENT_STATES: AgreementStatus[] = [
  "draft", "awaiting_signature", "awaiting_funding", "funded",
  "in_progress", "completed", "cancelled", "paused", "disputed",
];

const ALL_MILESTONE_STATES: MilestoneStatus[] = [
  "locked", "in_progress", "submitted", "under_review", "revision_requested",
  "approved", "partially_approved", "released", "disputed", "cancelled",
];

describe("agreement state machine", () => {
  it("allows the full happy path", () => {
    expect(canTransitionAgreement("draft", "awaiting_signature", "client")).toBe(true);
    expect(canTransitionAgreement("awaiting_signature", "awaiting_funding", "system")).toBe(true);
    expect(canTransitionAgreement("awaiting_funding", "funded", "system")).toBe(true);
    expect(canTransitionAgreement("funded", "in_progress", "system")).toBe(true);
    expect(canTransitionAgreement("in_progress", "completed", "system")).toBe(true);
  });

  it("rejects skipping funding", () => {
    expect(() => assertAgreementTransition("awaiting_signature", "in_progress", "system")).toThrow(
      InvalidTransitionError,
    );
  });

  it("rejects funding an unsigned agreement", () => {
    expect(() => assertAgreementTransition("draft", "funded", "system")).toThrow(
      InvalidTransitionError,
    );
  });

  it("never allows leaving a terminal state", () => {
    for (const terminal of TERMINAL_AGREEMENT_STATES) {
      for (const target of ALL_AGREEMENT_STATES) {
        expect(
          AGREEMENT_TRANSITIONS.some((r) => r.from === terminal && r.to === target),
        ).toBe(false);
      }
    }
  });

  it("does not let a party pause an agreement", () => {
    expect(() => assertAgreementTransition("in_progress", "paused", "client")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(canTransitionAgreement("in_progress", "paused", "admin")).toBe(true);
  });

  it("only lets an operator cancel a disputed agreement", () => {
    expect(() => assertAgreementTransition("disputed", "cancelled", "client")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(canTransitionAgreement("disputed", "cancelled", "admin")).toBe(true);
  });

  it("cannot cancel once escrow is funded", () => {
    // Funds are locked at this point; unwinding runs through the dispute path.
    expect(() => assertAgreementTransition("funded", "cancelled", "client")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertAgreementTransition("in_progress", "cancelled", "client")).toThrow(
      InvalidTransitionError,
    );
  });

  it("has no duplicate transition rules", () => {
    const seen = new Set<string>();
    for (const rule of AGREEMENT_TRANSITIONS) {
      const key = `${rule.from}->${rule.to}`;
      expect(seen.has(key), `duplicate rule ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("reports terminal states correctly", () => {
    expect(isAgreementTerminal("completed")).toBe(true);
    expect(isAgreementTerminal("cancelled")).toBe(true);
    expect(isAgreementTerminal("in_progress")).toBe(false);
  });
});

describe("milestone state machine", () => {
  it("allows the full happy path", () => {
    expect(canTransitionMilestone("locked", "in_progress", "system")).toBe(true);
    expect(canTransitionMilestone("in_progress", "submitted", "provider")).toBe(true);
    expect(canTransitionMilestone("submitted", "under_review", "system")).toBe(true);
    expect(canTransitionMilestone("under_review", "approved", "client")).toBe(true);
    expect(canTransitionMilestone("approved", "released", "system")).toBe(true);
  });

  it("never lets a provider approve their own milestone", () => {
    expect(() => assertMilestoneTransition("under_review", "approved", "provider")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(() => assertMilestoneTransition("submitted", "approved", "provider")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(() =>
      assertMilestoneTransition("under_review", "partially_approved", "provider"),
    ).toThrow(UnauthorizedTransitionError);
  });

  it("never lets a client submit work", () => {
    expect(() => assertMilestoneTransition("in_progress", "submitted", "client")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(() => assertMilestoneTransition("revision_requested", "submitted", "client")).toThrow(
      UnauthorizedTransitionError,
    );
  });

  it("never lets a party release payment directly", () => {
    // Release only happens after settlement confirms; it is a system transition.
    expect(() => assertMilestoneTransition("approved", "released", "client")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(() => assertMilestoneTransition("approved", "released", "provider")).toThrow(
      UnauthorizedTransitionError,
    );
  });

  it("cannot release a locked milestone", () => {
    expect(() => assertMilestoneTransition("locked", "released", "system")).toThrow(
      InvalidTransitionError,
    );
  });

  it("cannot approve a milestone that was never submitted", () => {
    expect(() => assertMilestoneTransition("in_progress", "approved", "client")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertMilestoneTransition("locked", "approved", "client")).toThrow(
      InvalidTransitionError,
    );
  });

  it("cannot release twice", () => {
    for (const target of ALL_MILESTONE_STATES) {
      expect(MILESTONE_TRANSITIONS.some((r) => r.from === "released" && r.to === target)).toBe(false);
    }
  });

  it("lets a client settle a dispute, but never the provider", () => {
    // A client settling in the provider's favour is releasing money they could
    // have released anyway, so it needs no operator. A provider awarding
    // themselves the disputed funds must never be possible.
    expect(canTransitionMilestone("disputed", "approved", "client")).toBe(true);
    expect(canTransitionMilestone("disputed", "partially_approved", "client")).toBe(true);
    expect(canTransitionMilestone("disputed", "approved", "admin")).toBe(true);

    expect(() => assertMilestoneTransition("disputed", "approved", "provider")).toThrow(
      UnauthorizedTransitionError,
    );
    expect(() => assertMilestoneTransition("disputed", "partially_approved", "provider")).toThrow(
      UnauthorizedTransitionError,
    );
  });

  it("only an operator can cancel a disputed milestone", () => {
    // Cancelling refunds the client in full, so it must not be unilateral.
    for (const actor of ["client", "provider"] as const) {
      expect(() => assertMilestoneTransition("disputed", "cancelled", actor)).toThrow(
        UnauthorizedTransitionError,
      );
    }
    expect(canTransitionMilestone("disputed", "cancelled", "admin")).toBe(true);
  });

  it("either party may withdraw a dispute back to review", () => {
    // Withdrawal moves no money; the service restricts it to whoever opened it.
    expect(canTransitionMilestone("disputed", "under_review", "client")).toBe(true);
    expect(canTransitionMilestone("disputed", "under_review", "provider")).toBe(true);
  });

  it("supports the revision cycle in both directions", () => {
    expect(canTransitionMilestone("under_review", "revision_requested", "client")).toBe(true);
    expect(canTransitionMilestone("revision_requested", "submitted", "provider")).toBe(true);
  });

  it("never allows leaving a terminal state", () => {
    for (const terminal of TERMINAL_MILESTONE_STATES) {
      for (const target of ALL_MILESTONE_STATES) {
        expect(MILESTONE_TRANSITIONS.some((r) => r.from === terminal && r.to === target)).toBe(false);
      }
    }
    expect(isMilestoneTerminal("released")).toBe(true);
    expect(isMilestoneTerminal("under_review")).toBe(false);
  });

  it("exposes only role-appropriate next states", () => {
    const clientOptions = nextMilestoneStates("under_review", "client");
    expect(clientOptions).toContain("approved");
    expect(clientOptions).toContain("revision_requested");
    expect(clientOptions).not.toContain("released");

    const providerOptions = nextMilestoneStates("under_review", "provider");
    expect(providerOptions).not.toContain("approved");
    expect(providerOptions).toContain("disputed");
  });

  it("exhaustively rejects every undeclared transition", () => {
    let rejected = 0;
    for (const from of ALL_MILESTONE_STATES) {
      for (const to of ALL_MILESTONE_STATES) {
        const declared = MILESTONE_TRANSITIONS.some((r) => r.from === from && r.to === to);
        if (declared) continue;
        for (const actor of ["client", "provider", "system", "admin"] as const) {
          expect(canTransitionMilestone(from, to, actor)).toBe(false);
        }
        rejected += 1;
      }
    }
    // Sanity check that the loop actually exercised a meaningful number of pairs.
    expect(rejected).toBeGreaterThan(50);
  });

  it("has no duplicate transition rules", () => {
    const seen = new Set<string>();
    for (const rule of MILESTONE_TRANSITIONS) {
      const key = `${rule.from}->${rule.to}`;
      expect(seen.has(key), `duplicate rule ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
