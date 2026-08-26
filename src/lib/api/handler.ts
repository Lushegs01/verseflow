/**
 * API route plumbing.
 *
 * Every route goes through `route()`, which gives all of them the same behaviour:
 * consistent machine-readable errors, rate limiting, audit-friendly context, and
 * a guarantee that an unexpected exception never leaks a stack trace or an
 * internal message to a caller.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError, errors, isAppError } from "@/lib/domain/errors";
import { InvalidTransitionError, UnauthorizedTransitionError } from "@/lib/domain/state-machine";
import { ChainError } from "@/lib/chain/adapter";
import { rateLimitRepo } from "@/lib/db/repositories";
import { getAuth, clientIp, type AuthContext } from "@/lib/services/auth";

export interface RouteContext<P = Record<string, string>> {
  request: NextRequest;
  params: P;
  auth: AuthContext | null;
  ip: string | null;
}

export interface AuthedRouteContext<P = Record<string, string>> extends RouteContext<P> {
  auth: AuthContext;
}

interface RouteOptions {
  /** Require a signed-in user. */
  auth?: boolean;
  /** Require an operations account. */
  admin?: boolean;
  /** Requests allowed per window, keyed by IP or user. */
  rateLimit?: { limit: number; windowSeconds: number; scope: string };
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<NextResponse | unknown>;
type AuthedHandler<P> = (ctx: AuthedRouteContext<P>) => Promise<NextResponse | unknown>;

// `auth: true` and `admin: true` both guarantee a session, so both narrow the
// handler context to `AuthedRouteContext` and remove the null check at call sites.
export function route<P = Record<string, string>>(
  options: RouteOptions & { auth: true },
  handler: AuthedHandler<P>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<NextResponse>;
export function route<P = Record<string, string>>(
  options: RouteOptions & { admin: true },
  handler: AuthedHandler<P>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<NextResponse>;
export function route<P = Record<string, string>>(
  options: RouteOptions,
  handler: Handler<P>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<NextResponse>;
export function route<P = Record<string, string>>(
  options: RouteOptions,
  handler: Handler<P> | AuthedHandler<P>,
) {
  return async (request: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const auth = await getAuth();
      const ip = await clientIp();

      if (options.rateLimit) {
        const bucket = `${options.rateLimit.scope}:${auth?.user.id ?? ip ?? "anonymous"}`;
        const allowed = await rateLimitRepo.consume(
          bucket,
          options.rateLimit.limit,
          options.rateLimit.windowSeconds,
        );
        if (!allowed) {
          const error = errors.rateLimited(options.rateLimit.windowSeconds);
          return NextResponse.json(error.toJSON(), {
            status: error.status,
            headers: { "retry-after": String(options.rateLimit.windowSeconds) },
          });
        }
      }

      if ((options.auth || options.admin) && !auth) {
        throw errors.unauthenticated();
      }
      if (options.admin && !auth?.user.isAdmin) {
        throw errors.forbidden("This action is restricted to operations staff.");
      }

      const result = await (handler as Handler<P>)({ request, params, auth, ip });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function toErrorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    return NextResponse.json(error.toJSON(), { status: error.status });
  }

  if (error instanceof z.ZodError) {
    const appError = new AppError("VALIDATION_FAILED", "Some fields need attention.", {
      details: {
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }

  if (error instanceof InvalidTransitionError) {
    const appError = new AppError("INVALID_STATE_TRANSITION", error.message);
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }

  if (error instanceof UnauthorizedTransitionError) {
    const appError = new AppError("UNAUTHORIZED_TRANSITION", error.message);
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }

  if (error instanceof ChainError) {
    const appError =
      error.kind === "unavailable"
        ? errors.chainUnavailable()
        : new AppError("TRANSACTION_FAILED", error.message);
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }

  // Anything unrecognized is logged in full server-side and returned as a generic
  // failure. Internal exception text never reaches a caller.
  console.error("[verseflow:api] unhandled error", error);
  const generic = errors.internal();
  return NextResponse.json(generic.toJSON(), { status: generic.status });
}

/**
 * Parse and validate a JSON body, or throw a VALIDATION_FAILED AppError.
 *
 * Generic over the schema rather than over a result type: schemas that use
 * `.default()` have different input and output types, and inferring from the
 * schema is what keeps defaulted fields non-optional at the call site.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "The request body could not be read.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "Some fields need attention.", {
      details: {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        fields: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
        ),
      },
    });
  }
  return parsed.data;
}

/**
 * Strip HTML-significant characters from free text before it is stored.
 * React escapes on render, so this is defence in depth rather than the only guard.
 */
export function sanitizeText(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}
