/**
 * Machine-readable application errors.
 *
 * Every error that reaches a client carries a stable `code` the UI can branch on
 * and a `message` written for a person. Internal exception details never leave
 * the server -- unexpected errors are logged and returned as a generic INTERNAL.
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "UNAUTHORIZED_TRANSITION"
  | "AMOUNT_MISMATCH"
  | "INSUFFICIENT_ESCROW"
  | "EVIDENCE_REQUIRED"
  | "REVISION_LIMIT_REACHED"
  | "ALREADY_SIGNED"
  | "SIGNATURE_INVALID"
  | "NOT_FUNDED"
  | "ALREADY_RELEASED"
  | "DUPLICATE_REQUEST"
  | "CHAIN_UNAVAILABLE"
  | "TRANSACTION_FAILED"
  | "TRANSACTION_UNCONFIRMED"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  UNAUTHORIZED_TRANSITION: 403,
  AMOUNT_MISMATCH: 422,
  INSUFFICIENT_ESCROW: 422,
  EVIDENCE_REQUIRED: 422,
  REVISION_LIMIT_REACHED: 409,
  ALREADY_SIGNED: 409,
  SIGNATURE_INVALID: 400,
  NOT_FUNDED: 409,
  ALREADY_RELEASED: 409,
  DUPLICATE_REQUEST: 409,
  CHAIN_UNAVAILABLE: 503,
  TRANSACTION_FAILED: 502,
  TRANSACTION_UNCONFIRMED: 202,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** Short guidance rendered under the message when the UI has room for it. */
  readonly hint: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; hint?: string } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.hint = options.hint;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

// Convenience constructors for the errors used most often, so call sites stay short
// and the wording of common failures stays consistent across the product.

export const errors = {
  notFound: (what: string) => new AppError("NOT_FOUND", `${what} could not be found.`),

  forbidden: (message = "You do not have access to this.") => new AppError("FORBIDDEN", message),

  unauthenticated: () =>
    new AppError("UNAUTHENTICATED", "Connect your wallet to continue.", {
      hint: "Your session expired or the wallet was disconnected.",
    }),

  amountMismatch: (allocated: number, total: number) =>
    new AppError("AMOUNT_MISMATCH", "Milestone amounts must equal the total agreement value.", {
      details: { allocated, total, difference: total - allocated },
    }),

  evidenceRequired: () =>
    new AppError(
      "EVIDENCE_REQUIRED",
      "This milestone requires at least one evidence item before submission.",
    ),

  revisionLimit: (used: number, allowed: number) =>
    new AppError(
      "REVISION_LIMIT_REACHED",
      `All ${allowed} revision rounds for this milestone have been used.`,
      {
        details: { used, allowed },
        hint: "Open a dispute or agree on a partial release to move forward.",
      },
    ),

  notFunded: () =>
    new AppError("NOT_FUNDED", "Escrow has not been funded for this agreement yet.", {
      hint: "The client needs to fund the agreement before work can be submitted.",
    }),

  alreadyReleased: () =>
    new AppError("ALREADY_RELEASED", "This milestone has already been paid out."),

  insufficientEscrow: (requested: number, available: number) =>
    new AppError("INSUFFICIENT_ESCROW", "That amount exceeds what remains locked for this milestone.", {
      details: { requested, available },
    }),

  duplicate: (key: string) =>
    new AppError("DUPLICATE_REQUEST", "This request was already processed.", {
      details: { idempotencyKey: key },
    }),

  chainUnavailable: (detail?: string) =>
    new AppError("CHAIN_UNAVAILABLE", "The settlement network is not reachable right now.", {
      hint: "Your funds are unaffected. Try again in a moment.",
      ...(detail ? { details: { detail } } : {}),
    }),

  transactionFailed: (reason: string) =>
    new AppError("TRANSACTION_FAILED", "The transaction was not completed.", {
      hint: "No funds moved. You can safely try again.",
      details: { reason },
    }),

  rateLimited: (retryAfterSeconds: number) =>
    new AppError("RATE_LIMITED", "Too many requests. Slow down for a moment.", {
      details: { retryAfterSeconds },
    }),

  internal: () =>
    new AppError("INTERNAL", "Something went wrong on our side.", {
      hint: "The action was not applied. Nothing was charged.",
    }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
