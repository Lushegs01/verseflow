/**
 * Identifier generation.
 *
 * Entity ids are prefixed so a bare id in a log line, a URL, or a support ticket
 * is self-describing. References (VF-1042) are the human-facing handle for an
 * agreement and appear in the UI, invoices, and explorer metadata.
 */

import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz"; // no l/o to avoid misreading
const nano = customAlphabet(ALPHABET, 16);

export type IdPrefix =
  | "usr"
  | "agr"
  | "mst"
  | "evd"
  | "ana"
  | "pay"
  | "rev"
  | "dsp"
  | "msg"
  | "act"
  | "ntf"
  | "shw"
  | "aud"
  | "anl"
  | "wal"
  | "ses"
  | "idx";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}

/** Short, ordered-looking public reference for an agreement, e.g. VF-1042. */
export function newReference(sequence: number): string {
  return `VF-${1000 + sequence}`;
}

/**
 * Idempotency keys are generated client-side before a payment action and replayed
 * on retry, so a dropped response can never cause a double release.
 */
export function newIdempotencyKey(scope: string): string {
  return `${scope}_${nano()}${nano()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

export function addDays(iso: string, days: number): string {
  return addHours(iso, days * 24);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
