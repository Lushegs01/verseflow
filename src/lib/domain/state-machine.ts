/**
 * Explicit state machines for agreements and milestones.
 *
 * This module is the single authority on what transitions are legal. Nothing in the
 * UI, the API layer, or the chain adapters is permitted to move an entity between
 * states without passing through `assertAgreementTransition` / `assertMilestoneTransition`.
 *
 * Every transition also declares WHO may perform it, so authorization and state
 * validity are checked together rather than in two places that can drift apart.
 */

import type { AgreementStatus, MilestoneStatus, PartyRole } from "./types";

export type Actor = PartyRole | "system" | "admin";

export interface TransitionRule<S extends string> {
  from: S;
  to: S;
  /** Machine-readable name of the action that causes this transition. */
  action: string;
  /** Roles permitted to trigger it. */
  actors: Actor[];
  /** Human-readable description used in errors and documentation. */
  description: string;
}

// ---------------------------------------------------------------------------
// Agreement lifecycle
// ---------------------------------------------------------------------------

export const AGREEMENT_TRANSITIONS: TransitionRule<AgreementStatus>[] = [
  {
    from: "draft",
    to: "awaiting_signature",
    action: "submit_for_signature",
    actors: ["client", "provider"],
    description: "Terms are finalized and sent to both parties for signature.",
  },
  {
    from: "awaiting_signature",
    to: "draft",
    action: "reopen_draft",
    actors: ["client", "provider"],
    description: "A party withdrew from signing and the terms returned to draft.",
  },
  {
    from: "awaiting_signature",
    to: "awaiting_funding",
    action: "complete_signatures",
    actors: ["system"],
    description: "Both parties signed. The agreement is locked and awaiting escrow funding.",
  },
  {
    from: "awaiting_funding",
    to: "funded",
    action: "confirm_funding",
    actors: ["system"],
    description: "Escrow funding was confirmed on the settlement layer.",
  },
  {
    from: "funded",
    to: "in_progress",
    action: "start_work",
    actors: ["system", "provider"],
    description: "The first milestone became active.",
  },
  {
    from: "in_progress",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened on a milestone.",
  },
  {
    from: "funded",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened before work started.",
  },
  {
    from: "disputed",
    to: "in_progress",
    action: "resolve_dispute",
    actors: ["admin", "system"],
    description: "The dispute was resolved and work resumed.",
  },
  {
    from: "disputed",
    to: "completed",
    action: "resolve_dispute_final",
    actors: ["admin", "system"],
    description: "The dispute resolution settled the final milestone.",
  },
  {
    from: "disputed",
    to: "cancelled",
    action: "resolve_dispute_cancel",
    actors: ["admin"],
    description: "The dispute resolution cancelled the agreement and refunded escrow.",
  },
  {
    from: "in_progress",
    to: "paused",
    action: "pause",
    actors: ["admin"],
    description: "Operations paused the agreement pending review.",
  },
  {
    from: "paused",
    to: "in_progress",
    action: "resume",
    actors: ["admin"],
    description: "Operations resumed the agreement.",
  },
  {
    from: "in_progress",
    to: "completed",
    action: "complete",
    actors: ["system"],
    description: "Every milestone settled. The agreement is complete.",
  },
  {
    from: "draft",
    to: "cancelled",
    action: "cancel",
    actors: ["client", "provider"],
    description: "The draft was cancelled before signature.",
  },
  {
    from: "awaiting_signature",
    to: "cancelled",
    action: "cancel",
    actors: ["client", "provider"],
    description: "The agreement was cancelled before both signatures were collected.",
  },
  {
    from: "awaiting_funding",
    to: "cancelled",
    action: "cancel",
    actors: ["client", "provider", "admin"],
    description: "The agreement was cancelled before escrow was funded. No funds moved.",
  },
];

// ---------------------------------------------------------------------------
// Milestone lifecycle
// ---------------------------------------------------------------------------

