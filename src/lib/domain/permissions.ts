/**
 * Agreement authorization.
 *
 * Pure functions, deliberately separated from `services/auth.ts` (which owns
 * sessions, cookies, and signature verification). Who may do what to an agreement
 * is a domain rule, not a transport concern -- keeping it here means it can be
 * exhaustively tested without a request context, which matters because getting
 * any of it wrong is a payment vulnerability.
 */

import type { Agreement, PartyRole, User } from "./types";
import { AppError, errors } from "./errors";

/**
 * A viewer's role on an agreement, or null when they are not a party.
 *
 * Callers must treat null as "not found" rather than "forbidden", so the
 * existence of private agreements is never leaked by the difference.
 */
export function roleOn(agreement: Agreement, userId: string): PartyRole | null {
  if (agreement.clientId === userId) return "client";
  if (agreement.providerId === userId) return "provider";
  return null;
}

/** True when this user may read the agreement at all. */
export function canView(agreement: Agreement, user: Pick<User, "id" | "isAdmin">): boolean {
  return roleOn(agreement, user.id) !== null || user.isAdmin;
}

export function requireParty(agreement: Agreement, user: Pick<User, "id" | "isAdmin">): PartyRole {
  const role = roleOn(agreement, user.id);
  if (role) return role;
  // Operations can read for support purposes; every access is audited.
  if (user.isAdmin) return "client";
  throw errors.notFound("Agreement");
}

export function requireRole(
  agreement: Agreement,
  user: Pick<User, "id" | "isAdmin">,
  expected: PartyRole,
): PartyRole {
  const role = roleOn(agreement, user.id);
  if (role !== expected) {
    throw errors.forbidden(
      expected === "client"
        ? "Only the client on this agreement can do that."
        : "Only the provider on this agreement can do that.",
    );
  }
  return role;
}

/**
 * The two self-dealing rules that must never be violated:
 * a provider cannot approve their own work, and a client cannot submit on the
 * provider's behalf. Both are checked explicitly rather than inferred.
 */
export function assertNotSelfDealing(
  agreement: Agreement,
  user: Pick<User, "id" | "isAdmin">,
  action: "approve" | "submit",
): void {
  const role = roleOn(agreement, user.id);

  if (action === "approve" && role === "provider") {
    throw errors.forbidden("A provider cannot approve their own milestone.");
  }
  if (action === "submit" && role === "client") {
    throw errors.forbidden("A client cannot submit work on the provider's behalf.");
  }
  // A degenerate agreement with one party on both sides would let a single actor
  // approve their own payout, so it is rejected outright.
  if (agreement.clientId === agreement.providerId) {
    throw new AppError("FORBIDDEN", "An agreement cannot have the same party on both sides.");
  }
}
