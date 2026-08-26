/**
 * Canonical serialization and hashing of agreement terms.
 *
 * The hash is what both parties sign and what the escrow contract stores. It must
 * therefore be:
 *   - deterministic  (same terms in, same hash out, on any machine)
 *   - canonical      (key order and formatting cannot change the result)
 *   - complete       (every term that affects money is inside the preimage)
 *
 * If a field is not in `canonicalTerms`, changing it does not change the hash --
 * so anything financially meaningful must be included here.
 */

/**
 * Hashing uses viem's isomorphic primitives rather than `node:crypto`, so this
 * module is safe to import from client components. The display helpers at the
 * bottom (`shortHash`, `shortAddress`) are used throughout the UI, and a
 * server-only import here would drag Node builtins into the browser bundle.
 */
import { keccak256, sha256, toHex } from "viem";
import type { Agreement, AgreementRules, Milestone } from "./types";

export interface CanonicalTerms {
  version: 1;
  title: string;
  description: string;
  asset: string;
  totalAmount: number;
  clientAddress: string;
  providerAddress: string;
  expectedCompletionAt: string | null;
  rules: {
    revisionRounds: number;
    approvalWindowHours: number;
    disputeWindowHours: number;
    evidenceRequired: boolean;
    partialReleaseAllowed: boolean;
    lateDeliveryPolicy: string | null;
    additionalTerms: string[];
  };
  milestones: Array<{
    position: number;
    title: string;
    description: string;
    amount: number;
    dueAt: string | null;
    deliverables: string[];
    acceptanceCriteria: string[];
    requiredEvidence: string[];
  }>;
}

export function canonicalTerms(
  agreement: Pick<
    Agreement,
    "title" | "description" | "asset" | "totalAmount" | "expectedCompletionAt"
  > & { rules: AgreementRules },
  milestones: Milestone[],
  parties: { clientAddress: string; providerAddress: string },
): CanonicalTerms {
  return {
    version: 1,
    title: agreement.title.trim(),
    description: agreement.description.trim(),
    asset: agreement.asset,
    totalAmount: agreement.totalAmount,
    clientAddress: parties.clientAddress.toLowerCase(),
    providerAddress: parties.providerAddress.toLowerCase(),
    expectedCompletionAt: agreement.expectedCompletionAt,
    rules: {
      revisionRounds: agreement.rules.revisionRounds,
      approvalWindowHours: agreement.rules.approvalWindowHours,
      disputeWindowHours: agreement.rules.disputeWindowHours,
      evidenceRequired: agreement.rules.evidenceRequired,
      partialReleaseAllowed: agreement.rules.partialReleaseAllowed,
      lateDeliveryPolicy: agreement.rules.lateDeliveryPolicy,
      additionalTerms: [...agreement.rules.additionalTerms],
    },
    milestones: [...milestones]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        position: m.position,
        title: m.title.trim(),
        description: m.description.trim(),
        amount: m.amount,
        dueAt: m.dueAt,
        deliverables: [...m.deliverables],
        acceptanceCriteria: m.acceptanceCriteria.map((c) => c.text.trim()),
        requiredEvidence: [...m.requiredEvidence].sort(),
      })),
  };
}

/**
 * JSON with deterministic key ordering. `JSON.stringify` preserves insertion order,
 * which is not stable across code paths, so keys are sorted explicitly.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
  }
  return value;
}

/** keccak256 of the canonical terms. This is the value both parties sign. */
export function hashTerms(terms: CanonicalTerms): `0x${string}` {
  return keccak256(toHex(canonicalJson(terms)));
}

/**
 * Deterministic on-chain agreement id: keccak256(termsHash || clientAddr || providerAddr).
 * Two different agreements can never collide, and the same terms between the same
 * parties always produce the same id, which makes funding idempotent.
 */
export function deriveOnChainId(
  termsHash: string,
  clientAddress: string,
  providerAddress: string,
): `0x${string}` {
  const preimage = `${termsHash}|${clientAddress.toLowerCase()}|${providerAddress.toLowerCase()}`;
  return keccak256(toHex(preimage));
}

/** sha256 of an evidence payload. Evidence uses sha256; on-chain anchors use keccak256. */
export function hashEvidence(payload: {
  kind: string;
  source: string;
  title: string;
  metadata: Record<string, unknown>;
  submittedAt: string;
}): string {
  const canonical = canonicalJson({
    kind: payload.kind,
    source: payload.source.trim(),
    title: payload.title.trim(),
    metadata: payload.metadata,
    submittedAt: payload.submittedAt,
  });
  return sha256(toHex(canonical));
}

/** keccak256 over ordered evidence hashes - the value anchored with a submission. */
export function hashEvidenceBundle(evidenceHashes: string[]): `0x${string}` {
  return keccak256(toHex(canonicalJson([...evidenceHashes].sort())));
}

/**
 * Human-readable digest shown next to the hash so people can eyeball-verify that
 * two displays of the same agreement really are the same agreement.
 */
export function shortHash(hash: string | null, size = 6): string {
  if (!hash) return "--";
  return `${hash.slice(0, 2 + size)}...${hash.slice(-size)}`;
}

export function shortAddress(address: string | null, size = 4): string {
  if (!address) return "--";
  return `${address.slice(0, 2 + size)}...${address.slice(-size)}`;
}