export const MILESTONE_TRANSITIONS: TransitionRule<MilestoneStatus>[] = [
  {
    from: "locked",
    to: "in_progress",
    action: "activate",
    actors: ["system"],
    description: "Escrow funded or the previous milestone settled, so this one became active.",
  },
  {
    from: "in_progress",
    to: "submitted",
    action: "submit",
    actors: ["provider"],
    description: "The provider submitted the milestone with evidence.",
  },
  {
    from: "submitted",
    to: "under_review",
    action: "open_review",
    actors: ["system", "client"],
    description: "Evidence analysis finished and the client review window opened.",
  },
  {
    from: "under_review",
    to: "revision_requested",
    action: "request_revision",
    actors: ["client"],
    description: "The client requested changes with a structured explanation.",
  },
  {
    from: "submitted",
    to: "revision_requested",
    action: "request_revision",
    actors: ["client"],
    description: "The client requested changes before formal review opened.",
  },
  {
    from: "revision_requested",
    to: "submitted",
    action: "submit_revision",
    actors: ["provider"],
    description: "The provider submitted revised work.",
  },
  {
    from: "under_review",
    to: "approved",
    action: "approve",
    actors: ["client"],
    description: "The client approved the milestone in full.",
  },
  {
    from: "submitted",
    to: "approved",
    action: "approve",
    actors: ["client"],
    description: "The client approved the milestone in full.",
  },
  {
    from: "under_review",
    to: "partially_approved",
    action: "approve_partial",
    actors: ["client"],
    description: "The client approved a partial release with a stated reason.",
  },
  {
    from: "submitted",
    to: "partially_approved",
    action: "approve_partial",
    actors: ["client"],
    description: "The client approved a partial release with a stated reason.",
  },
  {
    from: "approved",
    to: "released",
    action: "release",
    actors: ["system"],
    description: "Settlement confirmed and the payment reached the provider.",
  },
  {
    from: "partially_approved",
    to: "released",
    action: "release",
    actors: ["system"],
    description: "The remaining balance settled and the milestone closed.",
  },
  {
    from: "partially_approved",
    to: "approved",
    action: "approve",
    actors: ["client"],
    description: "The client released the remainder after an earlier partial release.",
  },
  {
    from: "partially_approved",
    to: "partially_approved",
    action: "approve_partial",
    actors: ["client"],
    description: "The client released a further partial amount, still short of the full milestone.",
  },
  {
    from: "partially_approved",
    to: "under_review",
    action: "reopen_remainder",
    actors: ["client", "system"],
    description: "The withheld remainder returned to review.",
  },
  {
    from: "submitted",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened on this milestone.",
  },
  {
    from: "under_review",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened on this milestone.",
  },
  {
    from: "revision_requested",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened during the revision cycle.",
  },
  {
    from: "partially_approved",
    to: "disputed",
    action: "open_dispute",
    actors: ["client", "provider"],
    description: "A dispute was opened over the withheld remainder.",
  },
  {
    from: "disputed",
    to: "under_review",
    action: "resolve_dispute_review",
    // The party who raised the dispute may withdraw it. No money moves, so the
    // milestone simply returns to review.
    actors: ["admin", "system", "client", "provider"],
    description: "The dispute was withdrawn and the milestone returned to review.",
  },
  {
    from: "disputed",
    to: "approved",
    action: "resolve_dispute_approve",
    // A client settling in the provider's favour is releasing money they could
    // have released anyway, so it needs no operator.
    actors: ["admin", "client"],
    description: "The dispute resolved in favour of releasing the milestone.",
  },
  {
    from: "disputed",
    to: "partially_approved",
    action: "resolve_dispute_partial",
    actors: ["admin", "client"],
    description: "The dispute resolved with a split settlement.",
  },
  {
    from: "disputed",
    to: "released",
    action: "resolve_dispute_release",
    actors: ["admin", "system"],
    description: "The dispute settlement was paid out and the milestone closed.",
  },
  {
    from: "disputed",
    to: "cancelled",
    action: "resolve_dispute_cancel",
    actors: ["admin"],
    description: "The dispute resolved with a refund to the client.",
  },
  {
    from: "locked",
    to: "cancelled",
    action: "cancel",
    actors: ["admin", "system"],
    description: "The agreement was cancelled before this milestone started.",
  },
  {
    from: "in_progress",
    to: "cancelled",
    action: "cancel",
    actors: ["admin", "system"],
    description: "The agreement was cancelled while this milestone was active.",
  },
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
  constructor(
    readonly entity: "agreement" | "milestone",
    readonly from: string,
    readonly to: string,
    readonly action: string,
  ) {
    super(
      `Cannot ${action.replace(/_/g, " ")} a ${entity} that is currently "${humanize(from)}".`,
    );
    this.name = "InvalidTransitionError";
  }
}

