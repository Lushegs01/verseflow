/**
 * Authentication and authorization.
 *
 * Sessions are wallet-derived: a user proves control of an address by signing a
 * nonce, and the resulting session id lives in an httpOnly cookie. The address in
 * the session is the one used for authorization checks -- never an address sent
 * in a request body, which a caller controls.
 */

import { cookies, headers } from "next/headers";
import { verifyMessage } from "viem";
import { sessionsRepo, usersRepo, walletsRepo, notificationsRepo } from "@/lib/db/repositories";
import type { User } from "@/lib/domain/types";
import { errors } from "@/lib/domain/errors";
import { newId, nowIso } from "@/lib/domain/ids";
import { getChainConfig } from "@/lib/chain/config";

export const SESSION_COOKIE = "vf_session";
const NONCE_COOKIE = "vf_nonce";

export interface AuthContext {
  user: User;
  address: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export function buildSignInMessage(address: string, nonce: string): string {
  const cfg = getChainConfig();
  return [
    "VerseFlow wants you to sign in with your wallet.",
    "",
    `Address: ${address}`,
    `Network: ${cfg.name} (chain ${cfg.chainId})`,
    `Nonce: ${nonce}`,
    "",
    "Signing this message proves you control this address.",
    "It does not authorize any payment or move any funds.",
  ].join("\n");
}

export async function issueNonce(): Promise<string> {
  const nonce = newId("ses").slice(4);
  const store = await cookies();
  store.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return nonce;
}

/**
 * Verify a wallet signature and start a session.
 *
 * In simulated mode a signature is not cryptographically checkable against a real
 * wallet, so the demo personas sign with a marker string. That path is gated on
 * simulated mode and clearly named, so it can never be mistaken for a real
 * signature check in production.
 */
export async function signIn(params: {
  address: string;
  signature: string;
  displayName?: string;
}): Promise<AuthContext> {
  const store = await cookies();
  const nonce = store.get(NONCE_COOKIE)?.value;
  if (!nonce) {
    throw errors.unauthenticated();
  }

  const message = buildSignInMessage(params.address, nonce);
  const cfg = getChainConfig();
  const isSimulatedSignature = params.signature.startsWith("simulated:");

  if (cfg.mode === "live" || !isSimulatedSignature) {
    let valid = false;
    try {
      valid = await verifyMessage({
        address: params.address as `0x${string}`,
        message,
        signature: params.signature as `0x${string}`,
      });
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new (await import("@/lib/domain/errors")).AppError(
        "SIGNATURE_INVALID",
        "That signature could not be verified for this address.",
      );
    }
  }

  store.delete(NONCE_COOKIE);

  let user = usersRepo.byAddress(params.address);
  if (!user) {
    user = createUserForAddress(params.address, params.displayName);
  }

  const session = sessionsRepo.create(user.id, params.address, cfg.chainId);
  store.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  return { user, address: params.address, sessionId: session.id };
}

function createUserForAddress(address: string, displayName?: string): User {
  const short = `${address.slice(2, 6)}${address.slice(-4)}`.toLowerCase();
  const user = usersRepo.create({
    id: newId("usr"),
    handle: displayName ? slugify(displayName, short) : `user-${short}`,
    displayName: displayName ?? `Wallet ${address.slice(0, 6)}`,
    headline: "",
    bio: "",
    avatarColor: pickColor(address),
    email: null,
    professions: [],
    verification: "wallet_verified",
    isAdmin: false,
    publicProfileEnabled: false,
    publicMetrics: [],
    timezone: "UTC",
    createdAt: nowIso(),
  });

  walletsRepo.add({
    userId: user.id,
    address,
    chainId: getChainConfig().chainId,
    label: "Primary wallet",
    isPrimary: true,
    verifiedAt: nowIso(),
  });

  notificationsRepo.savePreferences({
    userId: user.id,
    channels: {} as never,
    digestMode: false,
  });

  return user;
}

function slugify(value: string, suffix: string): string {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "user"}-${suffix.slice(0, 4)}`;
}

const AVATAR_COLORS = ["#1D5BFF", "#0F9D6B", "#B45309", "#6D4AFF", "#0E7C86", "#C2410C"];
function pickColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) sessionsRepo.destroy(sessionId);
  store.delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Reading the current session
// ---------------------------------------------------------------------------

export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = sessionsRepo.byId(sessionId);
  if (!session) return null;

  const user = usersRepo.byId(session.userId);
  if (!user) return null;

  return { user, address: session.address, sessionId };
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw errors.unauthenticated();
  return auth;
}

export async function requireAdmin(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!auth.user.isAdmin) {
    throw errors.forbidden("This area is restricted to operations staff.");
  }
  return auth;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

// ---------------------------------------------------------------------------
// Agreement-level authorization
// ---------------------------------------------------------------------------

/**
 * Who may act on an agreement is a domain rule, so it lives in
 * `lib/domain/permissions.ts` where it can be exhaustively tested without a
 * request context. Re-exported here because callers naturally reach for the
 * auth module when they want an authorization check.
 */
export { roleOn, canView, requireParty, requireRole, assertNotSelfDealing } from "@/lib/domain/permissions";
