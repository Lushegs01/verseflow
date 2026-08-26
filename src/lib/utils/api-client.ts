"use client";

/**
 * Browser API client.
 *
 * Every call returns a discriminated result rather than throwing, so components
 * are forced to handle the failure path. Errors arrive as the same
 * machine-readable shape the server produces, which is what lets the UI show a
 * specific message instead of "something went wrong".
 */

import type { ErrorCode } from "@/lib/domain/errors";

export interface ApiError {
  code: ErrorCode;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: "same-origin",
    });

    const text = await response.text();
    const payload = text ? safeParse(text) : {};

    if (!response.ok) {
      const error = (payload as { error?: ApiError }).error;
      return {
        ok: false,
        error: error ?? {
          code: "INTERNAL",
          message: networkMessage(response.status),
        },
      };
    }

    return { ok: true, data: payload as T };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { ok: false, error: { code: "INTERNAL", message: "Request cancelled." } };
    }
    // A network failure is a different problem from a server error, and saying so
    // is more useful than a generic message.
    return {
      ok: false,
      error: {
        code: "CHAIN_UNAVAILABLE",
        message: "Could not reach VerseFlow.",
        hint: "Check your connection. Nothing was submitted.",
      },
    };
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function networkMessage(status: number): string {
  if (status === 404) return "That could not be found.";
  if (status === 429) return "Too many requests. Slow down for a moment.";
  if (status >= 500) return "Something went wrong on our side.";
  return "The request could not be completed.";
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", path, body, signal),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

/**
 * Poll until `check` reports a terminal state.
 *
 * Used for transaction confirmation. Backs off gradually and gives up rather than
 * polling forever, because a UI that spins indefinitely tells the user nothing.
 */
export async function pollUntil<T>(
  fn: () => Promise<ApiResult<T>>,
  isDone: (value: T) => boolean,
  options: { intervalMs?: number; maxAttempts?: number; onTick?: (attempt: number) => void } = {},
): Promise<ApiResult<T> | { ok: false; error: ApiError }> {
  const { intervalMs = 1200, maxAttempts = 40, onTick } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fn();
    if (!result.ok) return result;
    if (isDone(result.data)) return result;
    onTick?.(attempt);
    // Gentle backoff: quick at first, then slower as confidence drops.
    const delay = attempt < 5 ? intervalMs : Math.min(intervalMs * 2.5, 4000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return {
    ok: false,
    error: {
      code: "TRANSACTION_UNCONFIRMED",
      message: "This is taking longer than usual to confirm.",
      hint: "Your funds are safe. Refresh in a moment to check the latest status.",
    },
  };
}

/** Idempotency key for a payment action. Generated once and reused on retry. */
export function makeIdempotencyKey(scope: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${scope}_${random}`.slice(0, 120);
}

/** Fire-and-forget client analytics. Never blocks or surfaces an error. */
export function trackEvent(name: string, properties: Record<string, unknown> = {}, agreementId?: string) {
  void fetch("/api/analytics/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, properties, agreementId: agreementId ?? null }),
    keepalive: true,
  }).catch(() => {});
}
