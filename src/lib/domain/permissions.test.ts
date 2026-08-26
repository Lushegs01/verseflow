/**
 * Agreement authorization.
 *
 * Every case here is a payment vulnerability if it regresses, so the suite is
 * exhaustive rather than representative: it enumerates all four viewer kinds
 * against both actions and asserts the full matrix.
 */

import { describe, it, expect } from "vitest";
import { roleOn, canView, requireParty, requireRole, assertNotSelfDealing } from "./permissions";
import { DEFAULT_AGREEMENT_RULES, type Agreement, type User } from "./types";

const user = (id: string, isAdmin = false) => ({ id, isAdmin }) as Pick<User, "id" | "isAdmin">;

const CLIENT = user("usr_client");
const PROVIDER = user("usr_provider");
const STRANGER = user("usr_stranger");
const ADMIN = user("usr_admin", true);

function agreement(overrides: Partial<Agreement> = {}): Agreement {
  return {
    id: "agr_1", reference: "VF-1001", title: "Test", description: "",
    clientId: CLIENT.id, providerId: PROVIDER.id, providerInviteAddress: null,
    totalAmount: 300_000, asset: "USDC", status: "in_progress",
    agreementHash: null, onChainId: null, escrowAddress: null, fundingTxHash: null,
    chainId: 20197, rules: DEFAULT_AGREEMENT_RULES,
    clientSignature: null, providerSignature: null, expectedCompletionAt: null,
    startedAt: null, completedAt: null, cancelledAt: null, isSimulated: true,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("roleOn", () => {
  it("identifies each party", () => {
    const a = agreement();
    expect(roleOn(a, CLIENT.id)).toBe("client");
    expect(roleOn(a, PROVIDER.id)).toBe("provider");
  });

  it("returns null for anyone else, including an admin", () => {
    const a = agreement();
    expect(roleOn(a, STRANGER.id)).toBeNull();
    // Admin is not a party. Elevated read access is granted separately, so that
    // "is a party" and "may look at this" never get conflated.
    expect(roleOn(a, ADMIN.id)).toBeNull();
  });

  it("returns null when the provider slot is still an invite", () => {
    const a = agreement({ providerId: null, providerInviteAddress: "0x" + "1".repeat(40) });
    expect(roleOn(a, PROVIDER.id)).toBeNull();
    expect(roleOn(a, CLIENT.id)).toBe("client");
  });
});

describe("canView", () => {
  it("admits both parties and operations, and nobody else", () => {
    const a = agreement();
    expect(canView(a, CLIENT)).toBe(true);
    expect(canView(a, PROVIDER)).toBe(true);
    expect(canView(a, ADMIN)).toBe(true);
    expect(canView(a, STRANGER)).toBe(false);
  });
});

describe("requireParty", () => {
  it("returns the caller's role", () => {
    const a = agreement();
    expect(requireParty(a, CLIENT)).toBe("client");
    expect(requireParty(a, PROVIDER)).toBe("provider");
  });

  it("reports NOT_FOUND rather than FORBIDDEN for a stranger", () => {
    // This distinction matters: FORBIDDEN would confirm the agreement exists.
    expect(() => requireParty(agreement(), STRANGER)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("allows operations to read", () => {
    expect(requireParty(agreement(), ADMIN)).toBe("client");
  });
});

describe("requireRole", () => {
  it("permits only the named role", () => {
    const a = agreement();
    expect(requireRole(a, CLIENT, "client")).toBe("client");
    expect(requireRole(a, PROVIDER, "provider")).toBe("provider");
  });

  it("rejects the counterparty with a role-specific message", () => {
    const a = agreement();

    expect(() => requireRole(a, PROVIDER, "client")).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: "Only the client on this agreement can do that.",
      }),
    );
    expect(() => requireRole(a, CLIENT, "provider")).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: "Only the provider on this agreement can do that.",
      }),
    );
  });

  it("rejects strangers and admins for role-gated actions", () => {
    const a = agreement();
    // Operations may read, but may not act as a party. Releasing money is not a
    // support action.
    for (const viewer of [STRANGER, ADMIN]) {
      expect(() => requireRole(a, viewer, "client")).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
      expect(() => requireRole(a, viewer, "provider")).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    }
  });
});

describe("assertNotSelfDealing", () => {
  it("a provider can never approve their own milestone", () => {
    expect(() => assertNotSelfDealing(agreement(), PROVIDER, "approve")).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: "A provider cannot approve their own milestone.",
      }),
    );
  });

  it("a client can never submit work on the provider's behalf", () => {
    expect(() => assertNotSelfDealing(agreement(), CLIENT, "submit")).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: "A client cannot submit work on the provider's behalf.",
      }),
    );
  });

  it("permits each party their own action", () => {
    const a = agreement();
    expect(() => assertNotSelfDealing(a, CLIENT, "approve")).not.toThrow();
    expect(() => assertNotSelfDealing(a, PROVIDER, "submit")).not.toThrow();
  });

  it("rejects an agreement with the same party on both sides", () => {
    // Otherwise a single actor could approve their own payout.
    const degenerate = agreement({ clientId: CLIENT.id, providerId: CLIENT.id });
    expect(() => assertNotSelfDealing(degenerate, CLIENT, "approve")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => assertNotSelfDealing(degenerate, CLIENT, "submit")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("holds across the full viewer x action matrix", () => {
    const a = agreement();
    const viewers = [
      { name: "client", viewer: CLIENT },
      { name: "provider", viewer: PROVIDER },
      { name: "stranger", viewer: STRANGER },
      { name: "admin", viewer: ADMIN },
    ] as const;

    // The two combinations that must ALWAYS throw, regardless of anything else.
    const forbidden = new Set(["provider:approve", "client:submit"]);

    for (const { name, viewer } of viewers) {
      for (const action of ["approve", "submit"] as const) {
        const key = `${name}:${action}`;
        if (forbidden.has(key)) {
          expect(() => assertNotSelfDealing(a, viewer, action), key).toThrow();
        } else {
          expect(() => assertNotSelfDealing(a, viewer, action), key).not.toThrow();
        }
      }
    }
  });
});