export class UnauthorizedTransitionError extends Error {
  readonly code = "UNAUTHORIZED_TRANSITION";
  constructor(
    readonly entity: "agreement" | "milestone",
    readonly action: string,
    readonly actor: Actor,
  ) {
    super(`Your role is not permitted to ${action.replace(/_/g, " ")} this ${entity}.`);
    this.name = "UnauthorizedTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function findRule<S extends string>(
  rules: TransitionRule<S>[],
  from: S,
  to: S,
  action?: string,
): TransitionRule<S> | undefined {
  return rules.find((r) => r.from === from && r.to === to && (!action || r.action === action));
}

export function canTransitionAgreement(
  from: AgreementStatus,
  to: AgreementStatus,
  actor: Actor,
  action?: string,
): boolean {
  const rule = findRule(AGREEMENT_TRANSITIONS, from, to, action);
  return Boolean(rule && rule.actors.includes(actor));
}

export function canTransitionMilestone(
  from: MilestoneStatus,
  to: MilestoneStatus,
  actor: Actor,
  action?: string,
): boolean {
  const rule = findRule(MILESTONE_TRANSITIONS, from, to, action);
  return Boolean(rule && rule.actors.includes(actor));
}

export function assertAgreementTransition(
  from: AgreementStatus,
  to: AgreementStatus,
  actor: Actor,
  action = "change status",
): TransitionRule<AgreementStatus> {
  const rule = findRule(AGREEMENT_TRANSITIONS, from, to);
  if (!rule) throw new InvalidTransitionError("agreement", from, to, action);
  if (!rule.actors.includes(actor)) {
    throw new UnauthorizedTransitionError("agreement", rule.action, actor);
  }
  return rule;
}

export function assertMilestoneTransition(
  from: MilestoneStatus,
  to: MilestoneStatus,
  actor: Actor,
  action = "change status",
): TransitionRule<MilestoneStatus> {
  const rule = findRule(MILESTONE_TRANSITIONS, from, to);
  if (!rule) throw new InvalidTransitionError("milestone", from, to, action);
  if (!rule.actors.includes(actor)) {
    throw new UnauthorizedTransitionError("milestone", rule.action, actor);
  }
  return rule;
}

/** All states reachable from `from` by `actor`. Used to drive available UI actions. */
export function nextAgreementStates(from: AgreementStatus, actor: Actor): AgreementStatus[] {
  return AGREEMENT_TRANSITIONS.filter((r) => r.from === from && r.actors.includes(actor)).map(
    (r) => r.to,
  );
}

export function nextMilestoneStates(from: MilestoneStatus, actor: Actor): MilestoneStatus[] {
  return MILESTONE_TRANSITIONS.filter((r) => r.from === from && r.actors.includes(actor)).map(
    (r) => r.to,
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function humanize(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Terminal states cannot be left. Nothing may transition out of them. */
export const TERMINAL_AGREEMENT_STATES: AgreementStatus[] = ["completed", "cancelled"];
export const TERMINAL_MILESTONE_STATES: MilestoneStatus[] = ["released", "cancelled"];

export function isAgreementTerminal(s: AgreementStatus): boolean {
  return TERMINAL_AGREEMENT_STATES.includes(s);
}

export function isMilestoneTerminal(s: MilestoneStatus): boolean {
  return TERMINAL_MILESTONE_STATES.includes(s);
}

/** Milestone states where escrowed funds are committed but not yet paid out. */
export function isMilestoneFundsLocked(s: MilestoneStatus): boolean {
  return !isMilestoneTerminal(s);
}

/** True when a milestone is waiting on the client rather than the provider. */
export function awaitsClient(s: MilestoneStatus): boolean {
  return s === "submitted" || s === "under_review" || s === "partially_approved";
}

/** True when a milestone is waiting on the provider. */
export function awaitsProvider(s: MilestoneStatus): boolean {
  return s === "in_progress" || s === "revision_requested";
}
